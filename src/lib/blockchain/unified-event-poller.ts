/**
 * Unified Event Poller
 *
 * One polling loop per chain that reads ALL launchpad events (and the
 * factory's ContractDeployed events) with eth_getLogs.
 *
 * Reliability rules:
 *   - A single block cursor is persisted in launchpad_factories.lastProcessedBlock.
 *     After a restart or an RPC outage the poller resumes exactly where it
 *     stopped, so no event is skipped.
 *   - Each block range is processed in order: factory events first (so a newly
 *     deployed launchpad is registered), then launchpad events for the SAME
 *     range. The cursor only moves forward after a range is fully handled.
 *   - Ranges are chunked and the chunk size adapts: it halves when an RPC
 *     rejects the range and grows back after successes. Catch-up after
 *     downtime is therefore bounded per request.
 *   - Errors back off exponentially (max 30s); the loop never stops by itself.
 *   - The newest CONFIRMATIONS blocks are not read yet, which keeps the
 *     poller away from nodes that are a few blocks behind.
 */

import { ethers } from 'ethers';
import OddsLaunchpadABI from '../../../abi/OddsLaunchpad.json';

import type { UserEventHandler, AdminEventHandler, MetadataEventHandler, SecurityEventHandler } from './event-handlers';

export interface UnifiedPollerContext {
  chainId: number;
  provider: ethers.JsonRpcProvider | ethers.WebSocketProvider;
  factoryContract: ethers.Contract;
  launchpadContracts: Map<string, ethers.Contract>;
  enabledEvents: Set<string>;
  userEventHandler: UserEventHandler;
  adminEventHandler: AdminEventHandler;
  metadataEventHandler: MetadataEventHandler;
  securityEventHandler: SecurityEventHandler;
  updateEventLiveness: () => void;
  handleMintEvent?: (data: any) => Promise<void>;
  handleRegularTransferEvent?: (data: any) => Promise<void>;
  handleNFTTransferOnly?: (data: any) => Promise<void>;
  handleContractDeployedEvent?: (data: any) => Promise<void>;
  httpRpcUrl?: string; // kept for backwards compatibility (unused)
}

/**
 * Event topic mapping untuk efficient filtering
 */
interface EventTopicMap {
  [topicHash: string]: {
    eventName: string;
    handler: (address: string, parsedLog: ethers.LogDescription, log: ethers.Log) => Promise<void>;
  };
}

export interface PollerHealth {
  running: boolean;
  cursorBlock: number | null;
  headBlock: number | null;
  lagBlocks: number | null;
  chunkSize: number;
  consecutiveErrors: number;
  lastSuccessAt: number | null;
  /** Last time any work completed (event handled, range saved or idle cycle). Used by the watchdog. */
  lastProgressAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
}

