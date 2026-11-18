import { ethers } from 'ethers';
import { prisma, withRetry, withDbLimit } from '../../config/database';
import OddsLaunchpadFactoryABI from '../../../abi/OddsLaunchpadFactory.json';
import OddsLaunchpadABI from '../../../abi/OddsLaunchpad.json';
import { ActivityType } from '@prisma/client';
import { logError } from '../../utils/error-logger';
import { UserEventHandler, AdminEventHandler, MetadataEventHandler, SecurityEventHandler } from './event-handlers';
import type { HandlerContext } from './event-handlers';
import { NFTEventHandler } from './event-handlers/nft-events';
import { AlchemyNFTService } from '../alchemy-nft-service';
import { AlchemySpamDetector } from '../alchemy-spam-detector';
import { EventEmitter } from '../websocket/event-emitter';
import type { MintEventData, CollectionEventData, PhaseEventData } from '../websocket/event-emitter';
import { WebSocketConnectionPool } from './websocket-connection-pool';
import { UnifiedEventPoller } from './unified-event-poller';
import type { PollerHealth } from './unified-event-poller';
import { FailoverJsonRpcProvider } from './failover-provider';
import { getChainProvider } from './chain-provider';
import { MegaETHRealtimeSubscriber } from './megaeth-realtime-subscriber';

// WebSocket polyfill for Node.js environment
// Ethers v6 requires WebSocket to be available globally for wss:// connections
if (typeof WebSocket === 'undefined') {
  try {
    const WS = require('ws');
    (global as any).WebSocket = WS;
    console.log('✅ WebSocket polyfill loaded for Node.js');
  } catch (error) {
    console.warn('⚠️ WebSocket (ws) package not found. WSS connections will fail. Install with: npm install ws');
  }
}
import type {
  EventConfig,
  ActivityListenerConfig,
  ErrorCounter,
  ErrorSeverity,
  ErrorLogData,
  CollectionCreatedEvent,
  MintEvent,
  BurnedEvent,
  AirdroppedEvent,
  PhaseAddedEvent,
  PhaseUpdatedEvent,
  RevealedEvent,
  TreasuryUpdatedEvent,
  WithdrawnEvent,
  OwnershipTransferredEvent,
  PlatformFeeToggledEvent,
  PlatformFlatFeeUpdatedEvent,
  RoyaltyUpdatedEvent,
  BaseURIUpdatedEvent,
  ContractURIUpdatedEvent,
  ExternalLinkUpdatedEvent,
  PausedEvent,
  UnpausedEvent,
  TransferLockUpdatedEvent,
  RoleGrantedEvent,
  RoleRevokedEvent
} from './event-types';
// Import validation utilities (already extracted)
import {
  validateEventData,
  isValidTxHash,
  isValidAddress,
  isDuplicateActivity,
  sendAdminAlert as sendAdminAlertUtil,
  logEventError as logEventErrorUtil
} from './validation-utils';
import { delay } from './utils/validation-helpers';

// Re-export types for backward compatibility
export type { EventConfig, ActivityListenerConfig } from './event-types';

// ContractDeployed event interface (specific to this file)
interface ContractDeployedEvent {
  contractAddress: string;
  template: string;
  deployer: string;
  nonce: bigint;
  txHash: string;
  blockNumber: number;
}

// Default event configuration by phase
export const DEFAULT_EVENT_CONFIG: EventConfig[] = [
  // Phase 1: User-facing events (high priority)
  { eventName: 'Burned', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'Airdropped', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'PhaseAdded', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'PhaseUpdated', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'PhaseRemoved', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'Revealed', enabled: true, priority: 'high', phase: 1 },
  
  // Phase 2: Admin events (medium priority)
  { eventName: 'TreasuryUpdated', enabled: true, priority: 'medium', phase: 2 },
  { eventName: 'Withdrawn', enabled: true, priority: 'medium', phase: 2 },
  { eventName: 'OwnershipTransferred', enabled: true, priority: 'medium', phase: 2 },
  { eventName: 'PlatformFeeToggled', enabled: true, priority: 'medium', phase: 2 },
  { eventName: 'PlatformFlatFeeUpdated', enabled: true, priority: 'medium', phase: 2 },
  { eventName: 'RoyaltyUpdated', enabled: true, priority: 'medium', phase: 2 },
  
  // Phase 3: Metadata events (low priority)
  { eventName: 'BaseURIUpdated', enabled: true, priority: 'low', phase: 3 },
  { eventName: 'ContractURIUpdated', enabled: true, priority: 'low', phase: 3 },
  { eventName: 'ExternalLinkUpdated', enabled: true, priority: 'low', phase: 3 },
  
  // Phase 4: Security events (high priority)
  { eventName: 'Paused', enabled: true, priority: 'high', phase: 4 },
  { eventName: 'Unpaused', enabled: true, priority: 'high', phase: 4 },
  { eventName: 'TransferLockUpdated', enabled: true, priority: 'medium', phase: 4 },
  { eventName: 'RoleGranted', enabled: true, priority: 'medium', phase: 4 },
  { eventName: 'RoleRevoked', enabled: true, priority: 'medium', phase: 4 },
  
  // Existing events (for backward compatibility)
  { eventName: 'Transfer', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'LaunchpadCreated', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'ContractDeployed', enabled: true, priority: 'high', phase: 1 },
];

export class ActivityListener {
  private provider: ethers.JsonRpcProvider | ethers.WebSocketProvider;
  private factoryContract: ethers.Contract;
  private launchpadContracts: Map<string, ethers.Contract> = new Map();
  private config: ActivityListenerConfig;
  private isRunning: boolean = false;
  private retryCount: number = 0;
  private maxRetries: number = 5;
  private retryDelay: number = 1000; // Start with 1 second
  private enabledEvents: Set<string>;
  private errorThreshold: number;
  private maxDatabaseRetries: number;
  private errorCounters: Map<string, ErrorCounter> = new Map();
  private lastRateLimitLog: number = 0;
  private filterRecreationInterval?: NodeJS.Timeout;
  private lastFilterRecreation: number = 0;
  
  // WebSocket Connection Pool - allows 180 launchpads per connection
  private connectionPool?: WebSocketConnectionPool;
  private useConnectionPool: boolean = false;
  
  // WebSocket reconnection tracking
  private isReconnecting: boolean = false;
  
  // WebSocket keep-alive ping interval
  private wsPingInterval?: NodeJS.Timeout;
  private readonly WS_PING_INTERVAL_MS = 30000; // Ping every 30 seconds to keep connection alive
  
  // Polling intervals for event listening (used instead of provider.on() for WebSocket compatibility)
  private transferPollInterval?: NodeJS.Timeout;
  private factoryPollInterval?: NodeJS.Timeout;
  private readonly CRITICAL_EVENT_POLL_MS = 2000; // 2s for critical events (Transfer, Factory)
  private readonly NORMAL_EVENT_POLL_MS = 10000; // 10s for non-critical events (saves 80% RPC calls)
  
  // Concurrent processing control for large batches
  // Keep low to prevent database connection exhaustion
  private activeMintProcessing: number = 0;
  private readonly MAX_CONCURRENT_MINTS: number = 10; // Keep low, DB semaphore handles actual limiting
  private readonly MAX_QUEUE_SIZE: number = 2000; // Large queue to handle batch mints
  private mintQueue: Array<() => Promise<void>> = [];
  private droppedMintCount: number = 0; // Track dropped mints due to queue overflow
  
  // Event tracking for debugging batch mints
  private mintEventsReceived: number = 0;
  private mintEventsProcessed: number = 0;
  private lastBatchTxHash: string = '';
  private lastBatchTokenIds: Set<string> = new Set();
  
  // Event liveness tracking - detect silent disconnects (WebSocket only)
  // HTTP polling doesn't need this because each request is a fresh connection
  private lastEventReceivedAt: number = Date.now();
  private livenessCheckInterval?: NodeJS.Timeout;
  private readonly LIVENESS_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
  private readonly EVENT_STALE_THRESHOLD_MS = 180000; // Consider stale if no events for 3 minutes
  private consecutiveStaleChecks: number = 0;
  private readonly MAX_STALE_CHECKS_BEFORE_RESUBSCRIBE = 2; // Resubscribe after 2 consecutive stale checks (6 minutes total)
  
  // Batch mint tracking - group mints by transaction hash
  private batchMintsByTxHash: Map<string, {
    contractAddress: string;
    minter: string;
    tokenIds: string[];
    timestamp: Date;
    imageUrl?: string;
  }> = new Map();
  private batchMintTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly BATCH_MINT_DELAY = 500; // Wait 2 seconds before emitting batch
  
  // RPC rotation for load balancing
  private rpcRotationInterval?: NodeJS.Timeout;
  private readonly RPC_ROTATION_INTERVAL_MS = 300000; // 5 minutes
  private rpcUrls: string[];
  
  // Event handlers
  private userEventHandler: UserEventHandler;
  private adminEventHandler: AdminEventHandler;
  private metadataEventHandler: MetadataEventHandler;
  private securityEventHandler: SecurityEventHandler;
  private nftEventHandler: NFTEventHandler;
  
  // WebSocket event emitter (optional - only initialized if WebSocket manager is available)
  private eventEmitter?: EventEmitter;
  
  // Unified event poller - single polling cycle for all events
  private unifiedPoller?: UnifiedEventPoller;
  
  // MegaETH Realtime Subscriber - for real-time mini-block event streaming
  private megaethSubscriber?: MegaETHRealtimeSubscriber;
  
  // In-memory lock to prevent duplicate ContractDeployed processing due to race conditions
  // Key: txHash, Value: timestamp when processing started
  private processingContractDeployedEvents: Set<string> = new Set();

  constructor(config: ActivityListenerConfig, eventEmitter?: EventEmitter) {
    this.config = config;
    
    // Store RPC URLs for rotation
    this.rpcUrls = config.rpcUrls && config.rpcUrls.length > 0 
      ? config.rpcUrls 
      : [config.rpcUrl];
    
    // Initialize event configuration
    this.enabledEvents = this.initializeEnabledEvents(config.enabledEvents);
    this.errorThreshold = config.errorThreshold ?? 10;
    this.maxDatabaseRetries = config.retryAttempts ?? 3;
    
    // Initialize handler context
    const handlerContext: HandlerContext = {
      chainId: config.chainId,
      retryAttempts: this.maxDatabaseRetries,
      errorCounters: this.errorCounters,
      errorThreshold: this.errorThreshold,
      sendAdminAlert: this.sendAdminAlert.bind(this),
      ensureLaunchpadRegistered: this.ensureLaunchpadRegistered.bind(this),
      autoSyncLaunchpad: this.autoSyncLaunchpad.bind(this),
      eventEmitter: eventEmitter
    };
    
    // Initialize event handlers
    this.userEventHandler = new UserEventHandler(handlerContext);
    this.adminEventHandler = new AdminEventHandler(handlerContext);
    this.metadataEventHandler = new MetadataEventHandler(handlerContext);
    this.securityEventHandler = new SecurityEventHandler(handlerContext);
    
    // Initialize Alchemy services for NFT metadata
    const alchemyApiKey = process.env.ALCHEMY_API_KEY || process.env[`ALCHEMY_API_KEY_${config.chainId}`];
    const alchemyNetwork = this.getAlchemyNetwork(config.chainId);
    
    const alchemyService = new AlchemyNFTService({
      apiKey: alchemyApiKey || '',
      network: alchemyNetwork ?? undefined // Convert null to undefined
    });
    
    const spamDetector = new AlchemySpamDetector(alchemyService);
    
    // Initialize NFT event handler
    this.nftEventHandler = new NFTEventHandler({
      ...handlerContext,
      alchemyService,
      spamDetector,
      isAlchemySupported: alchemyNetwork !== null // Alchemy supported if network mapping exists
    });
    
    // Configure EventProcessor to use this ActivityListener's mint handler
    // This wires the EventProcessor (used by WebSocketManager) to call our processMintFromEventProcessor method
    // Requirements: 6.1, 6.4
    const { eventProcessor } = require('../processors/event-processor');
    eventProcessor.setMintEventHandler((data: any) => this.processMintFromEventProcessor(data));
    console.log(`[ActivityListener] Configured EventProcessor for chain ${config.chainId}`);
    
    // Initialize WebSocket event emitter if provided
    if (eventEmitter) {
      this.eventEmitter = eventEmitter;
      console.log(`🔌 WebSocket event emitter initialized for chain ${config.chainId}`);
    }
    
    // Initialize provider - use WebSocket Connection Pool for ws:// or wss://
    const isWebSocket = config.rpcUrl.startsWith('ws://') || config.rpcUrl.startsWith('wss://');
    const launchpadCount = config.launchpadAddresses?.length || 0;
    
    if (isWebSocket) {
      // Use Connection Pool for WebSocket - each connection supports 10 launchpads (~200 subscriptions)
      this.useConnectionPool = true;
      this.connectionPool = new WebSocketConnectionPool(config.rpcUrl, config.chainId);
      
      // Create a default provider for factory contract (doesn't count against limit)
      this.provider = new ethers.WebSocketProvider(config.rpcUrl);
      console.log(`🏊 Using WebSocket Connection Pool for chain ${config.chainId}`);
      console.log(`   └─ Max launchpads per connection: 10 (~200 subscriptions per connection)`);
      console.log(`   └─ Initial launchpads: ${launchpadCount}`);
      console.log(`   └─ Estimated connections needed: ${Math.ceil(launchpadCount / 10) || 1}`);
      
      // WebSocket error handling for factory provider
      try {
        const ws = (this.provider as any)._websocket || (this.provider as any).websocket;
        if (ws) {
          ws.on('error', (error: any) => {
            console.error(`❌ WebSocket error on chain ${config.chainId}:`, error?.message || error);
          });
          
          ws.on('close', (code: number) => {
            console.warn(`⚠️ WebSocket closed on chain ${config.chainId} with code ${code}`);
          });
        }
      } catch (wsError) {
        console.log(`ℹ️ WebSocket error handlers not available for chain ${config.chainId}`);
      }
    } else {
      // HTTP provider with automatic failover across every configured RPC.
      // All contracts share this provider, so every read benefits from failover.
      this.useConnectionPool = false;
      this.provider = getChainProvider(config.chainId, this.rpcUrls);
      console.log(`📡 Using HTTP polling for chain ${config.chainId} (${launchpadCount} launchpads)`);
    }
    
    // Validate factory address before creating contract (prevents ENS resolution on non-ENS chains)
    if (!ethers.isAddress(config.factoryAddress)) {
      throw new Error(`Invalid factory address: ${config.factoryAddress}. Must be a valid Ethereum address (0x...)`);
    }

    // Initialize factory contract (uses default provider, not pool)
    this.factoryContract = new ethers.Contract(
      config.factoryAddress,
      OddsLaunchpadFactoryABI,
      this.provider
    );

    // Initialize launchpad contracts - use pool for WebSocket
    if (config.launchpadAddresses && config.launchpadAddresses.length > 0) {
      if (this.useConnectionPool && this.connectionPool) {
        // Use connection pool for WebSocket - each connection handles up to 180 launchpads
        this.launchpadContracts = this.connectionPool.initializeLaunchpads(
          config.launchpadAddresses,
          OddsLaunchpadABI
        );
      } else {
        // HTTP provider - use single provider for all launchpads
        for (const address of config.launchpadAddresses) {
          if (!ethers.isAddress(address)) {
            console.warn(`⚠️ Skipping invalid launchpad address: ${address}`);
            continue;
          }
          const contract = new ethers.Contract(
            address,
            OddsLaunchpadABI,
            this.provider
          );
          this.launchpadContracts.set(address.toLowerCase(), contract);
        }
      }
    }
  }

  /**
   * Initialize enabled events set based on configuration
   * If no specific events are provided, use all enabled events from DEFAULT_EVENT_CONFIG
   */
  private initializeEnabledEvents(configuredEvents?: string[]): Set<string> {
    if (configuredEvents && configuredEvents.length > 0) {
      // Use explicitly configured events
      return new Set(configuredEvents);
    }
    
    // Use all enabled events from default configuration
    return new Set(
      DEFAULT_EVENT_CONFIG
        .filter(config => config.enabled)
        .map(config => config.eventName)
    );
  }

  /**
   * Get Alchemy network name for a given chain ID
   * @param chainId - The chain ID
   * @returns Alchemy network name
   */
  private getAlchemyNetwork(chainId: number): string | null {
    const networkMap: Record<number, string> = {
      1: 'eth-mainnet',
      11155111: 'eth-sepolia',
      137: 'polygon-mainnet',
      80002: 'polygon-amoy',
      56: 'bnb-mainnet',
      97: 'bnb-testnet',
      42161: 'arb-mainnet',
      421614: 'arb-sepolia',
      10: 'opt-mainnet',
      11155420: 'opt-sepolia',
      8453: 'base-mainnet',
      84532: 'base-sepolia',
      // MegaETH and Monad are not supported by Alchemy NFT API
      // Return null to skip Alchemy and use direct contract calls
    };
    
    return networkMap[chainId] || null;
  }

