import { ActivityListener, ActivityListenerConfig } from './activity-listener';
import { MarketplaceEventListener } from './marketplace-event-listener';
import { prisma } from '../../config/database';
import { getChainConfig } from '../../config/chains';
import { getSupportedMarketplaces } from '../../config/marketplace-contracts';
import { EventEmitter } from '../websocket/event-emitter';
import { WebSocketManager as WebSocketManagerType } from '../websocket/event-emitter';
import { WebSocketManager } from './websocket-manager';
import { EventProcessor } from '../processors/event-processor';
import { ethers } from 'ethers';
import { getChainWebSocketUrl, isWebSocketEnabledForChain } from '../../config/websocket-config';
import { blockchainConfig } from '../../config/blockchain';

export interface ListenerStatus {
  chainId: number;
  chainName: string;
  isRunning: boolean;
  factoryAddress: string;
  launchpadCount: number;
  retryCount: number;
  enabledEventsCount?: number;
  enabledEvents?: string[];
  marketplaceListenerRunning?: boolean;
  supportedMarketplaces?: string[];
  webSocketEnabled?: boolean; // WebSocket feature enabled for this chain
  webSocketConnections?: number; // Number of active WebSocket connections
  featuredLaunchpads?: number; // Number of featured launchpads
  error?: string;
  poller?: ReturnType<ActivityListener['getPollerHealth']>;
  liveness?: {
    lastEventReceivedAt: number;
    timeSinceLastEventMs: number;
    timeSinceLastEventMinutes: number;
    consecutiveStaleChecks: number;
    isStale: boolean;
    staleThresholdMs: number;
  };
}

export class MultiChainListenerManager {
  private listeners: Map<number, ActivityListener> = new Map();
  private marketplaceListeners: Map<number, MarketplaceEventListener> = new Map();
  private webSocketManagers: Map<number, WebSocketManager> = new Map(); // WebSocket managers per chain
  private errors: Map<number, string> = new Map();
  private eventEmitter: EventEmitter | null = null;

  /**
   * Set the WebSocket event emitter for real-time updates
   */
  setEventEmitter(websocketManager: WebSocketManagerType): void {
    this.eventEmitter = new EventEmitter(websocketManager);
    console.log('🔌 WebSocket EventEmitter initialized for MultiChainListenerManager');
  }

  /**
   * Initialize WebSocket manager for a specific chain
   * 
   * @param chainId - Chain ID to initialize WebSocket for
   * @returns Promise that resolves when WebSocket manager is initialized
   */
  private async initializeWebSocketManager(chainId: number): Promise<void> {
    try {
      // Check if WebSocket is enabled for this chain
      const isEnabled = await isWebSocketEnabledForChain(chainId);
      
      if (!isEnabled) {
        console.log(`[MultiChainListenerManager] WebSocket not enabled for chain ${chainId}, skipping`);
        return;
      }

      // Get WebSocket URL from database
      const wsUrl = await getChainWebSocketUrl(chainId);
      
      if (!wsUrl) {
        console.warn(`[MultiChainListenerManager] No WebSocket URL available for chain ${chainId}`);
        return;
      }

      console.log(`[MultiChainListenerManager] Initializing WebSocket manager for chain ${chainId}...`);

      // Create WebSocket provider
      const network = ethers.Network.from(chainId);
      const wsProvider = new ethers.WebSocketProvider(wsUrl, network, {
        staticNetwork: true
      });

      // Get or create EventProcessor (singleton)
      const { eventProcessor } = await import('../processors/event-processor');

      // Create WebSocket manager for this chain
      const wsManager = new WebSocketManager(chainId, wsProvider, eventProcessor);

      // Initialize connections for featured launchpads
      await wsManager.initialize();

      // Store manager
      this.webSocketManagers.set(chainId, wsManager);

      console.log(`[MultiChainListenerManager] ✅ WebSocket manager initialized for chain ${chainId}`);
      console.log(`   └─ Active connections: ${wsManager.getActiveConnectionCount()}`);
    } catch (error) {
      console.error(`[MultiChainListenerManager] ❌ Failed to initialize WebSocket manager for chain ${chainId}:`, error);
      // Don't throw - allow chain to continue with polling only
    }
  }