function envInt(name: string, fallback: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

const launchpadInterface = new ethers.Interface(
  (Array.isArray(OddsLaunchpadABI) ? OddsLaunchpadABI : (OddsLaunchpadABI as any).abi) as ethers.InterfaceAbi
);

/**
 * Unified Event Poller
 * Menggunakan 1 polling loop untuk semua events
 */
export class UnifiedEventPoller {
  private context: UnifiedPollerContext;
  private eventTopicMap: EventTopicMap = {};
  private running = false;
  private loopTimer?: NodeJS.Timeout;
  private loopPromise: Promise<void> | null = null;

  private cursor: number | null = null; // last fully processed block
  private head: number | null = null;
  private chunkSize: number;
  private consecutiveErrors = 0;
  private lastSuccessAt: number | null = null;
  private lastProgressAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;

  private readonly POLL_INTERVAL_MS = envInt('POLL_INTERVAL_MS', 2000);
  private readonly CONFIRMATIONS = envInt('POLL_CONFIRMATIONS', 3);
  private readonly MAX_CHUNK = Math.max(envInt('POLL_MAX_BLOCK_RANGE', 5000), 10);
  private readonly MIN_CHUNK = 10;
  private readonly MAX_ADDRESSES_PER_QUERY = Math.max(envInt('POLL_MAX_ADDRESSES', 200), 1);
  /** Upper bound of chunks per loop iteration so status/health stay responsive during catch-up. */
  private readonly MAX_CHUNKS_PER_TICK = 20;

  constructor(context: UnifiedPollerContext) {
    this.context = context;
    this.chunkSize = this.MAX_CHUNK;
  }

  private get factoryAddress(): string {
    return this.context.factoryContract.target.toString().toLowerCase();
  }

  /**
   * Setup event topic mapping (from the ABI, so it also works before any launchpad exists)
   */
  private setupEventTopicMap(): void {
    const eventMappings: Array<{
      name: string;
      handler: (address: string, parsedLog: ethers.LogDescription, log: ethers.Log) => Promise<void>;
    }> = [
      // User Events
      { name: 'Transfer', handler: this.handleTransferEvent.bind(this) },
      { name: 'Burned', handler: this.handleBurnedEvent.bind(this) },
      { name: 'Airdropped', handler: this.handleAirdroppedEvent.bind(this) },
      { name: 'PhaseAdded', handler: this.handlePhaseAddedEvent.bind(this) },
      { name: 'PhaseUpdated', handler: this.handlePhaseUpdatedEvent.bind(this) },
      { name: 'PhaseRemoved', handler: this.handlePhaseRemovedEvent.bind(this) },
      { name: 'Revealed', handler: this.handleRevealedEvent.bind(this) },

      // Admin Events
      { name: 'TreasuryUpdated', handler: this.handleTreasuryUpdatedEvent.bind(this) },
      { name: 'Withdrawn', handler: this.handleWithdrawnEvent.bind(this) },
      { name: 'OwnershipTransferred', handler: this.handleOwnershipTransferredEvent.bind(this) },
      { name: 'PlatformFeeToggled', handler: this.handlePlatformFeeToggledEvent.bind(this) },
      { name: 'PlatformFlatFeeUpdated', handler: this.handlePlatformFlatFeeUpdatedEvent.bind(this) },
      { name: 'RoyaltyUpdated', handler: this.handleRoyaltyUpdatedEvent.bind(this) },

      // Metadata Events
      { name: 'BaseURIUpdated', handler: this.handleBaseURIUpdatedEvent.bind(this) },
      { name: 'ContractURIUpdated', handler: this.handleContractURIUpdatedEvent.bind(this) },
      { name: 'ExternalLinkUpdated', handler: this.handleExternalLinkUpdatedEvent.bind(this) },

      // Security Events
      { name: 'Paused', handler: this.handlePausedEvent.bind(this) },
      { name: 'Unpaused', handler: this.handleUnpausedEvent.bind(this) },
      { name: 'TransferLockUpdated', handler: this.handleTransferLockUpdatedEvent.bind(this) },
      { name: 'RoleGranted', handler: this.handleRoleGrantedEvent.bind(this) },
      { name: 'RoleRevoked', handler: this.handleRoleRevokedEvent.bind(this) },
    ];

    this.eventTopicMap = {};
    for (const mapping of eventMappings) {
      if (!this.context.enabledEvents.has(mapping.name)) continue;
      try {
        const eventFragment = launchpadInterface.getEvent(mapping.name);
        if (eventFragment) {
          this.eventTopicMap[eventFragment.topicHash] = {
            eventName: mapping.name,
            handler: mapping.handler
          };
        }
      } catch {
        // Event not in ABI, skip
      }
    }

    console.log(`📋 Mapped ${Object.keys(this.eventTopicMap).length} events for unified polling on chain ${this.context.chainId}`);
  }

  /** Reads the persisted cursor, or decides where a fresh deployment starts. */
  private async loadCursor(): Promise<number> {
    const { prisma } = await import('../../config/database');
    const factory = await prisma.launchpadFactory.findUnique({
      where: { contractAddress: this.factoryAddress },
      select: { lastProcessedBlock: true, lastProcessedBlockAt: true }
    });

    if (factory?.lastProcessedBlock != null) {
      console.log(`🔖 [Poller] Chain ${this.context.chainId}: resuming after block ${factory.lastProcessedBlock}` +
        (factory.lastProcessedBlockAt ? ` (saved ${factory.lastProcessedBlockAt.toISOString()})` : ''));
      return factory.lastProcessedBlock;
    }

    const configuredStart = parseInt(process.env[`START_BLOCK_${this.context.chainId}`] || '', 10);
    if (Number.isFinite(configuredStart) && configuredStart > 0) {
      console.log(`🔖 [Poller] Chain ${this.context.chainId}: no saved cursor, starting at configured block ${configuredStart}`);
      return configuredStart - 1;
    }

    const head = await this.context.provider.getBlockNumber();
    const start = Math.max(head - this.CONFIRMATIONS, 0);
    console.log(`🔖 [Poller] Chain ${this.context.chainId}: no saved cursor, starting at current block ${start}`);
    return start;
  }

  private async saveCursor(block: number): Promise<void> {
    const { prisma } = await import('../../config/database');
    try {
      await prisma.launchpadFactory.update({
        where: { contractAddress: this.factoryAddress },
        data: { lastProcessedBlock: block, lastProcessedBlockAt: new Date() }
      });
    } catch (dbError) {
      // Keep going: the in-memory cursor still advances; the DB catches up on the next save
      console.error(`❌ [Poller] Chain ${this.context.chainId}: failed to persist cursor ${block}:`, dbError);
    }
  }

  /**
   * Start unified polling
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn(`⚠️ Unified poller already running on chain ${this.context.chainId}, skipping start`);
      return;
    }

    this.setupEventTopicMap();
    this.cursor = await this.loadCursor();
    this.running = true;
    this.lastSuccessAt = Date.now();
    this.lastProgressAt = Date.now();
    this.scheduleNext(0);

    console.log(`✅ Unified event poller started on chain ${this.context.chainId} (interval ${this.POLL_INTERVAL_MS}ms, max range ${this.MAX_CHUNK} blocks, ${this.CONFIRMATIONS} confirmations)`);
  }

  /**
   * Kept for API compatibility: factory events are now read by the main loop.
   */
  async startFactoryPolling(): Promise<void> {
    return;
  }

  /**
   * Stop polling. Resolves after the in-flight iteration (if any) finishes.
   */
  stop(): void {
    this.running = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = undefined;
    }
  }

  async stopAndWait(): Promise<void> {
    this.stop();
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
    }
  }

  getHealth(): PollerHealth {
    return {
      running: this.running,
      cursorBlock: this.cursor,
      headBlock: this.head,
      lagBlocks: this.cursor !== null && this.head !== null ? Math.max(this.head - this.cursor, 0) : null,
      chunkSize: this.chunkSize,
      consecutiveErrors: this.consecutiveErrors,
      lastSuccessAt: this.lastSuccessAt,
      lastProgressAt: this.lastProgressAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
    };
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.loopTimer = setTimeout(() => {
      this.loopPromise = this.tick().finally(() => {
        this.loopPromise = null;
      });
    }, delayMs);
  }

  /**
   * One loop iteration: process up to MAX_CHUNKS_PER_TICK chunks, then reschedule.
   */
  private async tick(): Promise<void> {
    let nextDelay = this.POLL_INTERVAL_MS;
    try {
      // Handlers swallow their own errors, so check the database first: when it
      // is down the cursor must not move past events that could not be stored.
      const { prisma } = await import('../../config/database');
      await prisma.$queryRaw`SELECT 1`;

      const latest = await this.context.provider.getBlockNumber();
      this.head = latest;
      const target = latest - this.CONFIRMATIONS;

      let chunks = 0;
      while (this.running && this.cursor !== null && this.cursor < target && chunks < this.MAX_CHUNKS_PER_TICK) {
        const from = this.cursor + 1;
        const to = Math.min(from + this.chunkSize - 1, target);
        await this.processRange(from, to);
        this.cursor = to;
        await this.saveCursor(to);
        this.lastProgressAt = Date.now();
        chunks++;
        // Grow back towards the max range after a success
        if (this.chunkSize < this.MAX_CHUNK) {
          this.chunkSize = Math.min(this.chunkSize * 2, this.MAX_CHUNK);
        }
      }

      if (this.cursor !== null && this.cursor < target) {
        nextDelay = 0; // still catching up
      }
      this.consecutiveErrors = 0;
      this.lastSuccessAt = Date.now();
      this.lastProgressAt = Date.now();
    } catch (error) {
      this.consecutiveErrors++;
      this.lastErrorAt = Date.now();
      this.lastError = error instanceof Error ? error.message.slice(0, 300) : String(error);
      // Smaller ranges are the usual cure for "range too large"/timeout errors
      this.chunkSize = Math.max(Math.floor(this.chunkSize / 2), this.MIN_CHUNK);
      nextDelay = Math.min(1000 * 2 ** Math.min(this.consecutiveErrors - 1, 5), 30_000);
      console.error(`❌ [Poller] Chain ${this.context.chainId}: poll failed (attempt ${this.consecutiveErrors}, next range ${this.chunkSize} blocks, retry in ${nextDelay}ms): ${this.lastError}`);
    } finally {
      this.scheduleNext(nextDelay);
    }
  }

  /**
   * Process one block range completely. Throws if any RPC call fails so the
   * cursor does not move past unread blocks.
   */
  private async processRange(from: number, to: number): Promise<void> {
    // 1) Factory: new launchpads first, so their events in this same range are read below
    if (this.context.enabledEvents.has('ContractDeployed')) {
      const filter = this.context.factoryContract.filters.ContractDeployed();
      const deployed = await this.context.factoryContract.queryFilter(filter, from, to);
      if (deployed.length > 0) {
        console.log(`📦 [Factory] Found ${deployed.length} ContractDeployed event(s) in blocks ${from}-${to}`);
      }
      for (const event of deployed) {
        this.assertRunning();
        await this.handleFactoryEvent(event);
        this.lastProgressAt = Date.now();
      }
    }

    // 2) Launchpad events
    const topics = Object.keys(this.eventTopicMap);
    const addresses = Array.from(this.context.launchpadContracts.keys());
    if (topics.length === 0 || addresses.length === 0) return;

    const logs: ethers.Log[] = [];
    for (let i = 0; i < addresses.length; i += this.MAX_ADDRESSES_PER_QUERY) {
      const batch = addresses.slice(i, i + this.MAX_ADDRESSES_PER_QUERY);
      const part = await this.context.provider.getLogs({
        address: batch,
        topics: [topics], // OR over all enabled event topics
        fromBlock: from,
        toBlock: to
      });
      logs.push(...part);
    }

    if (logs.length === 0) return;

    // Chain order matters (mint before transfer, phase add before update, ...)
    logs.sort((a, b) => (a.blockNumber - b.blockNumber) || (a.index - b.index));
    console.log(`📦 [Poller] Found ${logs.length} events in blocks ${from}-${to} for ${addresses.length} contracts`);

    for (const log of logs) {
      this.assertRunning();
      await this.handleLaunchpadLog(log);
      this.lastProgressAt = Date.now();
    }
  }

  /** Abort a range when stopping so the cursor is not saved past unprocessed events. */
  private assertRunning(): void {
    if (!this.running) throw new Error('poller stopped');
  }

  private async handleFactoryEvent(event: ethers.Log | ethers.EventLog): Promise<void> {
    try {
      this.context.updateEventLiveness();
      if (!('args' in event) || !event.args) return;
      const [contractAddress, template, deployer, nonce] = event.args;

      console.log(`🎉 [Factory] ContractDeployed ${contractAddress} (deployer ${deployer}) at block ${event.blockNumber}`);

      if (this.context.handleContractDeployedEvent) {
        await this.context.handleContractDeployedEvent({
          contractAddress,
          template,
          deployer,
          nonce,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber
        });
      }

      // Make sure the new launchpad is polled from this range on, even if the
      // handler could not register it (e.g. a transient DB error)
      const address = String(contractAddress).toLowerCase();
      if (ethers.isAddress(address) && !this.context.launchpadContracts.has(address)) {
        this.context.launchpadContracts.set(
          address,
          new ethers.Contract(address, launchpadInterface, this.context.provider)
        );
      }
    } catch (error) {
      // A handler bug must not block the chain; the event is logged for replay
      console.error(`❌ [Factory] Error processing ContractDeployed at block ${event.blockNumber}:`, error);
    }
  }

  private async handleLaunchpadLog(log: ethers.Log): Promise<void> {
    try {
      this.context.updateEventLiveness();

      const eventMapping = this.eventTopicMap[log.topics[0]];
      if (!eventMapping) return;

      const parsedLog = launchpadInterface.parseLog({
        topics: log.topics as string[],
        data: log.data
      });
      if (!parsedLog) {
        console.warn(`⚠️ Could not parse log for ${log.address}`);
        return;
      }

      await eventMapping.handler(log.address.toLowerCase(), parsedLog, log);
    } catch (error) {
      // A handler bug must not block the chain
      console.error(`❌ [Poller] Error processing ${log.topics[0]?.slice(0, 10)} at block ${log.blockNumber} tx ${log.transactionHash}:`, error);
    }
  }

  // ========================================================================
  // Event Handlers - Route ke appropriate handler
  // ========================================================================

  private async handleTransferEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    const from = parsedLog.args[0];
    const to = parsedLog.args[1];
    const isZeroAddress = (addr: string) => addr.toLowerCase() === ethers.ZeroAddress.toLowerCase();
    const isMint = isZeroAddress(from);
    const isBurn = isZeroAddress(to);

    const transferType = isMint ? 'MINT' : isBurn ? 'BURN' : 'TRANSFER';
    console.log(`🎯 [Transfer:${transferType}] Event detected for contract ${address.slice(0, 10)}...`);
    console.log(`   └─ From: ${from}`);
    console.log(`   └─ To: ${to}`);
    console.log(`   └─ TokenId: ${parsedLog.args[2]}`);
    console.log(`   └─ Block: ${log.blockNumber}, TxHash: ${log.transactionHash}`);

    const transferData = {
      from,
      to,
      tokenId: parsedLog.args[2],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.index,
      launchpadAddress: address
    };

    // Route to appropriate handler based on transfer type
    if (isMint) {
      // Mint: from zero address
      if (this.context.handleMintEvent) {
        await this.context.handleMintEvent(transferData);
      } else {
        console.warn(`⚠️ handleMintEvent not provided in context`);
      }
    } else if (isBurn) {
      // Burn: to zero address - process NFT transfer only (ownership removal)
      if (this.context.handleNFTTransferOnly) {
        await this.context.handleNFTTransferOnly(transferData);
      } else {
        console.warn(`⚠️ handleNFTTransferOnly not provided in context for burn event`);
      }
    } else {
      // Regular transfer (e.g., OpenSea sale, wallet-to-wallet transfer)
      if (this.context.handleRegularTransferEvent) {
        await this.context.handleRegularTransferEvent(transferData);
      } else {
        console.warn(`⚠️ handleRegularTransferEvent not provided in context for transfer/sale event`);
      }
    }
  }

  private async handleBurnedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.userEventHandler.handleBurnedEvent({
      owner: parsedLog.args[0],
      tokenId: parsedLog.args[1],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleAirdroppedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.userEventHandler.handleAirdroppedEvent({
      operator: parsedLog.args[0],
      recipientCount: parsedLog.args[1],
      totalQuantity: parsedLog.args[2],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handlePhaseAddedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    try {
      // Validate that all required args exist before accessing them
      if (!parsedLog.args || parsedLog.args.length < 5) {
        console.error(`❌ PhaseAdded event has insufficient args: ${parsedLog.args?.length || 0} (expected 5)`);
        return;
      }

      await this.context.userEventHandler.handlePhaseAddedEvent({
        phaseId: parsedLog.args[0],
        name: parsedLog.args[1],
        startTime: parsedLog.args[2],
        endTime: parsedLog.args[3],
        price: parsedLog.args[4],
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        launchpadAddress: address
      });
    } catch (error) {
      console.error(`❌ Error handling PhaseAdded event:`, error);
      // Log the raw event data for debugging
      console.error(`   Raw args:`, parsedLog.args);
    }
  }

  private async handlePhaseUpdatedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    try {
      // Validate that all required args exist before accessing them
      if (!parsedLog.args || parsedLog.args.length < 5) {
        console.error(`❌ PhaseUpdated event has insufficient args: ${parsedLog.args?.length || 0} (expected 5)`);
        return;
      }

      await this.context.userEventHandler.handlePhaseUpdatedEvent({
        phaseId: parsedLog.args[0],
        name: parsedLog.args[1],
        startTime: parsedLog.args[2],
        endTime: parsedLog.args[3],
        price: parsedLog.args[4],
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        launchpadAddress: address
      });
    } catch (error) {
      console.error(`❌ Error handling PhaseUpdated event:`, error);
      // Log the raw event data for debugging
      console.error(`   Raw args:`, parsedLog.args);
    }
  }

  private async handlePhaseRemovedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.userEventHandler.handlePhaseRemovedEvent({
      phaseId: parsedLog.args[0],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleRevealedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.userEventHandler.handleRevealedEvent({
      baseURI: parsedLog.args[0],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleTreasuryUpdatedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.adminEventHandler.handleTreasuryUpdatedEvent({
      oldTreasury: parsedLog.args[0],
      newTreasury: parsedLog.args[1],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleWithdrawnEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.adminEventHandler.handleWithdrawnEvent({
      recipient: parsedLog.args[0],
      amount: parsedLog.args[1],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleOwnershipTransferredEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.adminEventHandler.handleOwnershipTransferredEvent({
      previousOwner: parsedLog.args[0],
      newOwner: parsedLog.args[1],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handlePlatformFeeToggledEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.adminEventHandler.handlePlatformFeeToggledEvent({
      enabled: parsedLog.args[0],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handlePlatformFlatFeeUpdatedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.adminEventHandler.handlePlatformFlatFeeUpdatedEvent({
      newFee: parsedLog.args[0],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleRoyaltyUpdatedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.adminEventHandler.handleRoyaltyUpdatedEvent({
      recipient: parsedLog.args[0],
      percentage: parsedLog.args[1],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleBaseURIUpdatedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.metadataEventHandler.handleBaseURIUpdatedEvent({
      newBaseURI: parsedLog.args[0],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleContractURIUpdatedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.metadataEventHandler.handleContractURIUpdatedEvent({
      newContractURI: parsedLog.args[0],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleExternalLinkUpdatedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.metadataEventHandler.handleExternalLinkUpdatedEvent({
      newExternalLink: parsedLog.args[0],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handlePausedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.securityEventHandler.handlePausedEvent({
      account: parsedLog.args[0],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleUnpausedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.securityEventHandler.handleUnpausedEvent({
      account: parsedLog.args[0],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleTransferLockUpdatedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.securityEventHandler.handleTransferLockUpdatedEvent({
      enabled: parsedLog.args[0],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleRoleGrantedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.securityEventHandler.handleRoleGrantedEvent({
      role: parsedLog.args[0],
      account: parsedLog.args[1],
      sender: parsedLog.args[2],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }

  private async handleRoleRevokedEvent(address: string, parsedLog: ethers.LogDescription, log: ethers.Log): Promise<void> {
    await this.context.securityEventHandler.handleRoleRevokedEvent({
      role: parsedLog.args[0],
      account: parsedLog.args[1],
      sender: parsedLog.args[2],
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
      launchpadAddress: address
    });
  }
}
