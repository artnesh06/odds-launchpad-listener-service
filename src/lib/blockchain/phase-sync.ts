/**
 * Phase sync: the contract's getAllPhases() is the source of truth.
 *
 * Phase rows used to come only from PhaseAdded/PhaseUpdated events and the
 * creator's save call in the launchpad app. That misses phases passed to the
 * constructor (no PhaseAdded event), PhaseRemoved (index shifts), and the
 * per-phase minted counts, which no event carries. Instead of patching every
 * handler, a launchpad's phases are re-read from the chain after any event
 * that can change them, debounced so a burst of mints costs one RPC call.
 */

import { ethers } from 'ethers';
import { prisma } from '../../config/database';
import { getChainProvider } from './chain-provider';
import OddsLaunchpadABI from '../../../abi/OddsLaunchpad.json';

const launchpadInterface = new ethers.Interface(
  (Array.isArray(OddsLaunchpadABI) ? OddsLaunchpadABI : (OddsLaunchpadABI as any).abi) as ethers.InterfaceAbi
);

type PhaseType = 'PRESALE' | 'PUBLIC' | 'ALLOWLIST' | 'FREE';

function phaseTypeOf(name: string, price: bigint): PhaseType {
  const n = name.toLowerCase();
  if (price === 0n) return 'FREE';
  if (/pre-?sale/.test(n)) return 'PRESALE';
  if (/allowlist|whitelist/.test(n)) return 'ALLOWLIST';
  return 'PUBLIC';
}

export interface PhaseSyncResult {
  inserted: number;
  updated: number;
  removed: number;
}

/**
 * Make launchpad_phases for one launchpad match the contract.
 * Existing rows keep their id and phaseType (set by the creator in the app).
 */
export async function syncPhasesFromChain(chainId: number, launchpadAddress: string): Promise<PhaseSyncResult | null> {
  const address = launchpadAddress.toLowerCase();
  const launchpad = await prisma.launchpad.findUnique({
    where: { contractAddress: address },
    select: { id: true, name: true, totalMaxSupply: true, phases: true },
  });
  if (!launchpad) return null;

  const contract = new ethers.Contract(address, launchpadInterface, getChainProvider(chainId));
  const [onChain, maxSupply]: [any[], bigint] = await Promise.all([
    contract.getAllPhases(),
    contract.totalMaxSupply(),
  ]);

  // Max supply is also mirrored here: older listener code stored totalSupply()
  // (= minted so far), which made collections look sold out.
  if (launchpad.totalMaxSupply !== Number(maxSupply)) {
    await prisma.launchpad.update({ where: { id: launchpad.id }, data: { totalMaxSupply: Number(maxSupply) } });
    console.log(`🔁 Max supply fixed for ${launchpad.name} (${address}): ${launchpad.totalMaxSupply} -> ${maxSupply}`);
  }

  const result: PhaseSyncResult = { inserted: 0, updated: 0, removed: 0 };
  const byIndex = new Map(launchpad.phases.map((p) => [p.phaseIndex, p]));

  for (let i = 0; i < onChain.length; i++) {
    const ph = onChain[i];
    const want = {
      name: String(ph.name),
      startTime: new Date(Number(ph.startTime) * 1000),
      endTime: new Date(Number(ph.endTime) * 1000),
      price: ph.price.toString(),
      maxMintPerWallet: Number(ph.maxPerWallet),
      totalLimit: Number(ph.maxSupply),
      mintedCount: Number(ph.currentSupply),
      isActive: Boolean(ph.isActive),
      merkleRoot: String(ph.merkleRoot),
    };
    const have = byIndex.get(i);
    if (!have) {
      await prisma.launchpadPhase.upsert({
        where: { launchpadId_phaseIndex: { launchpadId: launchpad.id, phaseIndex: i } },
        create: { launchpadId: launchpad.id, phaseIndex: i, phaseType: phaseTypeOf(want.name, ph.price), ...want },
        update: want,
      });
      result.inserted++;
      continue;
    }
    const changed =
      have.name !== want.name ||
      have.startTime.getTime() !== want.startTime.getTime() ||
      (have.endTime?.getTime() ?? null) !== want.endTime.getTime() ||
      have.price !== want.price ||
      have.maxMintPerWallet !== want.maxMintPerWallet ||
      have.totalLimit !== want.totalLimit ||
      have.mintedCount !== want.mintedCount ||
      have.isActive !== want.isActive ||
      (have.merkleRoot ?? '') !== want.merkleRoot;
    if (changed) {
      await prisma.launchpadPhase.update({ where: { id: have.id }, data: want });
      result.updated++;
    }
  }

  const stale = launchpad.phases.filter((p) => p.phaseIndex >= onChain.length).map((p) => p.id);
  if (stale.length > 0) {
    const { count } = await prisma.launchpadPhase.deleteMany({ where: { id: { in: stale } } });
    result.removed = count;
  }

  if (result.inserted || result.updated || result.removed) {
    console.log(
      `🔁 Phases synced for ${launchpad.name} (${address}): +${result.inserted} ~${result.updated} -${result.removed}`
    );
  }
  return result;
}

const pending = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = Math.max(parseInt(process.env.PHASE_SYNC_DEBOUNCE_MS || '15000', 10) || 15000, 1000);

/** Re-read a launchpad's phases soon; repeated calls within the window collapse into one. */
export function schedulePhaseSync(chainId: number, launchpadAddress: string, delayMs = DEBOUNCE_MS): void {
  const key = `${chainId}:${launchpadAddress.toLowerCase()}`;
  if (pending.has(key)) return;
  const timer = setTimeout(async () => {
    pending.delete(key);
    try {
      await syncPhasesFromChain(chainId, launchpadAddress);
    } catch (error: any) {
      console.warn(`⚠️ Phase sync failed for ${launchpadAddress}: ${error?.shortMessage || error?.message || error}`);
    }
  }, delayMs);
  timer.unref();
  pending.set(key, timer);
}

/** Reconcile every launchpad on a chain (startup self-heal). Sequential to stay gentle on the RPC. */
export async function syncAllPhases(chainId: number): Promise<void> {
  const launchpads = await prisma.launchpad.findMany({ where: { chainId }, select: { contractAddress: true } });
  const total: PhaseSyncResult = { inserted: 0, updated: 0, removed: 0 };
  let failed = 0;
  for (const { contractAddress } of launchpads) {
    try {
      const r = await syncPhasesFromChain(chainId, contractAddress);
      if (r) {
        total.inserted += r.inserted;
        total.updated += r.updated;
        total.removed += r.removed;
      }
    } catch (error: any) {
      failed++;
      console.warn(`⚠️ Phase sync failed for ${contractAddress}: ${error?.shortMessage || error?.message || error}`);
    }
  }
  console.log(
    `🔁 Phase reconcile chain ${chainId}: ${launchpads.length} launchpads, +${total.inserted} ~${total.updated} -${total.removed}, ${failed} failed`
  );
}
