/**
 * Database bootstrap for the listener.
 *
 * The listener shares its PostgreSQL database with the launchpad frontend,
 * whose Prisma migrations own the schema. `prisma db push` from this repo
 * would DROP the launchpad-only tables (verification_*), so the listener
 * never pushes its schema. Instead it applies the few additive, idempotent
 * changes it needs on top of the launchpad schema, then makes sure the chains
 * and factories it listens to exist.
 *
 * Environment:
 *   LISTENER_CHAIN_IDS   comma-separated chain ids to listen to (default "4326")
 *   RPC_URLS_<chainId>   comma-separated RPC URLs, in priority order
 *   SKIP_DB_BOOTSTRAP    "true" to skip everything below
 */

import { prisma } from '../../config/database';
import { getChainConfigSync } from '../../config/chains';
import { normalizeRpcUrls } from '../blockchain/failover-provider';

/** Additive changes only. Every statement is idempotent and runs on its own. */
const SCHEMA_STATEMENTS: Array<{ name: string; sql: string }> = [
  {
    name: 'ActivityType.TRANSFER_OCCURRED',
    sql: `ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'TRANSFER_OCCURRED'`,
  },
  {
    name: 'launchpad_factories.lastProcessedBlock',
    sql: `ALTER TABLE "launchpad_factories" ADD COLUMN IF NOT EXISTS "lastProcessedBlock" INTEGER, ADD COLUMN IF NOT EXISTS "lastProcessedBlockAt" TIMESTAMP(3)`,
  },
  {
    name: 'launchpad_factories_lastProcessedBlock_idx',
    sql: `CREATE INDEX IF NOT EXISTS "launchpad_factories_lastProcessedBlock_idx" ON "launchpad_factories"("lastProcessedBlock")`,
  },
  {
    name: 'launchpads.isFeatured',
    sql: `ALTER TABLE "launchpads" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false`,
  },
  {
    name: 'launchpads_isFeatured_idx',
    sql: `CREATE INDEX IF NOT EXISTS "launchpads_isFeatured_idx" ON "launchpads"("isFeatured")`,
  },
  {
    // One batch-mint transaction mints many tokens, so txHash cannot be unique.
    // Uniqueness is per (launchpadId, tokenId) instead.
    name: 'drop mints_txHash_key',
    sql: `DROP INDEX IF EXISTS "mints_txHash_key"`,
  },
  {
    name: 'mints_txHash_idx',
    sql: `CREATE INDEX IF NOT EXISTS "mints_txHash_idx" ON "mints"("txHash")`,
  },
  {
    name: 'mints_launchpadId_tokenId_key',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "mints_launchpadId_tokenId_key" ON "mints"("launchpadId", "tokenId")`,
  },
  {
    name: 'processed_events',
    sql: `CREATE TABLE IF NOT EXISTS "processed_events" (
      "id" TEXT NOT NULL,
      "transactionHash" TEXT NOT NULL,
      "logIndex" INTEGER NOT NULL,
      "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
    )`,
  },
  {
    name: 'processed_events indexes',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "processed_events_transactionHash_logIndex_key" ON "processed_events"("transactionHash", "logIndex")`,
  },
  {
    name: 'processed_events_processedAt_idx',
    sql: `CREATE INDEX IF NOT EXISTS "processed_events_processedAt_idx" ON "processed_events"("processedAt")`,
  },
  {
    name: 'admin_activity_logs',
    sql: `CREATE TABLE IF NOT EXISTS "admin_activity_logs" (
      "id" VARCHAR(25) NOT NULL,
      "operationType" VARCHAR(50) NOT NULL,
      "status" VARCHAR(20) NOT NULL,
      "chainId" INTEGER,
      "contractAddress" VARCHAR(42),
      "startedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" TIMESTAMP(6),
      "duration" INTEGER,
      "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
      "itemsFailed" INTEGER NOT NULL DEFAULT 0,
      "errorMessage" TEXT,
      "metadata" JSON,
      CONSTRAINT "admin_activity_logs_pkey" PRIMARY KEY ("id")
    )`,
  },
  {
    name: 'admin_activity_logs indexes',
    sql: `CREATE INDEX IF NOT EXISTS "idx_chainId_contractAddress" ON "admin_activity_logs"("chainId", "contractAddress")`,
  },
  {
    name: 'idx_operationType_status',
    sql: `CREATE INDEX IF NOT EXISTS "idx_operationType_status" ON "admin_activity_logs"("operationType", "status")`,
  },
  {
    name: 'idx_startedAt',
    sql: `CREATE INDEX IF NOT EXISTS "idx_startedAt" ON "admin_activity_logs"("startedAt")`,
  },
  {
    name: 'idx_status_startedAt',
    sql: `CREATE INDEX IF NOT EXISTS "idx_status_startedAt" ON "admin_activity_logs"("status", "startedAt")`,
  },
];