  /**
   * Get appropriate delay based on provider type and number of launchpads
   * HTTP providers need longer delays to avoid rate limits
   */
  private getSetupDelay(): number {
    const isHttpProvider = !(this.provider instanceof ethers.WebSocketProvider);
    const launchpadCount = this.launchpadContracts.size;
    
    if (isHttpProvider) {
      // HTTP providers need much longer delays, especially for MegaETH with strict limits
      if (launchpadCount > 15) {
        return 1000; // 1 second for many launchpads (MegaETH)
      } else if (launchpadCount > 10) {
        return 700; // 700ms for moderate number
      } else {
        return 400; // 400ms for few launchpads
      }
    } else {
      // WebSocket providers can be faster
      return 100;
    }
  }

  /**
   * Setup event listeners for all launchpad contracts with rate limiting
   * @param eventName - Name of the event to listen to
   * @param filterFactory - Function to create the event filter
   * @param handler - Event handler function
   * @param currentBlock - Block number to start listening from
   */
  private async setupLaunchpadEventListeners<T extends any[]>(
    eventName: string,
    filterFactory: (contract: ethers.Contract) => ethers.ContractEventName,
    handler: (address: string, currentBlock: number, ...args: [...T, ethers.EventLog]) => Promise<void>
  ): Promise<void> {
    const currentBlock = await this.provider.getBlockNumber();
    const setupDelay = this.getSetupDelay();
    let index = 0;

    for (const [address, contract] of this.launchpadContracts.entries()) {
      // Add delay between setting up listeners to avoid rate limits
      if (index > 0) {
        await delay(setupDelay);
      }

      try {
        const filter = filterFactory(contract);
        
        contract.on(filter, async (...args: [...T, ethers.EventLog]) => {
          try {
            // Update liveness tracking - we received an event
            this.updateEventLiveness();
            
            const event = args[args.length - 1] as ethers.EventLog;
            
            // Validate event object
            if (!event) {
              console.warn(`⚠️ Event object is null/undefined for ${eventName} on ${address}`);
              return;
            }
            
            // Check if event has required properties
            if (!event.blockNumber || !event.transactionHash) {
              console.warn(`⚠️ Invalid event data for ${eventName} on ${address} - missing blockNumber or txHash`);
              return;
            }
            
            const blockNumber = event.blockNumber;
            const transactionHash = event.transactionHash;
            
            // Only process events from current block onwards
            if (blockNumber >= currentBlock) {
              await handler(address, currentBlock, ...args);
            }
          } catch (handlerError) {
            console.error(`❌ Error processing ${eventName} event on ${address}:`, handlerError);
            // Don't throw - continue processing other events
          }
        });

        index++;
      } catch (error) {
        console.error(`❌ Error setting up ${eventName} listener for ${address}:`, error);
        // Continue with other contracts even if one fails
      }
    }

    console.log(`✅ Listening to NEW ${eventName} events on chain ${this.config.chainId} (from block ${currentBlock})`);
  }

  /**
   * Increment error counter for a specific event type and trigger alert if threshold exceeded
   * @param eventType - The type of event that encountered an error
   */
  private incrementErrorCounter(eventType: string): void {
    const counter = this.errorCounters.get(eventType) || {
      eventType,
      count: 0,
      lastError: new Date(),
      threshold: this.errorThreshold
    };

    counter.count++;
    counter.lastError = new Date();

    this.errorCounters.set(eventType, counter);

    // Check if threshold exceeded
    if (counter.count >= counter.threshold) {
      this.sendAdminAlert({
        type: 'EVENT_HANDLER_FAILURE',
        eventType,
        errorCount: counter.count,
        lastError: counter.lastError,
        chainId: this.config.chainId
      });

      // Reset counter after alert
      counter.count = 0;
      this.errorCounters.set(eventType, counter);
    }
  }

  /**
   * Send alert to administrators about critical errors
   * @param alertData - Alert information
   */
  private sendAdminAlert(alertData: {
    type: string;
    eventType: string;
    errorCount: number;
    lastError: Date;
    chainId: number;
  }): void {
    // Log critical alert
    console.error('🚨 ADMIN ALERT:', {
      ...alertData,
      message: `Event handler for ${alertData.eventType} has failed ${alertData.errorCount} times on chain ${alertData.chainId}`
    });

    // In production, this would send notifications via email, Slack, PagerDuty, etc.
    // For now, we use the centralized error logger with critical severity
    logError(
      `ActivityListener.AdminAlert`,
      new Error(`Event handler failure threshold exceeded for ${alertData.eventType}`),
      alertData,
      'critical'
    );
  }

  /**
   * Log event processing error with full context
   * @param eventType - The type of event that encountered an error
   * @param error - The error that occurred
   * @param eventData - The event data being processed
   * @param severity - Error severity level
   */
  private async logEventError(
    eventType: string,
    error: any,
    eventData: any,
    severity: ErrorSeverity = 'medium'
  ): Promise<void> {
    try {
      const errorLogData: ErrorLogData = {
        eventType,
        eventData,
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        severity,
        timestamp: new Date(),
        chainId: this.config.chainId,
        txHash: eventData?.txHash,
        blockNumber: eventData?.blockNumber
      };

      // Use centralized error logger
      logError(
        `ActivityListener.${eventType}`,
        error,
        errorLogData,
        severity
      );

      // Increment error counter for this event type
      this.incrementErrorCounter(eventType);

    } catch (logErr) {
      console.error('Failed to log event error:', logErr);
    }
  }

  /**
   * Check if an event is enabled for this listener
   */
  private isEventEnabled(eventName: string): boolean {
    return this.enabledEvents.has(eventName);
  }

  /**
   * Register all event handlers based on configuration
   * Strategy: ALWAYS use polling, optionally try WebSocket for real-time Transfer events
   * Requirements: 16.2
   */
  private async registerEventHandlers(): Promise<void> {
    console.log(`📋 Registering event handlers for chain ${this.config.chainId}`);
    console.log(`   Enabled events: ${Array.from(this.enabledEvents).join(', ')}`);

    // ALWAYS setup polling - this is the reliable fallback
    console.log(`📊 Using UnifiedEventPoller for chain ${this.config.chainId}`);
    
    // Stop existing unified poller if any (prevent duplicates). Wait for the
    // in-flight iteration so two pollers never write the cursor at once.
    if (this.unifiedPoller) {
      console.log(`🛑 Stopping existing unified poller before creating new one`);
      await this.unifiedPoller.stopAndWait();
    }

    // Create unified event poller
    this.unifiedPoller = new UnifiedEventPoller({
      chainId: this.config.chainId,
      provider: this.provider,
      factoryContract: this.factoryContract,
      launchpadContracts: this.launchpadContracts,
      enabledEvents: this.enabledEvents,
      userEventHandler: this.userEventHandler,
      adminEventHandler: this.adminEventHandler,
      metadataEventHandler: this.metadataEventHandler,
      securityEventHandler: this.securityEventHandler,
      updateEventLiveness: () => this.updateEventLiveness(),
      handleMintEvent: (data) => this.handleMintEvent(data),
      handleRegularTransferEvent: (data) => this.handleRegularTransferEvent(data),
      handleNFTTransferOnly: (data) => this.handleNFTTransferOnly(data),
      handleContractDeployedEvent: (data) => this.handleContractDeployedEvent(data)
    });

    // Start unified polling for launchpad events
    await this.unifiedPoller.start();

    // Start factory polling (separate karena contract berbeda)
    if (this.isEventEnabled('ContractDeployed') || this.isEventEnabled('LaunchpadCreated')) {
      await this.unifiedPoller.startFactoryPolling();
    }

    // OPTIONALLY try MegaETH Realtime API for real-time Transfer events
    // If it fails (eth_subscribe not supported), polling will handle everything
    const isWebSocket = this.config.rpcUrl.startsWith('ws://') || this.config.rpcUrl.startsWith('wss://');
    if (isWebSocket && this.config.chainId === 6343) {
      console.log(`ℹ️ MegaETH (chain 6343): WebSocket available but eth_subscribe not supported`);
      console.log(`   └─ Using polling-only strategy (more reliable)`);
      console.log(`   └─ Polling interval: 2 seconds`);
      // Don't attempt WebSocket subscription - it will fail
      // Polling is already running and works perfectly
    }

    console.log(`✅ Event handlers registered for chain ${this.config.chainId}`);
  }
  
  /**
   * Setup MegaETH Realtime Subscriber for real-time event streaming
   * @param overrideWsUrl - Optional WSS URL to use instead of config.rpcUrl
   */
  private async setupMegaETHSubscriber(overrideWsUrl?: string): Promise<void> {
    // Disconnect existing subscriber if any
    if (this.megaethSubscriber) {
      await this.megaethSubscriber.disconnect();
    }
    
    // Use override URL if provided, otherwise use config URL
    const wsUrl = overrideWsUrl || this.config.rpcUrl;
    
    // Get launchpad contract addresses only (NOT factory)
    // NOTE: Factory ContractDeployed events are handled by startFactoryPolling() in UnifiedEventPoller
    // Adding factory here would cause duplicate activity inserts due to race condition
    const addresses = Array.from(this.launchpadContracts.keys());

    if (addresses.length === 0) {
      console.warn(`⚠️ No launchpad contracts to subscribe to (factory events handled by polling)`);
      return;
    }

    
    // Get all event topics
    const topics: string[] = [];
    const sampleContract = this.launchpadContracts.values().next().value;
    
    if (sampleContract) {
      for (const eventName of this.enabledEvents) {
        try {
          const eventFragment = sampleContract.interface.getEvent(eventName);
          if (eventFragment) {
            topics.push(eventFragment.topicHash);
          }
        } catch (error) {
          // Event not in ABI, skip
        }
      }
    }
    
    console.log(`🔌 Setting up MegaETH Realtime Subscriber:`);
    console.log(`   └─ Contracts: ${addresses.length}`);
    console.log(`   └─ Events: ${topics.length}`);
    
    // Create subscriber
    this.megaethSubscriber = new MegaETHRealtimeSubscriber({
      wsUrl: wsUrl,
      provider: this.provider, // Pass the provider to fetch blocks/receipts
      chainId: this.config.chainId,
      addresses,
      topics,

      onLog: async (log) => {
        try {
          this.updateEventLiveness();
          
          // Get contract for this address (Factory or Launchpad)
          let contract = this.launchpadContracts.get(log.address.toLowerCase());
          
          // Check if it's the factory contract
          if (!contract && log.address.toLowerCase() === this.config.factoryAddress.toLowerCase()) {
            contract = this.factoryContract;
          }

          if (!contract) {
            console.warn(`⚠️ No contract found for address ${log.address}`);
            return;
          }

          
          // Parse log
          const parsedLog = contract.interface.parseLog({
            topics: log.topics as string[],
            data: log.data
          });
          
          if (!parsedLog) {
            console.warn(`⚠️ Could not parse log for ${log.address}`);
            return;
          }
          
          console.log(`✅ [MegaETH] Processing ${parsedLog.name} event from ${log.address.slice(0, 10)}...`);
          
          // Route to appropriate handler
          await this.routeEventToHandler(log.address.toLowerCase(), parsedLog, log);
          
        } catch (error) {
          console.error(`❌ Error processing MegaETH log:`, error);
        }
      },
      onError: (error) => {
        console.error(`❌ MegaETH subscriber error:`, error);
      },
      onConnect: () => {
        console.log(`✅ MegaETH Realtime API connected`);
      },
      onDisconnect: () => {
        console.warn(`⚠️ MegaETH Realtime API disconnected`);
      }
    });
    
    // Connect to MegaETH
    await this.megaethSubscriber.connect();
  }
  