  /**
   * Initialize listeners for all active chains
   */
  async initializeAll(): Promise<void> {
    try {
      console.log('🚀 Initializing multi-chain activity listeners...');

      // Get all active chains from database (limited to LISTENER_CHAIN_IDS)
      const { getListenerChainIds } = await import('../database/bootstrap');
      const chainIds = getListenerChainIds();
      const chains = await prisma.chain.findMany({
        where: {
          ...(chainIds.length > 0 ? { chainId: { in: chainIds } } : {}),
          factories: {
            some: {
              isActive: true
            }
          }
        },
        include: {
          factories: {
            where: {
              isActive: true
            }
          },
          launchpads: {
            where: {
              status: 'ACTIVE'
            },
            select: {
              contractAddress: true
            }
          }
        }
      });

      console.log(`📊 Found ${chains.length} active chains with factories`);
      console.log(`📋 Found ${chains.reduce((sum, c) => sum + c.launchpads.length, 0)} active launchpads`);

      // Initialize listener for each chain
      const initPromises = chains.map(async (chain) => {
        try {
          console.log(`🔍 Initializing chain ${chain.chainId} (${chain.name}) with ${chain.launchpads.length} launchpads`);
          
          // Get RPC URL from database (support multiple RPCs separated by comma)
          if (!chain.rpcUrl) {
            const error = `RPC URL not found in database for chainId ${chain.chainId}`;
            console.warn(`⚠️ ${error}`);
            this.errors.set(chain.chainId, error);
            return;
          }

          // Parse multiple RPC URLs (comma-separated)
          const rpcUrls = chain.rpcUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
          if (rpcUrls.length === 0) {
            const error = `No valid RPC URLs found for chainId ${chain.chainId}`;
            console.warn(`⚠️ ${error}`);
            this.errors.set(chain.chainId, error);
            return;
          }

          // Use first RPC URL as primary (failover will be handled by provider-manager)
          const primaryRpcUrl = rpcUrls[0];
          console.log(`   RPC URL: ${primaryRpcUrl.substring(0, 50)}...${rpcUrls.length > 1 ? ` (+${rpcUrls.length - 1} fallback)` : ''}`);

          // Get factory address (use first active factory)
          const factory = chain.factories[0];
          if (!factory) {
            const error = `No active factory found for chain ${chain.chainId}`;
            console.warn(`⚠️ ${error}`);
            this.errors.set(chain.chainId, error);
            return;
          }

          console.log(`   Factory: ${factory.contractAddress}`);

          // Get launchpad addresses
          const launchpadAddresses = chain.launchpads.map(lp => lp.contractAddress);
          console.log(`   Launchpads: ${launchpadAddresses.length} active`);

          // Determine if using HTTP or WebSocket
          const isHttpProvider = !primaryRpcUrl.startsWith('ws://') && !primaryRpcUrl.startsWith('wss://');
          
          // All launchpad events are fetched with ONE eth_getLogs per block range
          // (topics are OR'ed), so enabling every event costs no extra RPC calls.
          // The old "critical events only" limit silently dropped phase, price,
          // pause, airdrop and withdraw updates once a chain had >10 launchpads.
          const enabledEvents: string[] | undefined = undefined;
          console.log(`✅ Chain ${chain.chainId} using ${isHttpProvider ? 'HTTP' : 'WebSocket'} with ${launchpadAddresses.length} launchpads - enabling ALL events`);

          // Create listener config with multiple RPC URLs support
          const config: ActivityListenerConfig = {
            chainId: chain.chainId,
            rpcUrl: primaryRpcUrl,
            rpcUrls: rpcUrls, // Pass all RPC URLs for failover
            factoryAddress: factory.contractAddress.toLowerCase(), // Normalize to lowercase
            launchpadAddresses: launchpadAddresses.map(addr => addr.toLowerCase()), // Normalize all addresses
            enabledEvents
          };

          // Add chain listener (errors are handled internally)
          await this.addChain(chain.chainId, config);

          // Add marketplace listener if chain supports marketplaces
          await this.addMarketplaceListener(chain.chainId, primaryRpcUrl, rpcUrls);

          // Initialize WebSocket manager for featured launchpads (if enabled)
          await this.initializeWebSocketManager(chain.chainId);

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`❌ Failed to initialize listener for chain ${chain.chainId}:`, errorMsg);
          this.errors.set(chain.chainId, errorMsg);
          // Continue with other chains
        }
      });

      // Wait for all initialization attempts to complete
      const results = await Promise.allSettled(initPromises);
      
      // Log summary
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      console.log(`📊 Initialization complete: ${successful} successful, ${failed} failed`);

      console.log(`✅ Multi-chain listener manager initialized with ${this.listeners.size} active chains`);

    } catch (error) {
      console.error('❌ Failed to initialize multi-chain listener manager:', error);
      throw error;
    }
  }

  /**
   * Add listener for a specific chain
   */
  async addChain(chainId: number, config?: ActivityListenerConfig): Promise<void> {
    try {
      // Check if already exists
      if (this.listeners.has(chainId)) {
        console.log(`⚠️ Listener for chain ${chainId} already exists`);
        return;
      }

      // If config not provided, fetch from database
      if (!config) {
        const chain = await prisma.chain.findUnique({
          where: { chainId },
          include: {
            factories: {
              where: { isActive: true },
              take: 1
            },
            launchpads: {
              where: { status: 'ACTIVE' },
              select: { contractAddress: true }
            }
          }
        });

        if (!chain) {
          const error = `Chain ${chainId} not found in database`;
          this.errors.set(chainId, error);
          throw new Error(error);
        }

        const factory = chain.factories[0];
        if (!factory) {
          const error = `No active factory found for chain ${chainId}`;
          this.errors.set(chainId, error);
          throw new Error(error);
        }

        // Get RPC URL from database (support multiple RPCs separated by comma)
        if (!chain.rpcUrl) {
          const error = `RPC URL not found in database for chainId ${chainId}`;
          this.errors.set(chainId, error);
          throw new Error(error);
        }

        // Parse multiple RPC URLs (comma-separated)
        const rpcUrls = chain.rpcUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
        if (rpcUrls.length === 0) {
          const error = `No valid RPC URLs found for chainId ${chainId}`;
          this.errors.set(chainId, error);
          throw new Error(error);
        }

        config = {
          chainId,
          rpcUrl: rpcUrls[0], // Primary RPC
          rpcUrls: rpcUrls, // All RPCs for failover
          factoryAddress: factory.contractAddress.toLowerCase(), // Normalize to lowercase
          launchpadAddresses: chain.launchpads.map(lp => lp.contractAddress.toLowerCase()) // Normalize all addresses
        };
      }

      // Create and start listener (pass eventEmitter for WebSocket real-time updates)
      const listener = new ActivityListener(config, this.eventEmitter || undefined);
      
      try {
        await listener.start();
        this.listeners.set(chainId, listener);
        this.errors.delete(chainId); // Clear any previous errors
        // Removed verbose logging
        // console.log(`✅ Added and started listener for chain ${chainId}`);
      } catch (startError) {
        // Store listener even if start fails (it will retry internally)
        this.listeners.set(chainId, listener);
        const errorMsg = startError instanceof Error ? startError.message : String(startError);
        this.errors.set(chainId, errorMsg);
        console.warn(`⚠️ Listener for chain ${chainId} added but failed to start: ${errorMsg}`);
        // Don't throw - allow other chains to continue
      }

    } catch (error) {
      console.error(`❌ Failed to add listener for chain ${chainId}:`, error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.errors.set(chainId, errorMsg);
      // Don't throw - allow other chains to continue
    }
  }

  /**
   * Add marketplace listener for a specific chain
   */
  async addMarketplaceListener(chainId: number, rpcUrl: string, rpcUrls?: string[]): Promise<void> {
    try {
      // Check if marketplace listener already exists
      if (this.marketplaceListeners.has(chainId)) {
        console.log(`⚠️ Marketplace listener for chain ${chainId} already exists`);
        return;
      }

      // Get supported marketplaces for this chain
      const supportedMarketplaces = getSupportedMarketplaces(chainId);
      
      if (supportedMarketplaces.length === 0) {
        console.log(`ℹ️ No marketplace contracts configured for chain ${chainId}, skipping marketplace listener`);
        return;
      }

      console.log(`🏪 Initializing marketplace listener for chain ${chainId} with ${supportedMarketplaces.length} marketplaces: ${supportedMarketplaces.join(', ')}`);

      // Create marketplace listener with multiple RPC support
      const marketplaceListener = new MarketplaceEventListener({
        chainId,
        rpcUrl,
        rpcUrls: rpcUrls, // Pass all RPC URLs for failover
        marketplaces: supportedMarketplaces,
        errorThreshold: 10,
        retryAttempts: 3
      });

      // Start marketplace listener
      try {
        await marketplaceListener.start();
        this.marketplaceListeners.set(chainId, marketplaceListener);
        console.log(`✅ Marketplace listener started for chain ${chainId}`);
      } catch (startError) {
        const errorMsg = startError instanceof Error ? startError.message : String(startError);
        console.warn(`⚠️ Marketplace listener for chain ${chainId} failed to start: ${errorMsg}`);
        // Don't throw - allow other chains to continue
      }

    } catch (error) {
      console.error(`❌ Failed to add marketplace listener for chain ${chainId}:`, error);
      // Don't throw - allow other chains to continue
    }
  }

  /**
   * Remove marketplace listener for a specific chain
   */
  async removeMarketplaceListener(chainId: number): Promise<void> {
    try {
      const listener = this.marketplaceListeners.get(chainId);

      if (!listener) {
        console.log(`⚠️ Marketplace listener for chain ${chainId} not found`);
        return;
      }

      // Stop listener
      await listener.stop();

      // Remove from map
      this.marketplaceListeners.delete(chainId);

      console.log(`✅ Removed marketplace listener for chain ${chainId}`);

    } catch (error) {
      console.error(`❌ Failed to remove marketplace listener for chain ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Remove listener for a specific chain
   */
  async removeChain(chainId: number): Promise<void> {
    try {
      const listener = this.listeners.get(chainId);

      if (!listener) {
        console.log(`⚠️ Listener for chain ${chainId} not found`);
        return;
      }

      // Stop activity listener
      await listener.stop();

      // Stop marketplace listener if exists
      await this.removeMarketplaceListener(chainId);

      // Remove from map
      this.listeners.delete(chainId);
      this.errors.delete(chainId);

      console.log(`✅ Removed listener for chain ${chainId}`);

    } catch (error) {
      console.error(`❌ Failed to remove listener for chain ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Restart listener for a specific chain
   */
  async restartChain(chainId: number): Promise<void> {
    try {
      console.log(`🔄 Restarting listeners for chain ${chainId}`);

      // Stop activity listener
      const listener = this.listeners.get(chainId);
      if (listener) {
        await listener.stop();
        this.listeners.delete(chainId);
      }

      // Stop marketplace listener
      await this.removeMarketplaceListener(chainId);

      // Restart both listeners
      await this.addChain(chainId);
      
      // Get RPC URL from database for marketplace listener
      const chain = await prisma.chain.findUnique({
        where: { chainId },
        select: { rpcUrl: true }
      });
      
      if (chain?.rpcUrl) {
        const rpcUrls = chain.rpcUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
        await this.addMarketplaceListener(chainId, rpcUrls[0], rpcUrls);
      }

      console.log(`✅ Restarted listeners for chain ${chainId}`);

    } catch (error) {
      console.error(`❌ Failed to restart listeners for chain ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Add a launchpad to a specific chain listener
   */
  async addLaunchpadToChain(chainId: number, launchpadAddress: string): Promise<void> {
    try {
      const listener = this.listeners.get(chainId);

      if (!listener) {
        throw new Error(`Listener for chain ${chainId} not found`);
      }

      await listener.addLaunchpad(launchpadAddress);

      // Removed verbose logging
      // console.log(`✅ Added launchpad ${launchpadAddress} to chain ${chainId} listener`);

    } catch (error) {
      console.error(`❌ Failed to add launchpad to chain ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Remove a launchpad from a specific chain listener
   */
  async removeLaunchpadFromChain(chainId: number, launchpadAddress: string): Promise<void> {
    try {
      const listener = this.listeners.get(chainId);

      if (!listener) {
        throw new Error(`Listener for chain ${chainId} not found`);
      }

      await listener.removeLaunchpad(launchpadAddress);

      // Removed verbose logging
      // console.log(`✅ Removed launchpad ${launchpadAddress} from chain ${chainId} listener`);

    } catch (error) {
      console.error(`❌ Failed to remove launchpad from chain ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Get status of all listeners
   */
  async getStatus(): Promise<ListenerStatus[]> {
    try {
      const statuses: ListenerStatus[] = [];

      // Get all chains from database
      const chains = await prisma.chain.findMany({
        select: {
          chainId: true,
          name: true
        }
      });

      for (const chain of chains) {
        const listener = this.listeners.get(chain.chainId);
        const marketplaceListener = this.marketplaceListeners.get(chain.chainId);
        const error = this.errors.get(chain.chainId);

        if (listener) {
          const status = listener.getStatus();
          const marketplaceStatus = marketplaceListener?.getStatus();
          const livenessStatus = listener.getEventLivenessStatus();
          
          statuses.push({
            chainId: chain.chainId,
            chainName: chain.name,
            isRunning: status.isRunning,
            factoryAddress: status.factoryAddress,
            launchpadCount: status.launchpadCount,
            retryCount: status.retryCount,
            enabledEventsCount: status.enabledEventsCount,
            enabledEvents: status.enabledEvents,
            marketplaceListenerRunning: marketplaceStatus?.isRunning || false,
            supportedMarketplaces: marketplaceStatus?.contracts.map(c => c.marketplace) || [],
            error: error,
            liveness: livenessStatus,
            poller: listener.getPollerHealth() ?? undefined,
          });
        } else {
          statuses.push({
            chainId: chain.chainId,
            chainName: chain.name,
            isRunning: false,
            factoryAddress: 'N/A',
            launchpadCount: 0,
            retryCount: 0,
            marketplaceListenerRunning: false,
            supportedMarketplaces: [],
            error: error || 'Not initialized'
          });
        }
      }

      return statuses;

    } catch (error) {
      console.error('❌ Failed to get listener statuses:', error);
      throw error;
    }
  }

  /**
   * Get status for a specific chain
   */
  async getChainStatus(chainId: number): Promise<ListenerStatus | null> {
    try {
      const listener = this.listeners.get(chainId);
      const marketplaceListener = this.marketplaceListeners.get(chainId);
      const error = this.errors.get(chainId);

      const chain = await prisma.chain.findUnique({
        where: { chainId },
        select: { name: true }
      });

      if (!chain) {
        return null;
      }

      if (listener) {
        const status = listener.getStatus();
        const marketplaceStatus = marketplaceListener?.getStatus();
        
        return {
          chainId,
          chainName: chain.name,
          isRunning: status.isRunning,
          factoryAddress: status.factoryAddress,
          launchpadCount: status.launchpadCount,
          retryCount: status.retryCount,
          enabledEventsCount: status.enabledEventsCount,
          enabledEvents: status.enabledEvents,
          marketplaceListenerRunning: marketplaceStatus?.isRunning || false,
          supportedMarketplaces: marketplaceStatus?.contracts.map(c => c.marketplace) || [],
          error: error,
        };
      }

      return {
        chainId,
        chainName: chain.name,
        isRunning: false,
        factoryAddress: 'N/A',
        launchpadCount: 0,
        retryCount: 0,
        marketplaceListenerRunning: false,
        supportedMarketplaces: [],
        error: error || 'Not initialized'
      };

    } catch (error) {
      console.error(`❌ Failed to get status for chain ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Stop all listeners
   */
  async stopAll(): Promise<void> {
    try {
      console.log('🛑 Stopping all listeners...');

      // Stop activity listeners
      const stopActivityPromises = Array.from(this.listeners.entries()).map(async ([chainId, listener]) => {
        try {
          await listener.stop();
        } catch (error) {
          console.error(`❌ Failed to stop activity listener for chain ${chainId}:`, error);
        }
      });

      // Stop marketplace listeners
      const stopMarketplacePromises = Array.from(this.marketplaceListeners.entries()).map(async ([chainId, listener]) => {
        try {
          await listener.stop();
        } catch (error) {
          console.error(`❌ Failed to stop marketplace listener for chain ${chainId}:`, error);
        }
      });

      // Stop WebSocket managers
      const stopWebSocketPromises = Array.from(this.webSocketManagers.entries()).map(async ([chainId, manager]) => {
        try {
          await manager.shutdown();
        } catch (error) {
          console.error(`❌ Failed to stop WebSocket manager for chain ${chainId}:`, error);
        }
      });

      await Promise.allSettled([...stopActivityPromises, ...stopMarketplacePromises, ...stopWebSocketPromises]);

      this.listeners.clear();
      this.marketplaceListeners.clear();
      this.webSocketManagers.clear();
      this.errors.clear();

      console.log('✅ All listeners stopped');

    } catch (error) {
      console.error('❌ Failed to stop all listeners:', error);
      throw error;
    }
  }

  /**
   * Get active chain IDs
   */
  /**
   * Poller health per chain (cursor, head, lag, last success). Used by /health and the watchdog.
   */
  getPollerHealth(): Array<{ chainId: number; health: ReturnType<ActivityListener['getPollerHealth']> }> {
    return Array.from(this.listeners.entries()).map(([chainId, listener]) => ({
      chainId,
      health: listener.getPollerHealth(),
    }));
  }

  getActiveChainIds(): number[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * Check if a chain listener is running
   */
  isChainRunning(chainId: number): boolean {
    const listener = this.listeners.get(chainId);
    return listener ? listener.getStatus().isRunning : false;
  }

  /**
   * Get total number of active listeners
   */
  getActiveListenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Scan historical ContractDeployed events for a specific chain
   * Useful for catching events that happened before service started
   */
  async scanHistoricalDeployments(chainId: number, fromBlock: number, toBlock?: number): Promise<void> {
    try {
      const listener = this.listeners.get(chainId);

      if (!listener) {
        throw new Error(`Listener for chain ${chainId} not found`);
      }

      await listener.scanHistoricalDeployments(fromBlock, toBlock);

    } catch (error) {
      console.error(`❌ Failed to scan historical deployments for chain ${chainId}:`, error);
      throw error;
    }
  }

  /**
   * Get listener for a specific chain
   */
  getListener(chainId: number): ActivityListener | undefined {
    return this.listeners.get(chainId);
  }

  /**
   * Sync missing NFTs for all chains
   */
  async syncAllMissingNFTs(): Promise<Array<{ chainId: number; total: number; errors: number }>> {
    const results: Array<{ chainId: number; total: number; errors: number }> = [];

    console.log('🔄 Starting missing NFT sync for all chains...');

    for (const [chainId, listener] of this.listeners) {
      try {
        const result = await listener.autoSyncAllMissingNFTs();
        results.push({ chainId, ...result });
      } catch (error) {
        console.error(`❌ Error syncing chain ${chainId}:`, error);
        results.push({ chainId, total: 0, errors: 1 });
      }
    }

    console.log('✅ Missing NFT sync complete for all chains');
    return results;
  }
}

// Singleton instance
let multiChainListenerManagerInstance: MultiChainListenerManager | null = null;

export function getMultiChainListenerManager(): MultiChainListenerManager {
  if (!multiChainListenerManagerInstance) {
    multiChainListenerManagerInstance = new MultiChainListenerManager();
  }
  return multiChainListenerManagerInstance;
}

// Signal handling (graceful shutdown) lives in src/index.ts. Registering
// process.exit() handlers here raced with it and could exit before the
// pollers saved their cursor.