export function getListenerChainIds(): number[] {
  const raw = process.env.LISTENER_CHAIN_IDS ?? '4326';
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function getEnvRpcUrls(chainId: number): string[] {
  return normalizeRpcUrls((process.env[`RPC_URLS_${chainId}`] || '').split(','));
}

async function ensureSchema(): Promise<void> {
  // The launchpad app creates the base schema; wait for it on a fresh database.
  const [{ exists }] = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT to_regclass('public.launchpad_factories') IS NOT NULL AS "exists"`;
  if (!exists) {
    throw new Error('Base schema not found (launchpad_factories). Deploy the launchpad app first so its migrations create the tables.');
  }

  for (const statement of SCHEMA_STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(statement.sql);
    } catch (error) {
      // Not fatal: e.g. existing duplicate rows block a unique index
      console.warn(`⚠️ [bootstrap] Could not apply "${statement.name}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`✅ [bootstrap] Listener schema additions checked (${SCHEMA_STATEMENTS.length} statements)`);
}

async function ensureChainsAndFactories(): Promise<void> {
  for (const chainId of getListenerChainIds()) {
    const meta = getChainConfigSync(chainId);
    if (!meta) {
      console.warn(`⚠️ [bootstrap] Chain ${chainId} is not supported by this listener, skipping`);
      continue;
    }

    const envUrls = getEnvRpcUrls(chainId);
    const existing = await prisma.chain.findUnique({ where: { chainId } });
    const rpcUrl = envUrls.length > 0 ? envUrls.join(',') : existing?.rpcUrl;
    if (!rpcUrl) {
      console.warn(`⚠️ [bootstrap] No RPC configured for chain ${chainId} (set RPC_URLS_${chainId}), skipping`);
      continue;
    }

    await prisma.chain.upsert({
      where: { chainId },
      update: { rpcUrl },
      create: {
        chainId,
        name: meta.name,
        network: meta.network,
        rpcUrl,
        blockExplorer: meta.blockExplorer,
        nativeCurrencyName: meta.nativeCurrency.name,
        nativeCurrencySymbol: meta.nativeCurrency.symbol,
        nativeCurrencyDecimals: meta.nativeCurrency.decimals,
        isTestnet: meta.isTestnet,
        icon: meta.icon,
      },
    });

    const factoryAddress = meta.launchpadFactoryAddress?.toLowerCase();
    if (factoryAddress) {
      const factory = await prisma.launchpadFactory.findUnique({ where: { contractAddress: factoryAddress } });
      if (!factory) {
        await prisma.launchpadFactory.create({
          data: {
            chainId,
            contractAddress: factoryAddress,
            version: 'v1',
            deployedChainId: chainId,
            owner: factoryAddress, // placeholder, same convention as the launchpad seed
            treasury: factoryAddress,
            creationFee: '0',
            platformFeePercentage: 0,
            freeMintFee: '0',
            isActive: true,
          },
        });
        console.log(`✅ [bootstrap] Registered factory ${factoryAddress} on chain ${chainId}`);
      }
    }

    console.log(`✅ [bootstrap] Chain ${chainId} (${meta.name}) ready with ${rpcUrl.split(',').length} RPC endpoint(s)`);
  }
}

export async function bootstrapDatabase(): Promise<void> {
  if (process.env.SKIP_DB_BOOTSTRAP === 'true') {
    console.log('ℹ️ [bootstrap] SKIP_DB_BOOTSTRAP=true, skipping');
    return;
  }
  await ensureSchema();
  await ensureChainsAndFactories();
}