  /**
   * Route event to appropriate handler based on event name
   * 
   * NOTE: This is the MegaETH Realtime Subscriber path.
   * log.blockNumber and log.logIndex are hex strings from MegaETH subscriber,
   * so they need parseInt(x, 16) conversion.
   */
  private async routeEventToHandler(address: string, parsedLog: ethers.LogDescription, log: any): Promise<void> {
    const eventName = parsedLog.name;

    // Helper to safely parse hex block number (MegaETH subscriber sends hex)
    const parseBlockNumber = (bn: any): number => {
      if (typeof bn === 'number') return bn;
      if (typeof bn === 'string') return parseInt(bn, 16) || 0;
      return Number(bn) || 0;
    };
    const parseLogIndex = (li: any): number => {
      if (typeof li === 'number') return li;
      if (typeof li === 'string') return parseInt(li, 16) || 0;
      return Number(li) || 0;
    };
    
    // Transfer event (mint/transfer/burn)
    if (eventName === 'Transfer') {
      const from = parsedLog.args[0];
      const to = parsedLog.args[1];
      const isZeroAddress = (addr: string) => addr.toLowerCase() === ethers.ZeroAddress.toLowerCase();
      const isMint = isZeroAddress(from);
      const isBurn = isZeroAddress(to);
      
      const transferData = {
        from,
        to,
        tokenId: parsedLog.args[2],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        logIndex: parseLogIndex(log.logIndex),
        launchpadAddress: address
      };
      
      // Route to appropriate handler based on transfer type
      if (isMint) {
        await this.handleMintEvent(transferData);
      } else if (isBurn) {
        // Burn is handled by userEventHandler, but we still need to process NFT transfer
        await this.handleNFTTransferOnly(transferData);
      } else {
        // Regular transfer (e.g., OpenSea sale)
        await this.handleRegularTransferEvent(transferData);
      }
      return;
    }
    
    // ========================================================================
    // User Events
    // ========================================================================
    if (eventName === 'Burned') {
      await this.userEventHandler.handleBurnedEvent({
        owner: parsedLog.args[0],
        tokenId: parsedLog.args[1],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }
    
    if (eventName === 'Airdropped') {
      await this.userEventHandler.handleAirdroppedEvent({
        operator: parsedLog.args[0],
        recipientCount: parsedLog.args[1],
        totalQuantity: parsedLog.args[2],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'PhaseAdded') {
      if (!parsedLog.args || parsedLog.args.length < 5) {
        console.error(`❌ [MegaETH] PhaseAdded event has insufficient args: ${parsedLog.args?.length || 0} (expected 5)`);
        return;
      }
      await this.userEventHandler.handlePhaseAddedEvent({
        phaseId: parsedLog.args[0],
        name: parsedLog.args[1],
        startTime: parsedLog.args[2],
        endTime: parsedLog.args[3],
        price: parsedLog.args[4],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'PhaseUpdated') {
      if (!parsedLog.args || parsedLog.args.length < 5) {
        console.error(`❌ [MegaETH] PhaseUpdated event has insufficient args: ${parsedLog.args?.length || 0} (expected 5)`);
        return;
      }
      await this.userEventHandler.handlePhaseUpdatedEvent({
        phaseId: parsedLog.args[0],
        name: parsedLog.args[1],
        startTime: parsedLog.args[2],
        endTime: parsedLog.args[3],
        price: parsedLog.args[4],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'PhaseRemoved') {
      await this.userEventHandler.handlePhaseRemovedEvent({
        phaseId: parsedLog.args[0],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'Revealed') {
      await this.userEventHandler.handleRevealedEvent({
        baseURI: parsedLog.args[0],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    // ========================================================================
    // Factory Events
    // ========================================================================
    if (eventName === 'ContractDeployed') {
      await this.handleContractDeployedEvent({
        contractAddress: parsedLog.args[0],
        template: parsedLog.args[1],
        deployer: parsedLog.args[2],
        nonce: parsedLog.args[3],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber)
      });
      return;
    }

    if (eventName === 'LaunchpadCreated') {
      console.log(`ℹ️ LaunchpadCreated event received from ${address}`);
      return;
    }

    // ========================================================================
    // Admin Events
    // ========================================================================
    if (eventName === 'TreasuryUpdated') {
      await this.adminEventHandler.handleTreasuryUpdatedEvent({
        oldTreasury: parsedLog.args[0],
        newTreasury: parsedLog.args[1],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'Withdrawn') {
      await this.adminEventHandler.handleWithdrawnEvent({
        recipient: parsedLog.args[0],
        amount: parsedLog.args[1],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'OwnershipTransferred') {
      await this.adminEventHandler.handleOwnershipTransferredEvent({
        previousOwner: parsedLog.args[0],
        newOwner: parsedLog.args[1],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'PlatformFeeToggled') {
      await this.adminEventHandler.handlePlatformFeeToggledEvent({
        enabled: parsedLog.args[0],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'PlatformFlatFeeUpdated') {
      await this.adminEventHandler.handlePlatformFlatFeeUpdatedEvent({
        newFee: parsedLog.args[0],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'RoyaltyUpdated') {
      await this.adminEventHandler.handleRoyaltyUpdatedEvent({
        recipient: parsedLog.args[0],
        percentage: parsedLog.args[1],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    // ========================================================================
    // Metadata Events
    // ========================================================================
    if (eventName === 'BaseURIUpdated') {
      await this.metadataEventHandler.handleBaseURIUpdatedEvent({
        newBaseURI: parsedLog.args[0],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'ContractURIUpdated') {
      await this.metadataEventHandler.handleContractURIUpdatedEvent({
        newContractURI: parsedLog.args[0],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'ExternalLinkUpdated') {
      await this.metadataEventHandler.handleExternalLinkUpdatedEvent({
        newExternalLink: parsedLog.args[0],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    // ========================================================================
    // Security Events
    // ========================================================================
    if (eventName === 'Paused') {
      await this.securityEventHandler.handlePausedEvent({
        account: parsedLog.args[0],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'Unpaused') {
      await this.securityEventHandler.handleUnpausedEvent({
        account: parsedLog.args[0],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'TransferLockUpdated') {
      await this.securityEventHandler.handleTransferLockUpdatedEvent({
        enabled: parsedLog.args[0],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'RoleGranted') {
      await this.securityEventHandler.handleRoleGrantedEvent({
        role: parsedLog.args[0],
        account: parsedLog.args[1],
        sender: parsedLog.args[2],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    if (eventName === 'RoleRevoked') {
      await this.securityEventHandler.handleRoleRevokedEvent({
        role: parsedLog.args[0],
        account: parsedLog.args[1],
        sender: parsedLog.args[2],
        txHash: log.transactionHash,
        blockNumber: parseBlockNumber(log.blockNumber),
        launchpadAddress: address
      });
      return;
    }

    console.log(`ℹ️ Event ${eventName} received but no specific handler configured`);
  }

  /**
   * Recreate all event filters to prevent expiration
   * Filters typically expire after 5 minutes of inactivity on most RPC providers
   */
  private async recreateFilters(): Promise<void> {
    // Only recreate for HTTP providers (WebSocket doesn't use filters)
    if (this.provider instanceof ethers.WebSocketProvider) {
      return;
    }

    // Prevent recreation if done recently (within last 3 minutes)
    const now = Date.now();
    if (this.lastFilterRecreation && (now - this.lastFilterRecreation) < 180000) {
      return;
    }

    try {
      console.log(`🔄 Recreating event filters for chain ${this.config.chainId} to prevent expiration...`);
      
      // Remove all existing listeners
      this.factoryContract.removeAllListeners();
      this.launchpadContracts.forEach((contract) => {
        contract.removeAllListeners();
      });

      // Re-register all event handlers
      await this.registerEventHandlers();
      
      this.lastFilterRecreation = now;
      console.log(`✅ Event filters recreated for chain ${this.config.chainId}`);
    } catch (error) {
      console.error(`❌ Error recreating filters for chain ${this.config.chainId}:`, error);
      // Don't throw - let the listener continue with existing filters
    }
  }

  /**
   * Start listening to all events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`⚠️ Activity listener for chain ${this.config.chainId} is already running`);
      return;
    }
    this.stopped = false;

    try {
      console.log(`🎧 Starting activity listener for chain ${this.config.chainId}`);
      
      // Test connection with timeout
      await this.testConnectionWithTimeout();
      
      this.isRunning = true;
      this.retryCount = 0;

      // Setup WebSocket event handlers for auto-reconnection (no polling, event-based only)
      this.setupWebSocketReconnection();

      // Register all event handlers based on configuration
      await this.registerEventHandlers();

      // Setup MegaETH Realtime Subscriber
      // SPECIAL CASE: MegaETH (Chain 6343) needs WebSocket even if RPC is HTTP
      const isMegaETH = this.config.chainId === 6343;
      const isWebSocket = this.config.rpcUrl.startsWith('ws://') || this.config.rpcUrl.startsWith('wss://');
      
      if (isWebSocket || isMegaETH) {
         try {
           // For MegaETH, use hardcoded WSS URL if config provides HTTP
           // TODO: Remove hardcode when wssUrl column is added to DB
           let wsUrl = this.config.rpcUrl;
           if (isMegaETH && !isWebSocket) {
             wsUrl = 'wss://timothy.megaeth.com/ws';
             console.log(`ℹ️ [MegaETH] Using hardcoded WSS URL: ${wsUrl}`);
           }

           await this.setupMegaETHSubscriber(wsUrl);
           console.log(`✅ MegaETH Realtime Subscriber setup complete for chain ${this.config.chainId}`);
         } catch (wsError) {
           console.error(`❌ Failed to setup MegaETH subscriber:`, wsError);
           // Don't fail the whole listener, just log error. Polling will still work.
         }
      }

      // NOTE: no periodic filter recreation / RPC rotation for HTTP providers.
      // The poller uses stateless eth_getLogs with a persisted cursor (nothing
      // expires), and FailoverJsonRpcProvider switches RPCs per request.
      // Recreating the poller used to restart it from the current block and
      // silently skip the blocks in between.

      // Start event liveness check to detect silent disconnects (WebSocket only)
      this.startLivenessCheck();

      console.log(`✅ Activity listener started for chain ${this.config.chainId}`);
    } catch (error) {
      console.error(`❌ Failed to start activity listener for chain ${this.config.chainId}:`, error);
      this.isRunning = false;
      await this.logActivityError('start', error);
      // Keep retrying in the background; never give up on a chain
      this.scheduleRestart(error);
      throw error;
    }
  }

  /**
   * Start event liveness check to detect silent disconnects
   * If no events received for a period, re-subscribe to events
   * 
   * Note: Only enabled for WebSocket connections. HTTP polling doesn't need liveness check
   * because each poll is a fresh connection that will fail immediately if there's an issue.
   */
  private startLivenessCheck(): void {
    // Skip liveness check for HTTP providers (polling)
    // Polling uses stateless HTTP requests that fail immediately if there's a connection issue
    // Silent disconnects only happen with persistent WebSocket connections
    const isHttpProvider = !(this.provider instanceof ethers.WebSocketProvider);
    if (isHttpProvider) {
      console.log(`ℹ️ Chain ${this.config.chainId}: Liveness check disabled for HTTP polling (not needed for stateless requests)`);
      return;
    }
    
    // Clear existing interval if any
    this.stopLivenessCheck();
    
    // Reset tracking
    this.lastEventReceivedAt = Date.now();
    this.consecutiveStaleChecks = 0;

    this.livenessCheckInterval = setInterval(async () => {
      const now = Date.now();
      const timeSinceLastEvent = now - this.lastEventReceivedAt;
      
      // Log status periodically
      const minutesSinceLastEvent = Math.round(timeSinceLastEvent / 60000);
      console.log(`🔍 Chain ${this.config.chainId} WebSocket liveness check: ${minutesSinceLastEvent}m since last event, ${this.mintEventsReceived} total events received`);
      
      if (timeSinceLastEvent > this.EVENT_STALE_THRESHOLD_MS) {
        this.consecutiveStaleChecks++;
        console.warn(`⚠️ Chain ${this.config.chainId}: No WebSocket events received for ${minutesSinceLastEvent} minutes (check ${this.consecutiveStaleChecks}/${this.MAX_STALE_CHECKS_BEFORE_RESUBSCRIBE})`);
        
        if (this.consecutiveStaleChecks >= this.MAX_STALE_CHECKS_BEFORE_RESUBSCRIBE) {
          console.log(`🔄 Chain ${this.config.chainId}: WebSocket subscription appears stale, re-subscribing to events...`);
          
          try {
            // Re-subscribe to events without full restart
            await this.resubscribeToEvents();
            this.consecutiveStaleChecks = 0;
            this.lastEventReceivedAt = Date.now(); // Reset timer after resubscribe
            console.log(`✅ Chain ${this.config.chainId}: Successfully re-subscribed to WebSocket events`);
          } catch (error) {
            console.error(`❌ Chain ${this.config.chainId}: Failed to re-subscribe WebSocket, attempting full restart...`, error);
            // If resubscribe fails, do a full restart
            await this.handleConnectionError(error);
          }
        }
      } else {
        // Events are flowing, reset stale counter
        this.consecutiveStaleChecks = 0;
      }
    }, this.LIVENESS_CHECK_INTERVAL_MS);

    console.log(`👁️ WebSocket liveness check started for chain ${this.config.chainId} (check every ${this.LIVENESS_CHECK_INTERVAL_MS / 1000}s, stale threshold: ${this.EVENT_STALE_THRESHOLD_MS / 60000}m)`);
  }

  /**
   * Stop event liveness check
   */
  private stopLivenessCheck(): void {
    if (this.livenessCheckInterval) {
      clearInterval(this.livenessCheckInterval);
      this.livenessCheckInterval = undefined;
    }
  }
  
  /**
   * Start automatic RPC rotation for load balancing
   */
  private startRpcRotation(): void {
    // Only start if we have multiple RPCs and using HTTP provider
    if (this.rpcUrls.length <= 1 || this.provider instanceof ethers.WebSocketProvider) {
      return;
    }
    
    // Clear existing interval if any
    this.stopRpcRotation();
    
    this.rpcRotationInterval = setInterval(async () => {
      try {
        console.log(`⏰ Chain ${this.config.chainId}: Scheduled RPC rotation (load balancing)`);
        
        // Get next RPC URL
        const currentIndex = this.rpcUrls.indexOf(this.config.rpcUrl);
        const nextIndex = (currentIndex + 1) % this.rpcUrls.length;
        const nextRpcUrl = this.rpcUrls[nextIndex];
        
        console.log(`🔄 Chain ${this.config.chainId}: Rotating from RPC #${currentIndex + 1} to RPC #${nextIndex + 1}`);
        console.log(`   └─ New RPC: ${nextRpcUrl.substring(0, 50)}...`);
        
        // Update config with new RPC
        this.config.rpcUrl = nextRpcUrl;
        
        // Recreate provider with new RPC
        await this.recreateProvider();
        
        // Re-register event handlers with new provider
        await this.registerEventHandlers();
        
        console.log(`✅ Chain ${this.config.chainId}: Successfully rotated to RPC #${nextIndex + 1}`);
      } catch (error) {
        console.error(`❌ Chain ${this.config.chainId}: Error during scheduled RPC rotation:`, error);
        // Don't throw - continue with current RPC
      }
    }, this.RPC_ROTATION_INTERVAL_MS);
    
    console.log(`⏰ Chain ${this.config.chainId}: RPC rotation started (every ${this.RPC_ROTATION_INTERVAL_MS / 60000} minutes)`);
  }
  
  /**
   * Stop automatic RPC rotation
   */
  private stopRpcRotation(): void {
    if (this.rpcRotationInterval) {
      clearInterval(this.rpcRotationInterval);
      this.rpcRotationInterval = undefined;
    }
  }

  /**
   * Re-subscribe to events without full restart
   * This is lighter than a full restart and handles stale subscriptions
   */
  private async resubscribeToEvents(): Promise<void> {
    console.log(`🔄 Chain ${this.config.chainId}: Re-subscribing to all events...`);
    
    // Remove all existing listeners from contracts
    for (const [address, contract] of this.launchpadContracts.entries()) {
      try {
        await contract.removeAllListeners();
      } catch (error) {
        console.warn(`⚠️ Failed to remove listeners from ${address}:`, error);
      }
    }
    
    // Also remove factory listeners
    try {
      await this.factoryContract.removeAllListeners();
    } catch (error) {
      console.warn(`⚠️ Failed to remove factory listeners:`, error);
    }
    
    // Re-register all event handlers
    await this.registerEventHandlers();
    
    console.log(`✅ Chain ${this.config.chainId}: Re-subscribed to all events`);
  }

  /**
   * Update last event received timestamp - call this when any event is received
   */
  private updateEventLiveness(): void {
    this.lastEventReceivedAt = Date.now();
  }

  /**
   * Setup WebSocket reconnection handlers and keep-alive ping
   * This listens to WebSocket close/error events and triggers reconnection
   */
  private setupWebSocketReconnection(): void {
    if (!(this.provider instanceof ethers.WebSocketProvider)) {
      return; // Only for WebSocket providers
    }

    try {
      // Access the internal websocket for reconnection handling
      const ws = (this.provider as any)._websocket || (this.provider as any).websocket;
      if (ws) {
        // Handle WebSocket errors
        ws.on('error', (error: any) => {
          console.error(`❌ WebSocket error on chain ${this.config.chainId}:`, error?.message || error);
          // Don't reconnect on error alone, wait for close event
        });

        // Handle WebSocket close - this is the main trigger for reconnection
        ws.on('close', async (code: number, reason: string) => {
          console.warn(`⚠️ WebSocket closed on chain ${this.config.chainId} - code: ${code}, reason: ${reason || 'unknown'}`);
          
          // Stop ping interval when connection closes
          this.stopWsPing();
          
          // Only attempt reconnection if we were running and not already reconnecting
          if (this.isRunning && !this.isReconnecting) {
            console.log(`🔄 Chain ${this.config.chainId}: WebSocket disconnected, attempting auto-reconnection...`);
            await this.handleWebSocketDisconnect();
          }
        });

        // Start keep-alive ping to prevent connection timeout
        this.startWsPing(ws);

        console.log(`🔌 WebSocket reconnection handlers setup for chain ${this.config.chainId}`);
      } else {
        console.log(`ℹ️ WebSocket internal handlers not available for chain ${this.config.chainId}`);
      }
    } catch (wsError) {
      // Silent fail - WebSocket error handling is optional
      console.log(`ℹ️ Could not setup WebSocket handlers for chain ${this.config.chainId}:`, wsError);
    }
  }

  /**
   * Start WebSocket keep-alive ping
   * Sends ping frames to keep the connection alive and prevent timeout
   */
  private startWsPing(ws: any): void {
    // Clear existing ping interval if any
    this.stopWsPing();

    this.wsPingInterval = setInterval(() => {
      try {
        if (ws.readyState === 1) { // WebSocket.OPEN = 1
          ws.ping(); // Send WebSocket ping frame (not an RPC call, very lightweight)
        }
      } catch (pingError) {
        // Ping failed, connection might be dead
        console.warn(`⚠️ Chain ${this.config.chainId}: WebSocket ping failed, connection may be dead`);
      }
    }, this.WS_PING_INTERVAL_MS);

    console.log(`💓 WebSocket keep-alive ping started for chain ${this.config.chainId} (interval: ${this.WS_PING_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop WebSocket keep-alive ping
   */
  private stopWsPing(): void {
    if (this.wsPingInterval) {
      clearInterval(this.wsPingInterval);
      this.wsPingInterval = undefined;
    }
  }

  /**
   * Handle WebSocket disconnect - attempt to reconnect
   */
  private async handleWebSocketDisconnect(): Promise<void> {
    if (this.isReconnecting) {
      console.log(`⚠️ Chain ${this.config.chainId}: Reconnection already in progress, skipping...`);
      return;
    }

    this.isReconnecting = true;

    try {
      // Wait a bit before reconnecting to avoid rapid reconnection loops
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Stop current listener (cleanup)
      await this.stopInternal();

      // Recreate provider
      await this.recreateProvider();

      // Restart listener
      this.isRunning = false; // Reset flag so start() will proceed
      await this.start();

      console.log(`✅ Chain ${this.config.chainId}: Successfully reconnected after WebSocket disconnect`);
    } catch (error) {
      console.error(`❌ Chain ${this.config.chainId}: Reconnection failed:`, error);
      // Fall back to the existing handleConnectionError for retry logic with exponential backoff
      await this.handleConnectionError(error);
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Internal stop - cleanup without full stop (used during reconnection)
   */
  private async stopInternal(): Promise<void> {
    try {
      // Stop unified event poller
      if (this.unifiedPoller) {
        await this.unifiedPoller.stopAndWait();
      }

      // Stop WebSocket keep-alive ping
      this.stopWsPing();
      
      // Stop event liveness check (will be restarted on start)
      this.stopLivenessCheck();
      
      // Stop RPC rotation (will be restarted on start)
      this.stopRpcRotation();

      // Clear filter recreation interval
      if (this.filterRecreationInterval) {
        clearInterval(this.filterRecreationInterval);
        this.filterRecreationInterval = undefined;
      }

      // Remove all listeners from factory contract
      this.factoryContract.removeAllListeners();

      // Remove all listeners from launchpad contracts
      this.launchpadContracts.forEach((contract) => {
        contract.removeAllListeners();
      });

      // Close WebSocket connection if using WebSocket provider
      if (this.provider instanceof ethers.WebSocketProvider) {
        try {
          await this.provider.destroy();
        } catch (destroyError) {
          // Ignore destroy errors during reconnection
        }
      }

      this.isRunning = false;
    } catch (error) {
      console.error(`❌ Chain ${this.config.chainId}: Error during internal stop:`, error);
    }
  }

  /**
   * Recreate the provider and contracts after a connection failure
   */
  private async recreateProvider(): Promise<void> {
    console.log(`🔄 Chain ${this.config.chainId}: Recreating provider...`);

    // Recreate provider based on URL type
    if (this.config.rpcUrl.startsWith('ws://') || this.config.rpcUrl.startsWith('wss://')) {
      this.provider = new ethers.WebSocketProvider(this.config.rpcUrl);
      console.log(`🔌 Chain ${this.config.chainId}: WebSocket provider recreated`);
    } else {
      // HTTP: the shared failover provider already handles endpoint switching
      this.provider = getChainProvider(this.config.chainId, this.rpcUrls);
      console.log(`📡 Chain ${this.config.chainId}: using shared failover provider`);
    }

    // Recreate factory contract
    this.factoryContract = new ethers.Contract(
      this.config.factoryAddress,
      OddsLaunchpadFactoryABI,
      this.provider
    );

    // Recreate launchpad contracts
    const launchpadAddresses = Array.from(this.launchpadContracts.keys());
    this.launchpadContracts.clear();

    for (const address of launchpadAddresses) {
      if (!ethers.isAddress(address)) {
        console.warn(`⚠️ Chain ${this.config.chainId}: Skipping invalid address: ${address}`);
        continue;
      }
      const contract = new ethers.Contract(
        address,
        OddsLaunchpadABI,
        this.provider
      );
      this.launchpadContracts.set(address, contract);
    }

    console.log(`✅ Chain ${this.config.chainId}: Provider and contracts recreated`);
  }

  /**
   * Test RPC connection with timeout
   */
  private async testConnectionWithTimeout(timeoutMs: number = 10000): Promise<void> {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('RPC connection timeout')), timeoutMs);
    });

    const connectionPromise = this.provider.getBlockNumber();

    try {
      await Promise.race([connectionPromise, timeoutPromise]);
    } catch (error) {
      throw new Error(`RPC connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stop listening to all events
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    if (!this.isRunning) {
      console.log(`⚠️ Activity listener for chain ${this.config.chainId} is not running`);
      if (this.unifiedPoller) await this.unifiedPoller.stopAndWait();
      return;
    }

    try {
      console.log(`🛑 Stopping activity listener for chain ${this.config.chainId}`);

      // Stop MegaETH subscriber if active
      if (this.megaethSubscriber) {
        await this.megaethSubscriber.disconnect();
        this.megaethSubscriber = undefined;
        console.log(`🔌 MegaETH Realtime subscriber disconnected for chain ${this.config.chainId}`);
      }

      // Stop unified event poller (wait for the in-flight range so the cursor is consistent)
      if (this.unifiedPoller) {
        await this.unifiedPoller.stopAndWait();
        console.log(`⏰ Unified event poller stopped for chain ${this.config.chainId}`);
      }

      // Stop WebSocket keep-alive ping
      this.stopWsPing();
      
      // Stop event liveness check
      this.stopLivenessCheck();
      
      // Stop RPC rotation
      this.stopRpcRotation();

      // Clear polling intervals (legacy - should not be used with unified poller)
      if (this.transferPollInterval) {
        clearInterval(this.transferPollInterval);
        this.transferPollInterval = undefined;
        console.log(`⏰ Transfer poll interval cleared for chain ${this.config.chainId}`);
      }

      if (this.factoryPollInterval) {
        clearInterval(this.factoryPollInterval);
        this.factoryPollInterval = undefined;
        console.log(`⏰ Factory poll interval cleared for chain ${this.config.chainId}`);
      }

      // Clear filter recreation interval
      if (this.filterRecreationInterval) {
        clearInterval(this.filterRecreationInterval);
        this.filterRecreationInterval = undefined;
        console.log(`⏰ Filter recreation interval cleared for chain ${this.config.chainId}`);
      }

      // Remove all listeners from factory contract
      this.factoryContract.removeAllListeners();

      // Remove all listeners from launchpad contracts
      this.launchpadContracts.forEach((contract, address) => {
        contract.removeAllListeners();
      });

      // Close WebSocket connection if using WebSocket provider
      if (this.provider instanceof ethers.WebSocketProvider) {
        await this.provider.destroy();
        console.log(`🔌 WebSocket connection closed for chain ${this.config.chainId}`);
      }

      // Cleanup connection pool if used
      if (this.connectionPool) {
        await this.connectionPool.destroy();
        this.connectionPool = undefined;
        console.log(`🏊 Connection pool destroyed for chain ${this.config.chainId}`);
      }

      this.isRunning = false;
      console.log(`✅ Activity listener stopped for chain ${this.config.chainId}`);
    } catch (error) {
      console.error(`❌ Error stopping activity listener for chain ${this.config.chainId}:`, error);
      throw error;
    }
  }

  /**
   * Get connection pool statistics (WebSocket only)
   */
  getPoolStats(): {
    enabled: boolean;
    stats?: {
      totalConnections: number;
      activeConnections: number;
      totalLaunchpads: number;
      maxCapacity: number;
      utilizationPercent: number;
    };
  } {
    if (!this.useConnectionPool || !this.connectionPool) {
      return { enabled: false };
    }
    
    const stats = this.connectionPool.getStats();
    return {
      enabled: true,
      stats: {
        totalConnections: stats.totalConnections,
        activeConnections: stats.activeConnections,
        totalLaunchpads: stats.totalLaunchpads,
        maxCapacity: stats.maxCapacity,
        utilizationPercent: stats.utilizationPercent
      }
    };
  }

  /**
   * Scan historical ContractDeployed events
   * Useful for catching events that happened before service started
   */
  async scanHistoricalDeployments(fromBlock: number, toBlock?: number): Promise<void> {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      const endBlock = toBlock || currentBlock;
      
      console.log(`🔍 Scanning historical ContractDeployed events from block ${fromBlock} to ${endBlock} on chain ${this.config.chainId}`);
      
      const contractDeployedFilter = this.factoryContract.filters.ContractDeployed();
      const events = await this.factoryContract.queryFilter(contractDeployedFilter, fromBlock, endBlock);
      
      console.log(`📊 Found ${events.length} historical ContractDeployed events`);
      
      for (const event of events) {
        try {
          // Type guard to ensure we have an EventLog with args
          if ('args' in event && event.args) {
            const [contractAddress, template, deployer, nonce] = event.args;
            
            console.log(`📡 Processing historical deployment: ${contractAddress} at block ${event.blockNumber}`);
            
            await this.handleContractDeployedEvent({
              contractAddress,
              template,
              deployer,
              nonce,
              txHash: event.transactionHash,
              blockNumber: event.blockNumber
            });
          }
        } catch (error) {
          console.error(`❌ Error processing historical event at block ${event.blockNumber}:`, error);
          // Continue with next event
        }
      }
      
      console.log(`✅ Historical scan complete: processed ${events.length} events`);
    } catch (error) {
      console.error(`❌ Error scanning historical deployments:`, error);
      throw error;
    }
  }

  /**
   * Add a new launchpad to listen to
   * With batch subscriptions, we need to re-subscribe to all events with the new address list
   */
  async addLaunchpad(launchpadAddress: string): Promise<void> {
    // Validate address before processing (prevents ENS resolution on non-ENS chains)
    if (!ethers.isAddress(launchpadAddress)) {
      console.warn(`⚠️ Cannot add launchpad: Invalid address ${launchpadAddress}`);
      return;
    }

    const normalizedAddress = launchpadAddress.toLowerCase();
    
    if (this.launchpadContracts.has(normalizedAddress)) {
      console.log(`⚠️ Already listening to launchpad ${launchpadAddress}`);
      return;
    }

    try {
      let contract: ethers.Contract;
      
      // Use connection pool for WebSocket, otherwise use default provider
      if (this.useConnectionPool && this.connectionPool) {
        const { contract: pooledContract, connectionId } = this.connectionPool.createPooledContract(
          launchpadAddress,
          OddsLaunchpadABI
        );
        contract = pooledContract;
        console.log(`🏊 Added launchpad ${normalizedAddress} to pool connection #${connectionId}`);
      } else {
        contract = new ethers.Contract(
          launchpadAddress,
          OddsLaunchpadABI,
          this.provider
        );
      }

      this.launchpadContracts.set(normalizedAddress, contract);
      console.log(`📝 Added launchpad ${normalizedAddress} to contracts map (total: ${this.launchpadContracts.size})`);

      // HTTP polling reads the contracts map on every range, so the new address
      // is picked up automatically. Re-creating the poller would restart it.
      if (this.isRunning && this.unifiedPoller && !this.useConnectionPool) {
        console.log(`✅ Launchpad ${normalizedAddress} will be included from the next polled range`);
      } else if (this.isRunning) {
        console.log(`� Re-subscribing to all events with new launchpad ${normalizedAddress}...`);
        await this.resubscribeToEvents();
        console.log(`✅ Re-subscribed to all events with ${this.launchpadContracts.size} launchpads`);
      } else {
        console.log(`ℹ️ Listener not running yet, launchpad will be included when listener starts`);
      }
    } catch (error) {
      console.error(`❌ Error adding launchpad ${launchpadAddress}:`, error);
      throw error;
    }
  }

  /**
   * Remove a launchpad from listening
   */
  async removeLaunchpad(launchpadAddress: string): Promise<void> {
    const normalizedAddress = launchpadAddress.toLowerCase();
    const contract = this.launchpadContracts.get(normalizedAddress);

    if (!contract) {
      console.log(`⚠️ Launchpad ${launchpadAddress} not found in listeners`);
      return;
    }

    try {
      contract.removeAllListeners();
      this.launchpadContracts.delete(normalizedAddress);
      console.log(`✅ Removed launchpad ${launchpadAddress} from listeners on chain ${this.config.chainId}`);
    } catch (error) {
      console.error(`❌ Error removing launchpad ${launchpadAddress}:`, error);
      throw error;
    }
  }


  /**
   * Fetch contract metadata from contractURI (IPFS or HTTP)
   * Used to extract image for LaunchpadMetadata
   */
  private async fetchContractMetadata(contractURI: string): Promise<{
    image?: string;
    name?: string;
    description?: string;
  } | null> {
    if (!contractURI) return null;
    
    try {
      let fetchUrl = contractURI;
      
      // Convert IPFS URL to HTTP gateway using fastest gateway
      if (contractURI.startsWith('ipfs://')) {
        const { ipfsToHttpOptimized } = await import('../../utils/ipfs-helpers');
        fetchUrl = await ipfsToHttpOptimized(contractURI) || contractURI;
      }
      
      console.log(`📥 Fetching contract metadata from: ${fetchUrl}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(fetchUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'NFT-Listener-Service/1.0'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.warn(`⚠️ Failed to fetch contract metadata: ${response.status} ${response.statusText}`);
        return null;
      }
      
      const metadata = await response.json() as {
        image?: string;
        name?: string;
        description?: string;
      };
      console.log(`✅ Contract metadata fetched successfully:`, {
        name: metadata.name,
        hasImage: !!metadata.image,
        hasDescription: !!metadata.description
      });
      
      return {
        image: metadata.image,
        name: metadata.name,
        description: metadata.description
      };
    } catch (error) {
      console.error(`❌ Error fetching contract metadata from ${contractURI}:`, error);
      return null;
    }
  }

  /**
   * Handle ContractDeployed event from OddsLaunchpadFactory
   */
  private async handleContractDeployedEvent(event: ContractDeployedEvent): Promise<void> {
    try {
      // Normalize contract address to lowercase
      const normalizedContractAddress = event.contractAddress.toLowerCase();
      console.log(`🎉 handleContractDeployedEvent called!`);
      console.log(`   Contract: ${normalizedContractAddress}`);
      console.log(`   Deployer: ${event.deployer}`);
      console.log(`   Template: ${event.template}`);
      console.log(`   Nonce: ${event.nonce}`);
      console.log(`   TxHash: ${event.txHash}`);
      console.log(`   Block: ${event.blockNumber}`);

      // ========================================================================
      // In-memory lock to prevent race condition when multiple sources 
      // (polling, websocket) detect the same event simultaneously
      // ========================================================================
      if (this.processingContractDeployedEvents.has(event.txHash)) {
        console.log(`⏳ ContractDeployed event ${event.txHash} is already being processed, skipping duplicate`);
        return;
      }
      
      // Add to processing set before database check
      this.processingContractDeployedEvents.add(event.txHash);
      
      // Clean up old entries after 30 seconds to prevent memory leak
      setTimeout(() => {
        this.processingContractDeployedEvents.delete(event.txHash);
      }, 30000);

      // Check if already processed in database
      // Check by both txHash AND contractAddress to prevent duplicates
      const existing = await prisma.activity.findFirst({
        where: {
          txHash: event.txHash,
          type: ActivityType.LAUNCHPAD_CREATED,
          metadata: {
            path: ['contractAddress'],
            equals: normalizedContractAddress
          }
        }
      });

      // Also check if there's already an activity for this contract address
      // This prevents duplicate entries when metadata is updated later
      const existingByContract = await prisma.activity.findFirst({
        where: {
          type: ActivityType.LAUNCHPAD_CREATED,
          metadata: {
            path: ['contractAddress'],
            equals: normalizedContractAddress
          }
        }
      });

      // Determine which existing record to use (prefer by txHash, fallback to by contract)
      const existingActivity = existing || existingByContract;

      // Get factory ID from database
      const factory = await prisma.launchpadFactory.findUnique({
        where: {
          contractAddress: this.config.factoryAddress.toLowerCase()
        }
      });

      if (!factory) {
        console.warn(`⚠️ Factory not found in database: ${this.config.factoryAddress}`);
        return;
      }

      // Check if launchpad already exists in database
      let launchpad = await prisma.launchpad.findUnique({
        where: {
          contractAddress: normalizedContractAddress
        },
        include: {
          metadata: true
        }
      });

      // If launchpad doesn't exist, fetch info from blockchain and create it
      if (!launchpad) {
        try {
          console.log(`📝 Launchpad not found in database, fetching from blockchain...`);
          
          // Validate address before creating contract (prevents ENS resolution on non-ENS chains)
          if (!ethers.isAddress(normalizedContractAddress)) {
            console.warn(`⚠️ Invalid contract address: ${normalizedContractAddress}`);
            return;
          }

          // Create contract instance to fetch data
          const launchpadContract = new ethers.Contract(
            normalizedContractAddress,
            OddsLaunchpadABI,
            this.provider
          );

          // Fetch basic info from contract
          const [name, symbol, totalSupply, owner] = await Promise.all([
            launchpadContract.name(),
            launchpadContract.symbol(),
            launchpadContract.totalMaxSupply(), // max supply, NOT totalSupply() (= minted so far)
            launchpadContract.owner()
          ]);
          
          // Try to get treasury, fallback to owner or deployer
          let treasury: string;
          try {
            treasury = await launchpadContract.treasury();
          } catch {
            // If treasury() fails, use owner or deployer as fallback
            treasury = owner || event.deployer;
          }

          // Try to get isShuffleEnabled (new field, may not exist in older contracts)
          let isShuffleEnabled = false;
          try {
            isShuffleEnabled = await launchpadContract.isShuffleEnabled();
          } catch {
            // If isShuffleEnabled() fails (older contract version), default to false
            console.log(`ℹ️ isShuffleEnabled not available in contract, defaulting to false`);
          }

          // Create or update launchpad in database (upsert to handle race conditions)
          const createdLaunchpad = await prisma.launchpad.upsert({
            where: {
              contractAddress: normalizedContractAddress
            },
            create: {
              chainId: this.config.chainId,
              factoryId: factory.id,
              contractAddress: normalizedContractAddress,
              creator: event.deployer,
              treasury: treasury,
              name: name,
              symbol: symbol,
              totalMaxSupply: Number(totalSupply),
              mintedCount: 0,
              isShuffleEnabled: isShuffleEnabled,
              status: 'ACTIVE',
              createdAt: new Date()
            },
            update: {
              // Update fields that might have changed
              treasury: treasury,
              name: name,
              symbol: symbol,
              totalMaxSupply: Number(totalSupply),
              isShuffleEnabled: isShuffleEnabled
            }
          });

          console.log(`✅ Launchpad upserted in database: ${normalizedContractAddress}`);
          console.log(`   Shuffle enabled: ${isShuffleEnabled}`);

          // ========================================================================
          // SOLUTION 1: Fetch contractURI metadata and create LaunchpadMetadata
          // This ensures collectionImage is available when creating activity
          // ========================================================================
          try {
            const contractURI = await launchpadContract.contractURI();
            
            if (contractURI) {
              console.log(`📥 Fetching metadata from contractURI: ${contractURI}`);
              const metadata = await this.fetchContractMetadata(contractURI);
              
              if (metadata?.image) {
                // Create LaunchpadMetadata with image
                await prisma.launchpadMetadata.create({
                  data: {
                    launchpadId: createdLaunchpad.id,
                    image: metadata.image
                  }
                });
                
                console.log(`✅ LaunchpadMetadata created with image: ${metadata.image}`);
              } else {
                console.log(`ℹ️ No image found in contractURI metadata`);
              }
            } else {
              console.log(`ℹ️ No contractURI available for this launchpad`);
            }
          } catch (metadataError) {
            console.error(`❌ Error fetching contract metadata:`, metadataError);
            // Continue even if metadata fetch fails
          }

          // ========================================================================
          // SOLUTION 3: Call syncCollectionImage to ensure metadata is populated
          // This provides a fallback if contractURI fetch fails
          // ========================================================================
          try {
            console.log(`🔄 Syncing collection image for ${normalizedContractAddress}...`);
            await this.nftEventHandler.syncCollectionImage(normalizedContractAddress);
          } catch (syncError) {
            console.error(`❌ Error syncing collection image:`, syncError);
            // Continue even if sync fails
          }

          // Fetch launchpad with metadata after creation
          launchpad = await prisma.launchpad.findUnique({
            where: { id: createdLaunchpad.id },
            include: { metadata: true }
          });
        } catch (fetchError) {
          console.error(`❌ Error fetching launchpad info from blockchain:`, fetchError);
          // Continue with activity creation even if launchpad creation fails
        }
      }

      // Truncate deployer address
      const deployerShort = `${event.deployer.slice(0, 6)}...${event.deployer.slice(-4)}`;

      // Get collection image from launchpad metadata
      let collectionImage = null;
      if (launchpad?.id) {
        const launchpadWithMetadata = await prisma.launchpad.findUnique({
          where: { id: launchpad.id },
          include: { metadata: true }
        });
        collectionImage = launchpadWithMetadata?.metadata?.image || null;
      }

      // Prepare activity data
      const activityData = {
        chainId: this.config.chainId,
        factoryId: factory.id,
        launchpadId: launchpad?.id,
        type: ActivityType.LAUNCHPAD_CREATED,
        actor: event.deployer,
        description: `Created by ${deployerShort}`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          contractAddress: normalizedContractAddress, // Add this for duplicate checking
          collectionName: launchpad?.name || 'Unknown',
          collectionSymbol: launchpad?.symbol || 'UNKNOWN',
          collectionImage: collectionImage,
          totalSupply: launchpad?.totalMaxSupply?.toString() || '0',
          deployerShort,
          template: event.template,
          nonce: event.nonce.toString()
        }
      };

      // Update existing activity or create new one
      if (existingActivity) {
        console.log(`🔄 Updating existing contract deployment activity: ${event.txHash} for ${normalizedContractAddress}`);
        
        await prisma.activity.update({
          where: { id: existingActivity.id },
          data: activityData
        });

        console.log(`✅ Contract deployment activity updated: ${event.txHash}`);
      } else {
        console.log(`📝 Creating new contract deployment activity: ${event.txHash} for ${normalizedContractAddress}`);
        
        // Create activity record with retry logic
        await this.writeActivityWithRetry(activityData);

        console.log(`✅ Contract deployment activity created: ${event.txHash}`);
      }

      // Add this launchpad to listeners for future events
      try {
        await this.addLaunchpad(normalizedContractAddress);
        console.log(`✅ Launchpad ${normalizedContractAddress} added to listeners - now monitoring ${this.launchpadContracts.size} launchpads`);
      } catch (addError) {
        console.error(`❌ Error adding launchpad to listeners:`, addError);
        // Continue even if adding to listener fails
      }

      // ========================================================================
      // Emit WebSocket event for real-time updates
      // Requirements: 4.2
      // ========================================================================
      if (this.eventEmitter && launchpad) {
        try {
          // Prepare collection event data for WebSocket
          const collectionEventData: CollectionEventData = {
            contractAddress: normalizedContractAddress,
            chainId: this.config.chainId,
            name: launchpad.name,
            totalSupply: launchpad.totalMaxSupply,
            creator: event.deployer,
            timestamp: new Date(),
            imageUrl: launchpad.metadata?.image || undefined,
          };

          // Emit to WebSocket clients
          this.eventEmitter.emitCollectionEvent(collectionEventData);
        } catch (wsError) {
          // Log but don't throw - WebSocket errors shouldn't break the listener
          console.warn(`⚠️ Failed to emit WebSocket collection event for ${normalizedContractAddress}:`, wsError);
        }
      }

    } catch (error) {
      console.error(`❌ Error handling contract deployed event:`, error);
      // Log error but don't throw - continue processing other events
      await this.logActivityError('handleContractDeployedEvent', error, event);
    }
  }

  /**
   * Handle CollectionCreated event (backward compatibility)
   */
  private async handleCollectionCreatedEvent(event: CollectionCreatedEvent): Promise<void> {
    try {
      // Normalize launchpad address to lowercase
      const normalizedLaunchpadAddress = event.launchpadAddress.toLowerCase();
      console.log(`🎉 New collection created: ${event.name} (${normalizedLaunchpadAddress})`);

      // Check if already processed
      const existing = await prisma.activity.findFirst({
        where: {
          txHash: event.txHash,
          type: ActivityType.LAUNCHPAD_CREATED
        }
      });

      // Get factory ID from database
      const factory = await prisma.launchpadFactory.findUnique({
        where: {
          contractAddress: this.config.factoryAddress.toLowerCase()
        }
      });

      if (!factory) {
        console.warn(`⚠️ Factory not found in database: ${this.config.factoryAddress}`);
        return;
      }

      // Get launchpad from database to get image
      const launchpad = await prisma.launchpad.findUnique({
        where: {
          contractAddress: normalizedLaunchpadAddress
        },
        include: {
          metadata: true
        }
      });

      // Truncate creator address
      const creatorShort = `${event.creator.slice(0, 6)}...${event.creator.slice(-4)}`;

      // Get collection image from launchpad metadata
      const collectionImage = launchpad?.metadata?.image || null;

      // Prepare activity data
      const activityData = {
        chainId: this.config.chainId,
        factoryId: factory.id,
        launchpadId: launchpad?.id,
        type: ActivityType.LAUNCHPAD_CREATED,
        actor: event.creator,
        description: `Created by ${creatorShort}`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          collectionName: event.name,
          collectionSymbol: event.symbol,
          collectionImage: collectionImage,
          totalSupply: event.totalSupply.toString(),
          creatorShort
        }
      };

      // Update existing activity or create new one
      if (existing) {
        console.log(`🔄 Updating existing collection creation activity: ${event.txHash}`);
        
        await prisma.activity.update({
          where: { id: existing.id },
          data: activityData
        });

        console.log(`✅ Collection creation activity updated: ${event.txHash}`);
      } else {
        console.log(`📝 Creating new collection creation activity: ${event.txHash}`);
        
        // Create activity record with retry logic
        await this.writeActivityWithRetry(activityData);

        console.log(`✅ Collection creation activity created: ${event.txHash}`);
      }

      // Add this launchpad to listeners for future mint events (silently)
      await this.addLaunchpad(normalizedLaunchpadAddress);

    } catch (error) {
      console.error(`❌ Error handling collection created event:`, error);
      // Log error but don't throw - continue processing other events
      await this.logActivityError('handleCollectionCreatedEvent', error, event);
    }
  }

  /**
   * Ensure launchpad is registered in listener
   * If not registered, add it automatically
   */
  private async ensureLaunchpadRegistered(launchpadAddress: string): Promise<void> {
    const normalizedAddress = launchpadAddress.toLowerCase();
    
    if (!this.launchpadContracts.has(normalizedAddress)) {
      console.log(`📝 Auto-registering launchpad ${launchpadAddress} to listener`);
      try {
        await this.addLaunchpad(launchpadAddress);
        console.log(`✅ Launchpad ${launchpadAddress} auto-registered - now monitoring ${this.launchpadContracts.size} launchpads`);
      } catch (error) {
        console.error(`❌ Failed to auto-register launchpad ${launchpadAddress}:`, error);
      }
    }
  }

  /**
   * Auto-sync launchpad from blockchain to database
   * Used by event handlers when launchpad is not found in database
   */
  private async autoSyncLaunchpad(launchpadAddress: string): Promise<any> {
    // Normalize address to lowercase (outside try block so it's available in catch)
    const normalizedAddress = launchpadAddress.toLowerCase();
    
    // Validate address before processing (prevents ENS resolution on non-ENS chains)
    if (!ethers.isAddress(normalizedAddress)) {
      console.warn(`⚠️ Cannot auto-sync: Invalid launchpad address ${normalizedAddress}`);
      return null;
    }

    try {
      console.log(`📝 Auto-syncing launchpad ${normalizedAddress} from blockchain...`);

      // Get factory from database
      const factory = await prisma.launchpadFactory.findUnique({
        where: { contractAddress: this.config.factoryAddress.toLowerCase() }
      });

      if (!factory) {
        throw new Error(`Factory not found: ${this.config.factoryAddress}`);
      }

      // Create contract instance to fetch data
      const launchpadContract = new ethers.Contract(
        normalizedAddress,
        OddsLaunchpadABI,
        this.provider
      );

      // Fetch basic info from contract with retry
      let name: string = '';
      let symbol: string = '';
      let totalSupply: bigint = 0n;
      let owner: string = '';
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          [name, symbol, totalSupply, owner] = await Promise.all([
            launchpadContract.name(),
            launchpadContract.symbol(),
            launchpadContract.totalMaxSupply(), // max supply, NOT totalSupply() (= minted so far)
            launchpadContract.owner()
          ]);
          break;
        } catch (rpcError: any) {
          retryCount++;
          if (retryCount >= maxRetries) {
            throw rpcError;
          }
          console.warn(`⚠️ RPC error fetching launchpad data, retry ${retryCount}/${maxRetries}...`);
          await delay(1000 * retryCount);
        }
      }

      // Fetch treasury with fallback to owner
      let treasury: string;
      try {
        treasury = await launchpadContract.treasury();
      } catch {
        // If treasury() fails, use owner as fallback
        treasury = owner;
      }

      // Try to get isShuffleEnabled (new field, may not exist in older contracts)
      let isShuffleEnabled = false;
      try {
        isShuffleEnabled = await launchpadContract.isShuffleEnabled();
      } catch {
        // If isShuffleEnabled() fails (older contract version), default to false
        console.log(`ℹ️ isShuffleEnabled not available in contract, defaulting to false`);
      }

      // Create launchpad in database with upsert to handle race conditions
      let launchpad;
      try {
        const createdLaunchpad = await prisma.launchpad.upsert({
          where: { contractAddress: normalizedAddress },
          create: {
            chainId: this.config.chainId,
            factoryId: factory.id,
            contractAddress: normalizedAddress,
            creator: owner,
            treasury: treasury,
            name: name,
            symbol: symbol,
            totalMaxSupply: Number(totalSupply),
            mintedCount: 0,
            isShuffleEnabled: isShuffleEnabled,
            status: 'ACTIVE',
            createdAt: new Date()
          },
          update: {} // Don't update if already exists
        });

        console.log(`✅ Launchpad auto-synced to database: ${normalizedAddress}`);
        console.log(`   Shuffle enabled: ${isShuffleEnabled}`);

        // Fetch with metadata
        launchpad = await prisma.launchpad.findUnique({
          where: { id: createdLaunchpad.id },
          include: { metadata: true, factory: true }
        });
      } catch (dbError: any) {
        // If unique constraint error, just fetch the existing launchpad
        if (dbError.code === 'P2002') {
          console.log(`ℹ️ Launchpad already exists (race condition), fetching from database...`);
          launchpad = await prisma.launchpad.findUnique({
            where: { contractAddress: normalizedAddress },
            include: { metadata: true, factory: true }
          });
        } else {
          throw dbError;
        }
      }

      return launchpad;
    } catch (error: any) {
      console.error(`❌ Failed to auto-sync launchpad ${launchpadAddress}:`, error);
      
      // Try to fetch launchpad one more time in case another process created it
      try {
        const existingLaunchpad = await prisma.launchpad.findUnique({
          where: { contractAddress: normalizedAddress },
          include: { metadata: true, factory: true }
        });
        
        if (existingLaunchpad) {
          console.log(`ℹ️ Launchpad found in database after sync error, using existing record`);
          return existingLaunchpad;
        }
      } catch (fetchError) {
        // Ignore fetch error, throw original error
      }
      
      throw error;
    }
  }

  // Track last batch for auto-sync
  private lastBatchProcessedAt: number = 0;
  private autoSyncScheduled: boolean = false;
  private readonly AUTO_SYNC_DELAY_MS: number = 5000; // Wait 5 seconds after batch completes

  /**
   * Queue processor for mint events to prevent overload
   * Includes rate limiting to prevent database connection exhaustion
   * Optimized for large batch mints (100+ NFTs)
   */
  private async processMintQueue(): Promise<void> {
    // Dynamic delay based on queue size - smaller delay for larger batches
    const getDelayMs = () => {
      if (this.mintQueue.length > 200) return 10; // Very large batch - minimal delay
      if (this.mintQueue.length > 100) return 20; // Large batch
      if (this.mintQueue.length > 50) return 30; // Medium batch
      return 50; // Small batch - more conservative
    };

    while (this.mintQueue.length > 0 && this.activeMintProcessing < this.MAX_CONCURRENT_MINTS) {
      const task = this.mintQueue.shift();
      if (task) {
        this.activeMintProcessing++;

        // Add dynamic delay to spread out database operations
        const delayMs = getDelayMs();
        if (delayMs > 0) {
          await delay(delayMs);
        }

        task().finally(() => {
          this.activeMintProcessing--;
          this.lastBatchProcessedAt = Date.now();

          // Process next item in queue
          if (this.mintQueue.length > 0) {
            this.processMintQueue();
          } else if (this.activeMintProcessing === 0) {
            // Queue empty and no active processing - schedule auto-sync
            this.scheduleAutoSync();
          }
        });
      }
    }

    // Log queue status periodically for monitoring (every 50 items for large batches)
    if (this.mintQueue.length > 0 && this.mintQueue.length % 50 === 0) {
      console.log(`📊 Mint queue status: ${this.mintQueue.length} pending, ${this.activeMintProcessing} processing`);
    }
  }

  /**
   * Schedule auto-sync after batch mint completes
   * Waits a few seconds to ensure all events are processed
   */
  private scheduleAutoSync(): void {
    if (this.autoSyncScheduled) return;

    this.autoSyncScheduled = true;
    console.log(`⏰ Batch complete, scheduling auto-sync in ${this.AUTO_SYNC_DELAY_MS / 1000}s...`);

    setTimeout(async () => {
      // Check if queue is still empty (no new events came in)
      if (this.mintQueue.length === 0 && this.activeMintProcessing === 0) {
        console.log(`🔄 Running auto-sync for missing NFTs...`);
        this.logBatchStats();

        try {
          const result = await this.autoSyncAllMissingNFTs();
          if (result.total > 0) {
            console.log(`✅ Auto-sync complete: ${result.total} missing NFTs synced`);
          } else {
            console.log(`✅ Auto-sync complete: No missing NFTs found`);
          }
        } catch (error) {
          console.error(`❌ Auto-sync failed:`, error);
        }
      } else {
        console.log(`⏭️ New events arrived, skipping auto-sync`);
      }

      this.autoSyncScheduled = false;
    }, this.AUTO_SYNC_DELAY_MS);
  }

  /**
   * Handle mint event with queue management for large batches
   * Optimized for batch mints of 100+ NFTs
   */
  private async handleMintEvent(event: MintEvent): Promise<void> {
    // If too many concurrent mints, queue this one
    if (this.activeMintProcessing >= this.MAX_CONCURRENT_MINTS) {
      // Check queue size to prevent memory overflow
      if (this.mintQueue.length >= this.MAX_QUEUE_SIZE) {
        this.droppedMintCount++;
        // Log warning every 100 dropped mints to avoid log spam
        if (this.droppedMintCount % 100 === 1) {
          console.warn(`⚠️ Mint queue full (${this.MAX_QUEUE_SIZE}), dropping mint #${event.tokenId}. Total dropped: ${this.droppedMintCount}`);
          console.warn(`   Consider running historical sync to recover dropped mints`);
        }
        // Store dropped mint info for later recovery via historical sync
        await this.logActivityError('MintQueueOverflow', new Error('Queue full'), {
          tokenId: event.tokenId.toString(),
          txHash: event.txHash,
          launchpadAddress: event.launchpadAddress,
          queueSize: this.mintQueue.length,
          droppedCount: this.droppedMintCount
        });
        return;
      }
      
      // Add to queue with priority (lower token IDs first for sequential minting)
      this.mintQueue.push(() => this.processMintEventInternal(event));
      
      // Log queue status for large batches
      if (this.mintQueue.length % 25 === 0) {
        console.log(`📥 Queued mint #${event.tokenId}, queue size: ${this.mintQueue.length}`);
      }
      
      // Start processing queue if not already running
      if (this.activeMintProcessing < this.MAX_CONCURRENT_MINTS) {
        this.processMintQueue();
      }
      return;
    }
    
    // Process immediately
    this.activeMintProcessing++;
    try {
      await this.processMintEventInternal(event);
    } finally {
      this.activeMintProcessing--;
      this.lastBatchProcessedAt = Date.now();
      
      // Process next queued item if any
      if (this.mintQueue.length > 0) {
        this.processMintQueue();
      } else if (this.activeMintProcessing === 0) {
        // No queue and no active processing - schedule auto-sync
        this.scheduleAutoSync();
      }
    }
  }

  /**
   * Get current mint queue status for monitoring
   * Useful for health checks and debugging high-volume minting
   */
  public getMintQueueStatus(): {
    queueSize: number;
    activeProcessing: number;
    droppedCount: number;
    maxQueueSize: number;
    maxConcurrent: number;
    eventsReceived: number;
    eventsProcessed: number;
  } {
    return {
      queueSize: this.mintQueue.length,
      activeProcessing: this.activeMintProcessing,
      droppedCount: this.droppedMintCount,
      maxQueueSize: this.MAX_QUEUE_SIZE,
      maxConcurrent: this.MAX_CONCURRENT_MINTS,
      eventsReceived: this.mintEventsReceived,
      eventsProcessed: this.mintEventsProcessed
    };
  }

  /**
   * Process mint event from EventProcessor (WebSocket or polling)
   * 
   * This is a public wrapper that converts MintEventData from EventProcessor
   * to the MintEvent format expected by the internal handleMintEvent method.
   * 
   * @param data - Mint event data from EventProcessor
   * 
   * Requirements: 6.1, 6.4
   */
  public async processMintFromEventProcessor(data: {
    from: string;
    tokenId: string;
    transactionHash: string;
    logIndex: number;
    blockNumber: number;
    launchpadAddress: string;
    source: 'websocket' | 'polling';
  }): Promise<void> {
    // Convert MintEventData to MintEvent format
    // For mints, 'from' in MintEventData is actually the recipient (to)
    // The actual 'from' for a mint is the zero address
    const mintEvent: MintEvent = {
      from: ethers.ZeroAddress, // Mints always come from zero address
      to: data.from, // The recipient
      tokenId: BigInt(data.tokenId),
      txHash: data.transactionHash,
      blockNumber: data.blockNumber,
      launchpadAddress: data.launchpadAddress,
      logIndex: data.logIndex
    };

    // Call the internal handler
    await this.handleMintEvent(mintEvent);
  }

  /**
   * Get event liveness status for monitoring
   * Useful for health checks and detecting silent disconnects
   */
  public getEventLivenessStatus(): {
    lastEventReceivedAt: number;
    timeSinceLastEventMs: number;
    timeSinceLastEventMinutes: number;
    consecutiveStaleChecks: number;
    isStale: boolean;
    staleThresholdMs: number;
  } {
    const now = Date.now();
    const timeSinceLastEvent = now - this.lastEventReceivedAt;
    return {
      lastEventReceivedAt: this.lastEventReceivedAt,
      timeSinceLastEventMs: timeSinceLastEvent,
      timeSinceLastEventMinutes: Math.round(timeSinceLastEvent / 60000),
      consecutiveStaleChecks: this.consecutiveStaleChecks,
      isStale: timeSinceLastEvent > this.EVENT_STALE_THRESHOLD_MS,
      staleThresholdMs: this.EVENT_STALE_THRESHOLD_MS
    };
  }

  /**
   * Log final batch stats (call after batch mint completes)
   */
  public logBatchStats(): void {
    if (this.lastBatchTokenIds.size > 0) {
      console.log(`📊 Final batch: ${this.lastBatchTokenIds.size} events from tx ${this.lastBatchTxHash.slice(0, 10)}...`);
    }
    console.log(`📊 Total events - Received: ${this.mintEventsReceived}, Processed: ${this.mintEventsProcessed}, Dropped: ${this.droppedMintCount}`);
  }

  /**
   * Reset dropped mint counter (call after historical sync recovery)
   */
  public resetDroppedMintCount(): void {
    const previousCount = this.droppedMintCount;
    this.droppedMintCount = 0;
    if (previousCount > 0) {
      console.log(`✅ Reset dropped mint counter (was ${previousCount})`);
    }
  }

  /**
   * Sync missing NFTs for a specific launchpad
   * Compares blockchain totalSupply with database NFT count and syncs missing ones
   */
  public async syncMissingNFTs(launchpadAddress: string): Promise<{ synced: number; errors: number }> {
    const normalizedAddress = launchpadAddress.toLowerCase();
    let synced = 0;
    let errors = 0;

    try {
      console.log(`🔄 Starting missing NFT sync for ${normalizedAddress}...`);

      // Get launchpad contract
      const contract = this.launchpadContracts.get(normalizedAddress);
      if (!contract) {
        console.warn(`⚠️ Launchpad ${normalizedAddress} not found in listeners`);
        return { synced: 0, errors: 0 };
      }

      // Get total supply from blockchain
      let totalSupply: bigint;
      try {
        totalSupply = await contract.totalSupply();
      } catch (supplyError: any) {
        // Contract might not exist or doesn't have totalSupply function
        console.warn(`⚠️ Cannot get totalSupply for ${normalizedAddress}, skipping sync:`, supplyError.message);
        return { synced: 0, errors: 0 };
      }
      
      const totalSupplyNum = Number(totalSupply);
      console.log(`📊 Blockchain totalSupply: ${totalSupplyNum}`);

      // Get existing NFT token IDs from database
      const existingNFTs = await withDbLimit(() =>
        prisma.nFT.findMany({
          where: {
            contractAddress: normalizedAddress,
            chainId: this.config.chainId
          },
          select: { tokenId: true }
        })
      );

      const existingTokenIds = new Set(existingNFTs.map(n => n.tokenId));
      console.log(`📊 Database NFT count: ${existingTokenIds.size}`);

      // Find missing token IDs (assuming sequential from 1 or 0)
      const missingTokenIds: number[] = [];
      
      // Check both 0-indexed and 1-indexed
      for (let i = 0; i <= totalSupplyNum; i++) {
        if (!existingTokenIds.has(i.toString())) {
          missingTokenIds.push(i);
        }
      }

      if (missingTokenIds.length === 0) {
        console.log(`✅ No missing NFTs found for ${normalizedAddress}`);
        return { synced: 0, errors: 0 };
      }

      console.log(`🔍 Found ${missingTokenIds.length} missing NFTs: ${missingTokenIds.slice(0, 10).join(', ')}${missingTokenIds.length > 10 ? '...' : ''}`);

      // Get launchpad from database
      const launchpad = await withDbLimit(() =>
        prisma.launchpad.findUnique({
          where: { contractAddress: normalizedAddress },
          include: { metadata: true, factory: true }
        })
      );

      if (!launchpad) {
        console.warn(`⚠️ Launchpad ${normalizedAddress} not found in database`);
        return { synced: 0, errors: 0 };
      }

      // Sync each missing NFT
      for (const tokenId of missingTokenIds) {
        try {
          // Check if mint record already exists (prevent double-count)
          const existingMint = await withDbLimit(() =>
            prisma.mint.findUnique({
              where: {
                launchpadId_tokenId: {
                  launchpadId: launchpad.id,
                  tokenId: tokenId
                }
              }
            })
          );

          if (existingMint) {
            console.log(`ℹ️ Mint record already exists for token #${tokenId}, skipping sync`);
            continue;
          }

          // Get owner of this token
          let owner: string;
          try {
            owner = await contract.ownerOf(tokenId);
          } catch {
            // Token might not exist (burned or not minted yet)
            continue;
          }

          // Get block timestamp (use current time as fallback)
          const blockTimestamp = new Date();

          // Generate a valid synthetic txHash (66 chars: 0x + 64 hex)
          // Use keccak256 hash of contract address + tokenId for deterministic, valid hash
          const syntheticTxHash = ethers.keccak256(
            ethers.solidityPacked(['string', 'address', 'uint256'], ['sync', normalizedAddress, tokenId])
          );

          // Save NFT data via handleTransferEvent
          await this.nftEventHandler.handleTransferEvent({
            contractAddress: normalizedAddress,
            tokenId: tokenId.toString(),
            from: ethers.ZeroAddress,
            to: owner,
            quantity: '1',
            txHash: syntheticTxHash, // Valid synthetic txHash for sync
            blockNumber: 0,
            blockTimestamp: blockTimestamp,
            logIndex: tokenId, // Use tokenId as logIndex for uniqueness
            tokenType: 'ERC721'
          });

          // NOTE: mintedCount is auto-updated by database trigger when Mint record is created
          // See: prisma/migrations/manual_add_minted_count_triggers.sql
          // No need to manually increment here - trigger handles it atomically
          
          // Just update lastMintAt
          try {
            await withDbLimit(() =>
              prisma.launchpad.update({
                where: { id: launchpad.id },
                data: {
                  lastMintAt: blockTimestamp,
                  updatedAt: new Date()
                }
              })
            );
          } catch (updateError) {
            console.warn(`⚠️ Failed to update lastMintAt for token ${tokenId}:`, updateError);
          }

          synced++;
          
          // Log progress every 10 NFTs
          if (synced % 10 === 0) {
            console.log(`📥 Synced ${synced}/${missingTokenIds.length} missing NFTs...`);
          }

          // Small delay to prevent rate limiting
          await delay(100);
        } catch (error) {
          errors++;
          console.error(`❌ Error syncing NFT #${tokenId}:`, error);
        }
      }

      console.log(`✅ Missing NFT sync complete: ${synced} synced, ${errors} errors`);
      return { synced, errors };
    } catch (error) {
      console.error(`❌ Error in syncMissingNFTs:`, error);
      return { synced, errors: errors + 1 };
    }
  }

  /**
   * Auto-sync missing NFTs for all launchpads on this chain
   * Call this periodically or after detecting missing events
   */
  public async autoSyncAllMissingNFTs(): Promise<{ total: number; errors: number }> {
    let totalSynced = 0;
    let totalErrors = 0;

    console.log(`🔄 Starting auto-sync for all launchpads on chain ${this.config.chainId}...`);

    for (const [address] of this.launchpadContracts) {
      const result = await this.syncMissingNFTs(address);
      totalSynced += result.synced;
      totalErrors += result.errors;

      // Delay between launchpads to prevent rate limiting
      await delay(500);
    }

    console.log(`✅ Auto-sync complete for chain ${this.config.chainId}: ${totalSynced} NFTs synced, ${totalErrors} errors`);
    return { total: totalSynced, errors: totalErrors };
  }

  /**
   * Internal mint event processor
   * Uses withDbLimit to prevent database connection exhaustion
   */
  private async processMintEventInternal(event: MintEvent): Promise<void> {
    try {
      // Normalize launchpad address to lowercase
      const normalizedLaunchpadAddress = event.launchpadAddress.toLowerCase();

      // Ensure launchpad is registered in listener (auto-discover)
      await this.ensureLaunchpadRegistered(normalizedLaunchpadAddress);

      // Check if activity already processed (with DB limit to prevent connection exhaustion)
      const existingActivity = await withDbLimit(() =>
        withRetry(() => 
          prisma.activity.findFirst({
            where: {
              txHash: event.txHash,
              type: ActivityType.MINT_OCCURRED,
              metadata: {
                path: ['tokenId'],
                equals: event.tokenId.toString()
              }
            }
          })
        )
      );

      // Check if NFT data exists
      const existingNFT = await withDbLimit(() =>
        withRetry(() =>
          prisma.nFT.findUnique({
            where: {
              contractAddress_tokenId_chainId: {
                contractAddress: normalizedLaunchpadAddress,
                tokenId: event.tokenId.toString(),
                chainId: this.config.chainId
              }
            }
          })
        )
      );

      // Determine transfer type (this is now only for mints since we route at event level)
      const isZeroAddress = (addr: string) => addr.toLowerCase() === ethers.ZeroAddress.toLowerCase();
      
      // Sanity check: this should always be true since we route mints here
      if (!isZeroAddress(event.from)) {
        console.warn(`⚠️ handleMintEvent called for non-mint transfer: ${event.txHash}`);
        return;
      }

      // Check if this specific transfer was already processed (by txHash + logIndex)
      const existingTransfer = await withDbLimit(() =>
        withRetry(() =>
          prisma.nFTTransfer.findUnique({
            where: {
              txHash_logIndex: {
                txHash: event.txHash,
                logIndex: event.logIndex
              }
            }
          })
        )
      );

      // Check if mint record exists (for batch mint scenarios)
      let existingMint: any = null;
      
      // Get launchpad ID first for mint check
      const launchpadForCheck = await withDbLimit(() =>
        prisma.launchpad.findUnique({
          where: { contractAddress: normalizedLaunchpadAddress },
          select: { id: true }
        })
      );
      
      if (launchpadForCheck) {
        existingMint = await withDbLimit(() =>
          prisma.mint.findUnique({
            where: { 
              launchpadId_tokenId: {
                launchpadId: launchpadForCheck.id,
                tokenId: Number(event.tokenId)
              }
            }
          })
        );
      }

      // For mints: skip if transfer record exists (most reliable duplicate check)
      // Transfer record is created atomically with mint record in same transaction
      if (existingTransfer) {
        // Transfer already processed, this is a duplicate - silent skip
        // This prevents double-counting mintedCount
        return;
      }

      // Additional safety check: if mint record exists, skip
      // This handles edge cases where transfer might not be recorded but mint is
      if (existingMint) {
        console.log(`ℹ️ Mint record already exists for token #${event.tokenId}, skipping to prevent double-count`);
        return;
      }

      // Flag to track what needs to be done
      const needsActivity = !existingActivity;

      // Get launchpad from database (with DB limit)
      let launchpad = await withDbLimit(() =>
        withRetry(() =>
          prisma.launchpad.findUnique({
            where: {
              contractAddress: normalizedLaunchpadAddress
            },
            include: {
              metadata: true,
              factory: true
            }
          })
        )
      );

      // If launchpad not in database, try to sync it first
      if (!launchpad) {
        console.warn(`⚠️ Launchpad not found in database: ${normalizedLaunchpadAddress}, attempting to sync...`);
        
        // Validate address before creating contract (prevents ENS resolution on non-ENS chains)
        if (!ethers.isAddress(normalizedLaunchpadAddress)) {
          console.warn(`⚠️ Cannot sync: Invalid launchpad address ${normalizedLaunchpadAddress}`);
          return;
        }

        try {
          // Get factory from config (with retry on connection errors)
          const factory = await withRetry(() =>
            prisma.launchpadFactory.findUnique({
              where: { contractAddress: this.config.factoryAddress.toLowerCase() }
            })
          );

          if (factory) {
            // Create contract instance to fetch data
            const launchpadContract = new ethers.Contract(
              normalizedLaunchpadAddress,
              OddsLaunchpadABI,
              this.provider
            );

            // Fetch basic info from contract with retry
            let name: string = '';
            let symbol: string = '';
            let totalSupply: bigint = 0n;
            let owner: string = '';
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
              try {
                [name, symbol, totalSupply, owner] = await Promise.all([
                  launchpadContract.name(),
                  launchpadContract.symbol(),
                  launchpadContract.totalMaxSupply(), // max supply, NOT totalSupply() (= minted so far)
                  launchpadContract.owner()
                ]);
                break;
              } catch (rpcError: any) {
                retryCount++;
                if (retryCount >= maxRetries) {
                  throw rpcError;
                }
                console.warn(`⚠️ RPC error fetching launchpad data, retry ${retryCount}/${maxRetries}...`);
                await delay(1000 * retryCount);
              }
            }
            
            // Try to get treasury, fallback to owner or minter
            let treasury: string;
            try {
              treasury = await launchpadContract.treasury();
            } catch {
              // If treasury() fails, use owner or minter as fallback
              treasury = owner || event.to;
            }

            // Create launchpad in database with upsert to handle race conditions (with retry)
            try {
              const createdLaunchpad = await withRetry(() =>
                prisma.launchpad.upsert({
                  where: { contractAddress: normalizedLaunchpadAddress },
                  create: {
                    chainId: this.config.chainId,
                    factoryId: factory.id,
                    contractAddress: normalizedLaunchpadAddress,
                    creator: owner || event.to,
                    treasury: treasury,
                    name: name,
                    symbol: symbol,
                    totalMaxSupply: Number(totalSupply),
                    mintedCount: 0,
                    status: 'ACTIVE',
                    createdAt: new Date()
                  },
                  update: {} // Don't update if already exists
                })
              );

              console.log(`✅ Launchpad auto-synced to database: ${normalizedLaunchpadAddress}`);

              // Fetch with metadata (with retry)
              launchpad = await withRetry(() =>
                prisma.launchpad.findUnique({
                  where: { id: createdLaunchpad.id },
                  include: { metadata: true, factory: true }
                })
              );
            } catch (dbError: any) {
              // If unique constraint error, just fetch the existing launchpad
              if (dbError.code === 'P2002') {
                console.log(`ℹ️ Launchpad already exists (race condition), fetching from database...`);
                launchpad = await withRetry(() =>
                  prisma.launchpad.findUnique({
                    where: { contractAddress: normalizedLaunchpadAddress },
                    include: { metadata: true, factory: true }
                  })
                );
              } else {
                throw dbError;
              }
            }
          }
        } catch (syncError) {
          console.error(`❌ Failed to auto-sync launchpad:`, syncError);
          // Try to fetch launchpad one more time in case another process created it (with retry)
          launchpad = await withRetry(() =>
            prisma.launchpad.findUnique({
              where: { contractAddress: normalizedLaunchpadAddress },
              include: { metadata: true, factory: true }
            })
          ).catch(() => null); // If still fails, return null
          
          if (!launchpad) {
            return; // Skip this mint if we can't sync the launchpad
          }
        }
      }

      if (!launchpad) {
        console.warn(`⚠️ Unable to process mint - launchpad ${normalizedLaunchpadAddress} not available`);
        return;
      }

      // Get mint price from active phase (excludes platform fee)
      // This is more accurate than tx.value which includes platform fee
      let price = '0';
      try {
        // First try to get price from active phase in database
        const activePhase = await withDbLimit(() =>
          prisma.launchpadPhase.findFirst({
            where: {
              launchpadId: launchpad.id,
              isActive: true,
            },
            select: { price: true },
            orderBy: { phaseIndex: 'asc' }
          })
        );
        
        if (activePhase?.price) {
          price = activePhase.price;
        } else {
          // Fallback: Get from transaction value minus platform fee
          // Platform fee = 0.0003 ETH per NFT
          // For batch mints, platform fee = 0.0003 * quantity
          const PLATFORM_FEE_PER_NFT = BigInt('300000000000000'); // 0.0003 ETH in wei
          
          let retryCount = 0;
          const maxRetries = 3;
          let tx = null;
          
          while (retryCount < maxRetries && !tx) {
            try {
              tx = await this.provider.getTransaction(event.txHash);
              break;
            } catch (rpcError: any) {
              retryCount++;
              if (retryCount >= maxRetries) {
                console.warn(`⚠️ Failed to fetch transaction ${event.txHash} after ${maxRetries} retries, using price 0`);
                break;
              }
              console.warn(`⚠️ RPC error fetching transaction, retry ${retryCount}/${maxRetries}...`);
              await delay(1000 * retryCount);
            }
          }
          
          if (tx?.value) {
            const totalPaid = BigInt(tx.value.toString());
            
            // Count how many mints in this transaction to calculate total platform fee
            // Check if this is a batch mint by looking at other events in same tx
            let mintsInTx = 1; // Default to 1 (current mint)
            
            try {
              // Count mints in this transaction from database
              const existingMintsInTx = await withDbLimit(() =>
                prisma.mint.count({
                  where: {
                    txHash: event.txHash,
                    launchpadId: launchpad.id
                  }
                })
              );
              
              // If we found existing mints, add 1 for current mint
              // Otherwise, we need to estimate from transaction logs
              if (existingMintsInTx > 0) {
                mintsInTx = existingMintsInTx + 1;
              } else {
                // Estimate from transaction receipt logs (count Transfer events)
                try {
                  const receipt = await this.provider.getTransactionReceipt(event.txHash);
                  if (receipt) {
                    // Count Transfer events (topic0 = Transfer event signature)
                    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
                    const transferEvents = receipt.logs.filter(log => 
                      log.topics[0] === transferTopic && 
                      log.address.toLowerCase() === normalizedLaunchpadAddress
                    );
                    mintsInTx = transferEvents.length;
                  }
                } catch (receiptError) {
                  // Use default 1 if receipt fetch fails
                }
              }
            } catch (countError) {
              // Use default 1 if count fails
            }
            
            // Calculate total platform fee based on number of mints
            const totalPlatformFee = PLATFORM_FEE_PER_NFT * BigInt(mintsInTx);
            
            // Subtract total platform fee from total paid to get total mint price
            const totalMintPrice = totalPaid > totalPlatformFee 
              ? totalPaid - totalPlatformFee 
              : BigInt(0);
            
            // Divide by number of mints to get price per NFT
            const pricePerNFT = mintsInTx > 0 
              ? totalMintPrice / BigInt(mintsInTx)
              : BigInt(0);
            
            price = pricePerNFT.toString();
            
            console.log(`💰 Calculated mint price: ${mintsInTx} NFTs, total paid: ${totalPaid}, platform fee: ${totalPlatformFee}, price per NFT: ${price}`);
          }
        }
      } catch (priceError) {
        console.warn(`⚠️ Error getting mint price for ${event.txHash}, using price 0:`, priceError);
        price = '0';
      }

      // Truncate addresses for display
      const actorShort = `${event.to.slice(0, 6)}...${event.to.slice(-4)}`;
      const tokenIdStr = event.tokenId.toString();

      // Only create activity if it doesn't exist (for mints only)
      if (needsActivity) {
        // Fetch NFT image for mint events
        let tokenImage: string | null = null;
        let originalImage: string | null = null;
        
        try {
          const nft = await withDbLimit(() =>
            prisma.nFT.findUnique({
              where: {
                contractAddress_tokenId_chainId: {
                  contractAddress: normalizedLaunchpadAddress,
                  tokenId: tokenIdStr,
                  chainId: this.config.chainId,
                },
              },
              select: {
                imageCachedUrl: true,
                imageOriginalUrl: true,
                imageThumbnailUrl: true,
              },
            })
          );
          
          // Use NFT image (prioritize cached, then thumbnail, then original)
          tokenImage = nft?.imageCachedUrl || nft?.imageThumbnailUrl || nft?.imageOriginalUrl || null;
          originalImage = nft?.imageOriginalUrl || null;
        } catch (nftError) {
          console.warn(`⚠️ Failed to fetch NFT image for token ${tokenIdStr}:`, nftError);
          // Continue without image - not critical
        }

        // Create activity record for mint
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            await withDbLimit(() =>
              prisma.activity.create({
                data: {
                  chainId: this.config.chainId,
                  factoryId: launchpad.factoryId,
                  launchpadId: launchpad.id,
                  type: ActivityType.MINT_OCCURRED,
                  actor: event.to,
                  description: `Minted by ${actorShort}`,
                  txHash: event.txHash,
                  blockNumber: event.blockNumber,
                  metadata: {
                    tokenId: tokenIdStr,
                    quantity: 1,
                    price: price,
                    collectionName: launchpad.name,
                    collectionSymbol: launchpad.symbol,
                    collectionImage: launchpad.metadata?.image || null,
                    tokenImage, // Add NFT individual image (cached URL)
                    originalImage, // Add original IPFS URL
                    from: event.from,
                    to: event.to
                  }
                }
              })
            );
            break;
          } catch (dbError: any) {
            if (dbError.code === 'P2002' || dbError.message?.includes('Unique constraint')) {
              break;
            }
            
            const isRetryable = 
              dbError.code === 'P2034' || 
              dbError.code === 'P2037' ||
              dbError.message?.includes('deadlock') || 
              dbError.message?.includes('timeout') ||
              dbError.message?.includes('too many clients');
            
            if (isRetryable && retryCount < maxRetries - 1) {
              retryCount++;
              await delay(500 * retryCount);
              continue;
            }
            
            throw dbError;
          }
        }
      }

      // Create mint record SEPARATELY from activity (always for mints, regardless of needsActivity)
      // Validate launchpad exists
      if (!launchpad || !launchpad.id) {
        console.error(`❌ Cannot create mint record: launchpad not found for ${normalizedLaunchpadAddress}`);
      } else {
          // Check if mint record already exists
          if (existingMint) {
            console.log(`ℹ️ Mint record already exists for NFT #${event.tokenId} (launchpadId: ${launchpad.id})`);
            
            // IMPORTANT: Even if mint exists, we should verify mintedCount and volume are correct
            // This handles cases where sync created the mint but didn't update count/volume
            try {
              const currentLaunchpad = await prisma.launchpad.findUnique({
                where: { id: launchpad.id },
                select: { mintedCount: true, volume: true }
              });
              
              const actualMintCount = await prisma.mint.count({
                where: { launchpadId: launchpad.id }
              });
              
              // Calculate actual volume from all mints
              const mintsWithPrice = await prisma.mint.findMany({
                where: { launchpadId: launchpad.id },
                select: { price: true }
              });
              
              const actualVolume = mintsWithPrice.reduce((sum, mint) => {
                return sum + BigInt(mint.price || '0');
              }, BigInt(0)).toString();
              
              const needsUpdate = 
                (currentLaunchpad && currentLaunchpad.mintedCount !== actualMintCount) ||
                (currentLaunchpad && currentLaunchpad.volume !== actualVolume);
              
              if (needsUpdate) {
                console.warn(`⚠️ Launchpad data mismatch!`);
                console.warn(`   mintedCount - DB: ${currentLaunchpad?.mintedCount}, Actual: ${actualMintCount}`);
                console.warn(`   volume - DB: ${currentLaunchpad?.volume}, Actual: ${actualVolume}`);
                console.warn(`   Fixing...`);
                
                await prisma.launchpad.update({
                  where: { id: launchpad.id },
                  data: { 
                    mintedCount: actualMintCount,
                    volume: actualVolume
                  }
                });
                console.log(`✅ Fixed mintedCount to ${actualMintCount} and volume to ${actualVolume}`);
              }
            } catch (verifyError) {
              console.warn(`⚠️ Failed to verify mintedCount and volume:`, verifyError);
            }
          } else {
            let mintRetryCount = 0;
            const mintMaxRetries = 3;
            let mintCreated = false;
            // Mint time = block time (not processing time, which differs after downtime/backfill)
            let mintTime = new Date();
            try {
              const mintBlock = await this.provider.getBlock(event.blockNumber);
              if (mintBlock?.timestamp) mintTime = new Date(mintBlock.timestamp * 1000);
            } catch {
              // keep processing time
            }
            
            while (mintRetryCount < mintMaxRetries && !mintCreated) {
              try {
                await withDbLimit(() =>
                  prisma.$transaction(async (tx) => {
                    // Create mint record
                    await tx.mint.create({
                      data: {
                        launchpadId: launchpad.id,
                        minter: event.to,
                        tokenId: Number(event.tokenId),
                        quantity: 1,
                        price: price,
                        txHash: event.txHash,
                        blockNumber: event.blockNumber,
                        createdAt: mintTime
                      }
                    });

                    // Get current volume to calculate new volume
                    const currentLaunchpad = await tx.launchpad.findUnique({
                      where: { id: launchpad.id },
                      select: { volume: true }
                    });

                    // Convert price to BigInt safely - handle decimal format
                    let mintPriceBigInt: bigint;
                    try {
                      // Check if price contains decimal point (incorrect format)
                      if (price.includes('.')) {
                        console.warn(`⚠️ Price in decimal format (${price}), converting to wei`);
                        mintPriceBigInt = BigInt(ethers.parseEther(price).toString());
                      } else {
                        mintPriceBigInt = BigInt(price);
                      }
                    } catch (conversionError) {
                      console.error(`❌ Failed to convert price "${price}" to BigInt:`, conversionError);
                      mintPriceBigInt = BigInt(0);
                    }

                    const currentVolume = BigInt(currentLaunchpad?.volume || '0');
                    const newVolume = (currentVolume + mintPriceBigInt).toString();

                    // Calculate actual mintedCount from mints table (same as sync-collection.ts)
                    // This ensures accuracy even if previous mints failed to update the counter
                    const actualMintCount = await tx.mint.count({
                      where: { launchpadId: launchpad.id }
                    });

                    // Update volume, lastMintAt, and mintedCount
                    // mintedCount is set to actual count from mints table (not incremented)
                    await tx.launchpad.update({
                      where: { id: launchpad.id },
                      data: {
                        volume: newVolume,
                        lastMintAt: mintTime,
                        mintedCount: actualMintCount
                      }
                    });
                  }, {
                    maxWait: 10000,
                    timeout: 20000,
                  })
                );
                
                mintCreated = true;
                console.log(`✅ Mint record INSERTED for NFT #${event.tokenId} (launchpadId: ${launchpad.id}, txHash: ${event.txHash}) - mintedCount incremented`);
              } catch (dbError: any) {
                if (dbError.code === 'P2002' || dbError.message?.includes('Unique constraint')) {
                  // Mint already exists (race condition), skip - mintedCount NOT incremented (correct behavior)
                  console.log(`ℹ️ Mint record already exists (constraint) for NFT #${event.tokenId} - mintedCount NOT incremented`);
                  mintCreated = true;
                  break;
                }
                
                const isRetryable = 
                  dbError.code === 'P2034' || 
                  dbError.code === 'P2037' ||
                  dbError.message?.includes('deadlock') || 
                  dbError.message?.includes('timeout') ||
                  dbError.message?.includes('too many clients');
                
                if (isRetryable && mintRetryCount < mintMaxRetries - 1) {
                  mintRetryCount++;
                  console.log(`⚠️ DB error creating mint record for #${event.tokenId}, retry ${mintRetryCount}/${mintMaxRetries}: ${dbError.message}`);
                  await delay(500 * mintRetryCount);
                  continue;
                }
                
                console.error(`❌ Failed to create mint record for NFT #${event.tokenId}:`, dbError.message || dbError);
                // Don't throw - continue with NFT processing
                break;
              }
            }
          }
        }

      // ========================================================================
      // Process NFT transfer event (handles ownership updates for mints)
      // For mints: creates NFT data + ownership
      // ========================================================================
      let nftSaveRetryCount = 0;
      const nftSaveMaxRetries = 3;
      let nftProcessed = false;
      
      while (nftSaveRetryCount < nftSaveMaxRetries && !nftProcessed) {
        try {
          // Get block timestamp for the transfer
          let blockTimestamp = new Date();
          try {
            const block = await this.provider.getBlock(event.blockNumber);
            if (block && block.timestamp) {
              blockTimestamp = new Date(block.timestamp * 1000);
            }
          } catch (blockError) {
            // Use current time as fallback
          }

          // Call NFT Event Handler to process transfer (mint/transfer/burn)
          // This handles:
          // - Mint: creates NFT data + ownership record
          // - Transfer: updates ownership to new owner
          // - Burn: removes ownership
          await this.nftEventHandler.handleTransferEvent({
            contractAddress: normalizedLaunchpadAddress,
            tokenId: event.tokenId.toString(),
            from: event.from,
            to: event.to,
            quantity: '1',
            txHash: event.txHash,
            blockNumber: event.blockNumber,
            blockTimestamp: blockTimestamp,
            logIndex: event.logIndex,
            tokenType: 'ERC721'
          });
          
          nftProcessed = true;
          
          // Log mint success
          console.log(`✅ NFT #${event.tokenId} minted and saved to database`);
        } catch (nftError: any) {
          nftSaveRetryCount++;
          
          // Check if it's a duplicate error (already processed)
          if (nftError.code === 'P2002' || nftError.message?.includes('Unique constraint')) {
            nftProcessed = true;
            break;
          }
          
          if (nftSaveRetryCount < nftSaveMaxRetries) {
            console.warn(`⚠️ Error processing NFT #${event.tokenId} transfer, retry ${nftSaveRetryCount}/${nftSaveMaxRetries}...`);
            await delay(500 * nftSaveRetryCount);
          } else {
            console.error(`❌ Failed to process NFT #${event.tokenId} transfer after ${nftSaveMaxRetries} retries:`, nftError);
            await this.logEventError('NFTTransferProcess', nftError, event, 'medium');
          }
        }
      }

      // ========================================================================
      // Batch mint tracking for WebSocket
      // Requirements: 4.2
      // ========================================================================
      if (this.eventEmitter) {
        try {
          // Get block timestamp for the event
          let blockTimestamp = new Date();
          try {
            const block = await this.provider.getBlock(event.blockNumber);
            if (block && block.timestamp) {
              blockTimestamp = new Date(block.timestamp * 1000);
            }
          } catch (blockError) {
            // Use current time as fallback
          }

          // Add to batch mint tracking
          const txHash = event.txHash;
          if (!this.batchMintsByTxHash.has(txHash)) {
            // Fetch NFT image (not collection image) for the first token
            let nftImageUrl: string | undefined;
            try {
              const nft = await prisma.nFT.findUnique({
                where: {
                  contractAddress_tokenId_chainId: {
                    contractAddress: normalizedLaunchpadAddress.toLowerCase(),
                    tokenId: event.tokenId.toString(),
                    chainId: this.config.chainId,
                  },
                },
                select: {
                  imageCachedUrl: true,
                  imageOriginalUrl: true,
                  imageThumbnailUrl: true,
                },
              });
              nftImageUrl = nft?.imageCachedUrl || nft?.imageThumbnailUrl || nft?.imageOriginalUrl || undefined;
            } catch (error) {
              console.warn(`⚠️ Failed to fetch NFT image for token #${event.tokenId}:`, error);
            }

            this.batchMintsByTxHash.set(txHash, {
              contractAddress: normalizedLaunchpadAddress,
              minter: event.to,
              tokenIds: [],
              timestamp: blockTimestamp,
              imageUrl: nftImageUrl, // Use NFT image, not collection image
            });
          }

          // Add token ID to batch
          const batch = this.batchMintsByTxHash.get(txHash)!;
          batch.tokenIds.push(event.tokenId.toString());

          // Clear existing timer if any
          if (this.batchMintTimers.has(txHash)) {
            clearTimeout(this.batchMintTimers.get(txHash)!);
          }

          // Set timer to emit batch after delay (to collect all mints in same tx)
          const timer = setTimeout(() => {
            const batchData = this.batchMintsByTxHash.get(txHash);
            if (batchData && this.eventEmitter) {
              // If only 1 NFT, emit as single mint
              if (batchData.tokenIds.length === 1) {
                this.eventEmitter.emitMintEvent({
                  contractAddress: batchData.contractAddress,
                  chainId: this.config.chainId,
                  minter: batchData.minter,
                  tokenId: batchData.tokenIds[0],
                  quantity: 1,
                  timestamp: batchData.timestamp,
                  transactionHash: txHash,
                  imageUrl: batchData.imageUrl,
                });
                console.log(`[WebSocket] Emitted single mint event for token #${batchData.tokenIds[0]}`);
              } else {
                // Multiple NFTs, emit as batch
                this.eventEmitter.emitBatchMintEvent({
                  contractAddress: batchData.contractAddress,
                  chainId: this.config.chainId,
                  minter: batchData.minter,
                  tokenIds: batchData.tokenIds,
                  totalQuantity: batchData.tokenIds.length,
                  timestamp: batchData.timestamp,
                  transactionHash: txHash,
                  imageUrl: batchData.imageUrl,
                });
                console.log(`[WebSocket] Emitted batch mint event for ${batchData.tokenIds.length} NFTs`);
              }
            }

            // Cleanup
            this.batchMintsByTxHash.delete(txHash);
            this.batchMintTimers.delete(txHash);
          }, this.BATCH_MINT_DELAY);

          this.batchMintTimers.set(txHash, timer);
        } catch (wsError) {
          // Log but don't throw - WebSocket errors shouldn't break the listener
          console.warn(`⚠️ Failed to track batch mint for token #${event.tokenId}:`, wsError);
        }
      }

    } catch (error) {
      console.error(`❌ Error handling mint event:`, error);
      // Log error but don't throw - continue processing other events
      await this.logActivityError('handleMintEvent', error, event);
    }
  }

  /**
   * Handle regular transfer event (non-mint, non-burn)
   * This handles transfers like OpenSea sales, wallet-to-wallet transfers, etc.
   */
  private async handleRegularTransferEvent(event: MintEvent): Promise<void> {
    try {
      // Normalize launchpad address to lowercase
      const normalizedLaunchpadAddress = event.launchpadAddress.toLowerCase();

      // Ensure launchpad is registered in listener (auto-discover)
      await this.ensureLaunchpadRegistered(normalizedLaunchpadAddress);

      // Check if this specific transfer was already processed (by txHash + logIndex)
      const existingTransfer = await withDbLimit(() =>
        withRetry(() =>
          prisma.nFTTransfer.findUnique({
            where: {
              txHash_logIndex: {
                txHash: event.txHash,
                logIndex: event.logIndex
              }
            }
          })
        )
      );

      if (existingTransfer) {
        // This exact transfer was already processed, skip
        return;
      }

      // Get launchpad from database
      const launchpad = await withDbLimit(() =>
        withRetry(() =>
          prisma.launchpad.findUnique({
            where: {
              contractAddress: normalizedLaunchpadAddress
            },
            include: {
              metadata: true,
              factory: true
            }
          })
        )
      );

      if (!launchpad) {
        console.warn(`⚠️ Unable to process transfer - launchpad ${normalizedLaunchpadAddress} not found`);
        return;
      }

      // Get transfer price from transaction value (for marketplace sales)
      let price = '0';
      try {
        const tx = await this.provider.getTransaction(event.txHash);
        if (tx?.value) {
          price = tx.value.toString();
        }
      } catch (priceError) {
        console.warn(`⚠️ Error getting transfer price for ${event.txHash}:`, priceError);
      }

      // Truncate addresses for display
      const fromShort = `${event.from.slice(0, 6)}...${event.from.slice(-4)}`;
      const toShort = `${event.to.slice(0, 6)}...${event.to.slice(-4)}`;
      const tokenIdStr = event.tokenId.toString();

      console.log(`🔄 Processing regular transfer: NFT #${tokenIdStr} from ${fromShort} to ${toShort}`);

      // Check if activity already exists
      const existingActivity = await withDbLimit(() =>
        withRetry(() => 
          prisma.activity.findFirst({
            where: {
              txHash: event.txHash,
              type: ActivityType.TRANSFER_OCCURRED,
              metadata: {
                path: ['tokenId'],
                equals: tokenIdStr
              }
            }
          })
        )
      );

      // Create activity record for transfer
      if (!existingActivity) {
        // Fetch NFT image
        let tokenImage: string | null = null;
        let originalImage: string | null = null;
        
        try {
          const nft = await withDbLimit(() =>
            prisma.nFT.findUnique({
              where: {
                contractAddress_tokenId_chainId: {
                  contractAddress: normalizedLaunchpadAddress,
                  tokenId: tokenIdStr,
                  chainId: this.config.chainId,
                },
              },
              select: {
                imageCachedUrl: true,
                imageOriginalUrl: true,
                imageThumbnailUrl: true,
              },
            })
          );
          
          tokenImage = nft?.imageCachedUrl || nft?.imageThumbnailUrl || nft?.imageOriginalUrl || null;
          originalImage = nft?.imageOriginalUrl || null;
        } catch (nftError) {
          console.warn(`⚠️ Failed to fetch NFT image for token ${tokenIdStr}:`, nftError);
        }

        // Create activity record
        await withDbLimit(() =>
          prisma.activity.create({
            data: {
              chainId: this.config.chainId,
              factoryId: launchpad.factoryId,
              launchpadId: launchpad.id,
              type: ActivityType.TRANSFER_OCCURRED,
              actor: event.to, // New owner
              description: `Transferred from ${fromShort} to ${toShort}`,
              txHash: event.txHash,
              blockNumber: event.blockNumber,
              metadata: {
                tokenId: tokenIdStr,
                quantity: 1,
                price: price,
                collectionName: launchpad.name,
                collectionSymbol: launchpad.symbol,
                collectionImage: launchpad.metadata?.image || null,
                tokenImage,
                originalImage,
                from: event.from,
                to: event.to
              }
            }
          })
        );

        console.log(`✅ Transfer activity recorded for NFT #${tokenIdStr}`);
      }

      // Process NFT transfer (update ownership)
      try {
        // Get block timestamp for the transfer
        let blockTimestamp = new Date();
        try {
          const block = await this.provider.getBlock(event.blockNumber);
          if (block && block.timestamp) {
            blockTimestamp = new Date(block.timestamp * 1000);
          }
        } catch (blockError) {
          // Use current time as fallback
        }

        // Call NFT Event Handler to update ownership
        await this.nftEventHandler.handleTransferEvent({
          contractAddress: normalizedLaunchpadAddress,
          tokenId: event.tokenId.toString(),
          from: event.from,
          to: event.to,
          quantity: '1',
          txHash: event.txHash,
          blockNumber: event.blockNumber,
          blockTimestamp: blockTimestamp,
          logIndex: event.logIndex,
          tokenType: 'ERC721'
        });
        
        console.log(`✅ NFT #${event.tokenId} ownership transferred from ${fromShort} to ${toShort}`);
      } catch (nftError: any) {
        console.error(`❌ Failed to process NFT #${event.tokenId} transfer:`, nftError);
        await this.logEventError('NFTTransferProcess', nftError, event, 'medium');
      }

    } catch (error) {
      console.error(`❌ Error handling regular transfer event:`, error);
      await this.logActivityError('handleRegularTransferEvent', error, event);
    }
  }

  /**
   * Handle NFT transfer only (for burns, without creating activity or decrementing counts)
   * 
   * NOTE: When a burn happens, the contract emits BOTH:
   *   1. Burned(owner, tokenId) - handled by userEventHandler.handleBurnedEvent
   *      → creates BURN_OCCURRED activity, decrements mintedCount, emits WebSocket
   *   2. Transfer(from=owner, to=0x0, tokenId) - handled HERE
   *      → ONLY handles ownership removal + transfer record (to avoid double-counting)
   * 
   * We intentionally do NOT call nftEventHandler.handleTransferEvent() here because
   * that would trigger handleBurn() which decrements counts and creates activities
   * that are already handled by the Burned event handler.
   */
  private async handleNFTTransferOnly(event: MintEvent): Promise<void> {
    try {
      const normalizedLaunchpadAddress = event.launchpadAddress.toLowerCase();
      const tokenIdStr = event.tokenId.toString();

      // Get block timestamp for the transfer
      let blockTimestamp = new Date();
      try {
        const block = await this.provider.getBlock(event.blockNumber);
        if (block && block.timestamp) {
          blockTimestamp = new Date(block.timestamp * 1000);
        }
      } catch (blockError) {
        // Use current time as fallback
      }

      // Only update ownership (mark as burned) - don't decrement counts or create activities
      // Those are handled by the Burned event handler (userEventHandler.handleBurnedEvent)
      try {
        const nft = await prisma.nFT.findUnique({
          where: {
            contractAddress_tokenId_chainId: {
              contractAddress: normalizedLaunchpadAddress,
              tokenId: tokenIdStr,
              chainId: this.config.chainId,
            },
          },
          select: { id: true },
        });

        if (nft) {
          // Mark all current ownerships as not current (burned)
          await prisma.nFTOwnership.updateMany({
            where: {
              nftId: nft.id,
              isCurrent: true,
            },
            data: {
              isCurrent: false,
            },
          });

          // Create transfer record for the burn (for history tracking)
          try {
            const existing = await prisma.nFTTransfer.findUnique({
              where: {
                txHash_logIndex: {
                  txHash: event.txHash,
                  logIndex: event.logIndex,
                },
              },
            });

            if (!existing) {
              await prisma.nFTTransfer.create({
                data: {
                  chainId: this.config.chainId,
                  nftId: nft.id,
                  fromAddress: event.from.toLowerCase(),
                  toAddress: event.to.toLowerCase(),
                  quantity: '1',
                  txHash: event.txHash,
                  blockNumber: event.blockNumber,
                  blockTimestamp: blockTimestamp,
                  logIndex: event.logIndex,
                  transferType: 'BURN',
                },
              });
            }
          } catch (transferError: any) {
            if (transferError.code === 'P2002') {
              // Duplicate transfer record, skip
            } else {
              console.warn(`⚠️ Failed to create burn transfer record:`, transferError);
            }
          }

          console.log(`✅ NFT #${tokenIdStr} burn ownership updated`);
        }
      } catch (ownerError) {
        console.warn(`⚠️ Failed to update burn ownership for NFT #${tokenIdStr}:`, ownerError);
      }
    } catch (error) {
      console.error(`❌ Error handling NFT transfer for burn:`, error);
      await this.logActivityError('handleNFTTransferOnly', error, event);
    }
  }

  /**
   * Handle connection errors with exponential backoff
   */
  private restartTimer?: NodeJS.Timeout;
  private stopped = false;

  /**
   * Schedule a background restart with exponential backoff (max 60s).
   * Retries forever: a chain listener must never stay dead after an outage.
   * The failover provider already switches RPCs, so the provider is reused.
   */
  private scheduleRestart(error: any): void {
    if (this.stopped || this.restartTimer || this.isRunning) return;

    this.retryCount++;
    const delayMs = Math.min(this.retryDelay * Math.pow(2, Math.min(this.retryCount - 1, 6)), 60000);
    console.log(`⏳ Chain ${this.config.chainId}: restarting listener in ${delayMs}ms (attempt ${this.retryCount}) after: ${error instanceof Error ? error.message : String(error)}`);

    this.restartTimer = setTimeout(async () => {
      this.restartTimer = undefined;
      if (this.stopped || this.isRunning) return;
      try {
        await this.start();
        console.log(`✅ Chain ${this.config.chainId}: listener restarted after ${this.retryCount} attempt(s)`);
      } catch {
        // start() already scheduled the next attempt
      }
    }, delayMs);
  }

  /**
   * Handle connection errors (WebSocket mode): tear down and restart in the background.
   */
  private async handleConnectionError(error: any): Promise<void> {
    await this.logActivityError('handleConnectionError', error, { attempt: this.retryCount + 1 });
    await this.stopInternal();
    this.scheduleRestart(error);
  }

  /** Poller + RPC health, used by /health and the watchdog. */
  getPollerHealth(): (PollerHealth & { rpcEndpoints?: ReturnType<FailoverJsonRpcProvider['getEndpointStatus']> }) | null {
    if (!this.unifiedPoller) return null;
    const health = this.unifiedPoller.getHealth();
    if (this.provider instanceof FailoverJsonRpcProvider) {
      return { ...health, rpcEndpoints: this.provider.getEndpointStatus() };
    }
    return health;
  }

  /**
   * Write activity to database with retry logic and duplicate prevention
   */
  private async writeActivityWithRetry(data: any, attempt: number = 1): Promise<void> {
    const maxAttempts = this.maxDatabaseRetries;
    const retryDelay = 1000 * attempt; // Exponential backoff: 1s, 2s, 3s, etc.

    try {
      // For mint activities, check for duplicates using txHash + tokenId
      if (data.type === ActivityType.MINT_OCCURRED && data.txHash && data.metadata?.tokenId) {
        const existing = await prisma.activity.findFirst({
          where: {
            txHash: data.txHash,
            type: data.type,
            launchpadId: data.launchpadId,
            metadata: {
              path: ['tokenId'],
              equals: data.metadata.tokenId
            }
          }
        });
        
        if (existing) {
          console.log(`🔄 Duplicate mint detected and skipped: ${data.txHash} Token #${data.metadata.tokenId}`);
          return;
        }
      }
      
      // Create the activity
      await prisma.activity.create({ data });
      
    } catch (error: any) {
      // Skip logging for duplicate errors
      if (error.code === 'P2002' || error.message?.includes('Unique constraint') || error.message?.includes('already exists')) {
        console.log(`⚠️ Duplicate activity skipped: ${data.txHash}`);
        return;
      }

      console.error(`❌ Database write failed (attempt ${attempt}/${maxAttempts}):`, error);

      if (attempt < maxAttempts) {
        console.log(`⏳ Retrying database write in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return this.writeActivityWithRetry(data, attempt + 1);
      } else {
        console.error(`❌ Database write failed after ${maxAttempts} attempts. Logging error.`);
        await this.logActivityError('writeActivityWithRetry', error, data);
        // Don't throw - just log and continue
      }
    }
  }

  /**
   * Log error using centralized error logger
   */
  private async logActivityError(context: string, error: any, data?: any): Promise<void> {
    try {
      const errorData = {
        ...data,
        chainId: this.config.chainId,
        factoryAddress: this.config.factoryAddress
      };

      // Determine severity based on context
      let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';
      
      if (context.includes('Connection') || context.includes('RPC')) {
        severity = 'high';
      } else if (context.includes('database') || context.includes('write')) {
        severity = 'high';
      } else if (this.retryCount >= this.maxRetries) {
        severity = 'critical';
      }

      logError(`ActivityListener.${context}`, error, errorData, severity);
    } catch (logErr) {
      console.error('Failed to log error:', logErr);
    }
  }

  /**
   * Get listener status
   */
  getStatus(): {
    chainId: number;
    isRunning: boolean;
    factoryAddress: string;
    launchpadCount: number;
    retryCount: number;
    enabledEventsCount: number;
    enabledEvents: string[];
  } {
    return {
      chainId: this.config.chainId,
      isRunning: this.isRunning,
      factoryAddress: this.config.factoryAddress,
      launchpadCount: this.launchpadContracts.size,
      retryCount: this.retryCount,
      enabledEventsCount: this.enabledEvents.size,
      enabledEvents: Array.from(this.enabledEvents),
    };
  }
}
