/**
 * Provider Manager Module
 * 
 * Manages provider lifecycle, WebSocket connections, and reconnection logic
 * extracted from ActivityListener.
 */

import { ethers } from 'ethers';
import OddsLaunchpadFactoryABI from '../../../abi/OddsLaunchpadFactory.json';
import OddsLaunchpadABI from '../../../abi/OddsLaunchpad.json';
import type { ActivityListenerConfig } from './event-types';

/**
 * Provider state and lifecycle callbacks
 */
export interface ProviderManagerCallbacks {
  onReconnectSuccess?: () => Promise<void>;
  onReconnectFailed?: (error: any) => Promise<void>;
  getIsRunning: () => boolean;
  setIsRunning: (value: boolean) => void;
  stopInternal: () => Promise<void>;
  start: () => Promise<void>;
}

/**
 * Provider Manager
 * Handles provider creation, WebSocket connections, and reconnection logic
 */
export class ProviderManager {
  private config: ActivityListenerConfig;
  private provider: ethers.JsonRpcProvider | ethers.WebSocketProvider;
  private factoryContract: ethers.Contract;
  private launchpadContracts: Map<string, ethers.Contract> = new Map();
  private callbacks: ProviderManagerCallbacks;

  // Multiple RPC support
  private rpcUrls: string[];
  private currentRpcIndex: number = 0;
  
  // Round-robin load balancing
  private rpcRotationInterval?: NodeJS.Timeout;
  private readonly RPC_ROTATION_INTERVAL_MS = 300000; // 5 minutes

  // WebSocket reconnection tracking
  private isReconnecting: boolean = false;

  // WebSocket keep-alive ping interval
  private wsPingInterval?: NodeJS.Timeout;
  private readonly WS_PING_INTERVAL_MS = 30000; // Ping every 30 seconds

  // Event liveness tracking
  private lastEventReceivedAt: number = Date.now();
  private livenessCheckInterval?: NodeJS.Timeout;
  private readonly LIVENESS_CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
  private readonly EVENT_STALE_THRESHOLD_MS = 180000; // Stale if no events for 3 minutes
  private consecutiveStaleChecks: number = 0;
  private readonly MAX_STALE_CHECKS_BEFORE_RESUBSCRIBE = 2;

  // Filter recreation
  private filterRecreationInterval?: NodeJS.Timeout;
  private lastFilterRecreation: number = 0;

  // Connection retry
  private retryCount: number = 0;
  private maxRetries: number = 5;
  private retryDelay: number = 1000;

  constructor(
    config: ActivityListenerConfig,
    callbacks: ProviderManagerCallbacks
  ) {
    this.config = config;
    this.callbacks = callbacks;

    // Setup multiple RPC URLs for failover
    this.rpcUrls = config.rpcUrls && config.rpcUrls.length > 0 ? config.rpcUrls : [config.rpcUrl];
    this.currentRpcIndex = 0;

    if (this.rpcUrls.length > 1) {
      console.log(`🔄 Chain ${config.chainId}: Configured with ${this.rpcUrls.length} RPC endpoints for load balancing`);
      console.log(`   └─ Will rotate RPCs every ${this.RPC_ROTATION_INTERVAL_MS / 60000} minutes`);
    }

    // Initialize provider - always use HTTP for now to avoid eth_subscribe issues
    // WebSocket subscriptions will be tested and enabled per-chain basis
    const currentRpcUrl = this.rpcUrls[this.currentRpcIndex];
    const network = ethers.Network.from(this.config.chainId);
    this.provider = new ethers.JsonRpcProvider(
      currentRpcUrl.replace('wss://', 'https://').replace('ws://', 'http://'),
      network,
      {
        staticNetwork: true // Skip network detection to avoid "failed to detect network" errors
      }
    );
    const launchpadCount = config.launchpadAddresses?.length || 0;
    if (launchpadCount > 15) {
      this.provider.pollingInterval = 8000;
    } else if (launchpadCount > 10) {
      this.provider.pollingInterval = 6000;
    } else {
      this.provider.pollingInterval = 5000;
    }
    console.log(`📡 Using HTTP provider for chain ${config.chainId} (polling interval: ${this.provider.pollingInterval / 1000}s)`);
    console.log(`   └─ RPC URL: ${currentRpcUrl.replace('wss://', 'https://').replace('ws://', 'http://')}`);
    if (this.rpcUrls.length > 1) {
      console.log(`   └─ Fallback RPCs: ${this.rpcUrls.length - 1} available`);
    }
    console.log(`   └─ Note: WebSocket subscriptions disabled to avoid eth_subscribe errors`);

    // Validate factory address
    if (!ethers.isAddress(config.factoryAddress)) {
      throw new Error(`Invalid factory address: ${config.factoryAddress}. Must be a valid Ethereum address (0x...)`);
    }

    // Initialize factory contract
    this.factoryContract = new ethers.Contract(
      config.factoryAddress,
      OddsLaunchpadFactoryABI,
      this.provider
    );

    // Initialize launchpad contracts if provided
    if (config.launchpadAddresses) {
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

  /**
   * Get provider instance
   */
  getProvider(): ethers.JsonRpcProvider | ethers.WebSocketProvider {
    return this.provider;
  }

  /**
   * Get factory contract instance
   */
  getFactoryContract(): ethers.Contract {
    return this.factoryContract;
  }

  /**
   * Get launchpad contracts map
   */
  getLaunchpadContracts(): Map<string, ethers.Contract> {
    return this.launchpadContracts;
  }

  /**
   * Switch to next available RPC URL (failover or load balancing)
   */
  private switchToNextRpc(): string | null {
    if (this.rpcUrls.length <= 1) {
      return null; // No fallback available
    }

    const previousIndex = this.currentRpcIndex;
    this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcUrls.length;
    
    if (this.currentRpcIndex === previousIndex) {
      return null; // We've cycled through all RPCs
    }

    const nextRpcUrl = this.rpcUrls[this.currentRpcIndex];
    console.log(`🔄 Chain ${this.config.chainId}: Switching from RPC #${previousIndex + 1} to RPC #${this.currentRpcIndex + 1}`);
    console.log(`   └─ New RPC: ${nextRpcUrl.substring(0, 50)}...`);
    
    return nextRpcUrl;
  }
  
  /**
   * Start automatic RPC rotation for load balancing
   */
  startRpcRotation(): void {
    // Only start if we have multiple RPCs
    if (this.rpcUrls.length <= 1) {
      return;
    }
    
    // Clear existing interval if any
    this.stopRpcRotation();
    
    this.rpcRotationInterval = setInterval(async () => {
      try {
        console.log(`⏰ Chain ${this.config.chainId}: Scheduled RPC rotation (load balancing)`);
        
        // Switch to next RPC
        const nextRpcUrl = this.switchToNextRpc();
        if (!nextRpcUrl) {
          return;
        }
        
        // Recreate provider with new RPC
        await this.recreateProvider();
        
        console.log(`✅ Chain ${this.config.chainId}: Successfully rotated to RPC #${this.currentRpcIndex + 1}`);
      } catch (error) {
        console.error(`❌ Chain ${this.config.chainId}: Error during scheduled RPC rotation:`, error);
      }
    }, this.RPC_ROTATION_INTERVAL_MS);
    
    console.log(`⏰ Chain ${this.config.chainId}: RPC rotation started (every ${this.RPC_ROTATION_INTERVAL_MS / 60000} minutes)`);
  }
  
  /**
   * Stop automatic RPC rotation
   */
  stopRpcRotation(): void {
    if (this.rpcRotationInterval) {
      clearInterval(this.rpcRotationInterval);
      this.rpcRotationInterval = undefined;
    }
  }

  /**
   * Get current RPC URL
   */
  getCurrentRpcUrl(): string {
    return this.rpcUrls[this.currentRpcIndex];
  }

  /**
   * Get all RPC URLs
   */
  getAllRpcUrls(): string[] {
    return [...this.rpcUrls];
  }

  /**
   * Test RPC connection with timeout
   */
  async testConnectionWithTimeout(timeoutMs: number = 10000): Promise<void> {
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
   * Get appropriate delay based on provider type and number of launchpads
   */
  getSetupDelay(): number {
    const isHttpProvider = !(this.provider instanceof ethers.WebSocketProvider);
    const launchpadCount = this.launchpadContracts.size;

    if (isHttpProvider) {
      if (launchpadCount > 15) return 1000;
      if (launchpadCount > 10) return 700;
      return 400;
    }
    return 100;
  }

  /**
   * Setup WebSocket reconnection handlers and keep-alive ping
   */
  setupWebSocketReconnection(): void {
    if (!(this.provider instanceof ethers.WebSocketProvider)) {
      return;
    }

    try {
      const ws = (this.provider as any)._websocket || (this.provider as any).websocket;
      if (ws) {
        ws.on('error', (error: any) => {
          console.error(`❌ WebSocket error on chain ${this.config.chainId}:`, error?.message || error);
        });

        ws.on('close', async (code: number, reason: string) => {
          console.warn(`⚠️ WebSocket closed on chain ${this.config.chainId} - code: ${code}, reason: ${reason || 'unknown'}`);
          this.stopWsPing();

          if (this.callbacks.getIsRunning() && !this.isReconnecting) {
            console.log(`🔄 Chain ${this.config.chainId}: WebSocket disconnected, attempting auto-reconnection...`);
            await this.handleWebSocketDisconnect();
          }
        });

        this.startWsPing(ws);
        console.log(`🔌 WebSocket reconnection handlers setup for chain ${this.config.chainId}`);
      } else {
        console.log(`ℹ️ WebSocket internal handlers not available for chain ${this.config.chainId}`);
      }
    } catch (wsError) {
      console.log(`ℹ️ Could not setup WebSocket handlers for chain ${this.config.chainId}:`, wsError);
    }
  }

  /**
   * Start WebSocket keep-alive ping
   */
  private startWsPing(ws: any): void {
    this.stopWsPing();

    this.wsPingInterval = setInterval(() => {
      try {
        if (ws.readyState === 1) {
          ws.ping();
        }
      } catch (pingError) {
        console.warn(`⚠️ Chain ${this.config.chainId}: WebSocket ping failed, connection may be dead`);
      }
    }, this.WS_PING_INTERVAL_MS);

    console.log(`💓 WebSocket keep-alive ping started for chain ${this.config.chainId} (interval: ${this.WS_PING_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop WebSocket keep-alive ping
   */
  stopWsPing(): void {
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
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.callbacks.stopInternal();
      await this.recreateProvider();

      this.callbacks.setIsRunning(false);
      await this.callbacks.start();

      console.log(`✅ Chain ${this.config.chainId}: Successfully reconnected after WebSocket disconnect`);
      if (this.callbacks.onReconnectSuccess) {
        await this.callbacks.onReconnectSuccess();
      }
    } catch (error) {
      console.error(`❌ Chain ${this.config.chainId}: Reconnection failed:`, error);
      await this.handleConnectionError(error);
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Recreate the provider and contracts after a connection failure
   */
  async recreateProvider(): Promise<void> {
    console.log(`🔄 Chain ${this.config.chainId}: Recreating provider...`);

    // Try to switch to next RPC if available
    const nextRpcUrl = this.switchToNextRpc();
    const rpcUrl = nextRpcUrl || this.rpcUrls[this.currentRpcIndex];

    // Always use HTTP provider to avoid eth_subscribe issues
    const network = ethers.Network.from(this.config.chainId);
    this.provider = new ethers.JsonRpcProvider(
      rpcUrl.replace('wss://', 'https://').replace('ws://', 'http://'),
      network,
      {
        staticNetwork: true // Skip network detection to avoid "failed to detect network" errors
      }
    );

    const launchpadCount = this.config.launchpadAddresses?.length || 0;
    if (launchpadCount > 15) {
      this.provider.pollingInterval = 8000;
    } else if (launchpadCount > 10) {
      this.provider.pollingInterval = 6000;
    } else {
      this.provider.pollingInterval = 5000;
    }
    console.log(`📡 Chain ${this.config.chainId}: HTTP provider recreated${nextRpcUrl ? ' with fallback RPC' : ''}`);

    this.factoryContract = new ethers.Contract(
      this.config.factoryAddress,
      OddsLaunchpadFactoryABI,
      this.provider
    );

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
   * Handle connection errors with exponential backoff
   */
  async handleConnectionError(error: any): Promise<void> {
    this.retryCount++;

    if (this.retryCount >= this.maxRetries) {
      console.error(`❌ Max retries (${this.maxRetries}) reached for chain ${this.config.chainId}. Giving up.`);
      if (this.callbacks.onReconnectFailed) {
        await this.callbacks.onReconnectFailed(new Error('Max retries reached'));
      }
      return;
    }

    const delay = Math.min(this.retryDelay * Math.pow(2, this.retryCount - 1), 30000);
    console.log(`⏳ Retrying RPC connection for chain ${this.config.chainId} in ${delay}ms (attempt ${this.retryCount}/${this.maxRetries})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.recreateProvider();
      this.callbacks.setIsRunning(false);
      await this.callbacks.start();
      console.log(`✅ Successfully reconnected to chain ${this.config.chainId} after ${this.retryCount} attempts`);
    } catch (retryError) {
      console.error(`❌ Retry ${this.retryCount} failed for chain ${this.config.chainId}:`, retryError);
      await this.handleConnectionError(retryError);
    }
  }

  /**
   * Start event liveness check to detect silent disconnects
   */
  startLivenessCheck(resubscribeCallback: () => Promise<void>): void {
    this.stopLivenessCheck();
    this.lastEventReceivedAt = Date.now();
    this.consecutiveStaleChecks = 0;

    this.livenessCheckInterval = setInterval(async () => {
      const now = Date.now();
      const timeSinceLastEvent = now - this.lastEventReceivedAt;
      const minutesSinceLastEvent = Math.round(timeSinceLastEvent / 60000);

      console.log(`🔍 Chain ${this.config.chainId} liveness check: ${minutesSinceLastEvent}m since last event`);

      if (timeSinceLastEvent > this.EVENT_STALE_THRESHOLD_MS) {
        this.consecutiveStaleChecks++;
        console.warn(`⚠️ Chain ${this.config.chainId}: No events received for ${minutesSinceLastEvent} minutes (check ${this.consecutiveStaleChecks}/${this.MAX_STALE_CHECKS_BEFORE_RESUBSCRIBE})`);

        if (this.consecutiveStaleChecks >= this.MAX_STALE_CHECKS_BEFORE_RESUBSCRIBE) {
          console.log(`🔄 Chain ${this.config.chainId}: Event subscription appears stale, re-subscribing...`);
          try {
            await resubscribeCallback();
            this.consecutiveStaleChecks = 0;
            this.lastEventReceivedAt = Date.now();
            console.log(`✅ Chain ${this.config.chainId}: Successfully re-subscribed to events`);
          } catch (error) {
            console.error(`❌ Chain ${this.config.chainId}: Failed to re-subscribe:`, error);
            await this.handleConnectionError(error);
          }
        }
      } else {
        this.consecutiveStaleChecks = 0;
      }
    }, this.LIVENESS_CHECK_INTERVAL_MS);

    console.log(`👁️ Event liveness check started for chain ${this.config.chainId}`);
  }

  /**
   * Stop event liveness check
   */
  stopLivenessCheck(): void {
    if (this.livenessCheckInterval) {
      clearInterval(this.livenessCheckInterval);
      this.livenessCheckInterval = undefined;
    }
  }

  /**
   * Update last event received timestamp
   */
  updateEventLiveness(): void {
    this.lastEventReceivedAt = Date.now();
  }

  /**
   * Get event liveness status for monitoring
   */
  getEventLivenessStatus(): {
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
   * Setup periodic filter recreation for HTTP providers
   */
  setupFilterRecreation(recreateFiltersCallback: () => Promise<void>): void {
    if (this.provider instanceof ethers.WebSocketProvider) {
      return;
    }

    this.filterRecreationInterval = setInterval(async () => {
      const now = Date.now();
      if (this.lastFilterRecreation && (now - this.lastFilterRecreation) < 180000) {
        return;
      }

      try {
        console.log(`🔄 Recreating event filters for chain ${this.config.chainId}...`);
        await recreateFiltersCallback();
        this.lastFilterRecreation = now;
        console.log(`✅ Event filters recreated for chain ${this.config.chainId}`);
      } catch (error) {
        console.error(`❌ Error recreating filters for chain ${this.config.chainId}:`, error);
      }
    }, 240000); // 4 minutes

    console.log(`⏰ Filter recreation scheduled every 4 minutes for chain ${this.config.chainId}`);
  }

  /**
   * Clear filter recreation interval
   */
  clearFilterRecreationInterval(): void {
    if (this.filterRecreationInterval) {
      clearInterval(this.filterRecreationInterval);
      this.filterRecreationInterval = undefined;
    }
  }

  /**
   * Add a new launchpad contract
   */
  addLaunchpadContract(address: string): ethers.Contract | null {
    const normalizedAddress = address.toLowerCase();
    if (this.launchpadContracts.has(normalizedAddress)) {
      return this.launchpadContracts.get(normalizedAddress)!;
    }

    if (!ethers.isAddress(address)) {
      console.warn(`⚠️ Cannot add launchpad: Invalid address ${address}`);
      return null;
    }

    const contract = new ethers.Contract(
      address,
      OddsLaunchpadABI,
      this.provider
    );
    this.launchpadContracts.set(normalizedAddress, contract);
    return contract;
  }

  /**
   * Remove a launchpad contract
   */
  removeLaunchpadContract(address: string): void {
    const normalizedAddress = address.toLowerCase();
    const contract = this.launchpadContracts.get(normalizedAddress);
    if (contract) {
      contract.removeAllListeners();
      this.launchpadContracts.delete(normalizedAddress);
    }
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    this.stopWsPing();
    this.stopLivenessCheck();
    this.clearFilterRecreationInterval();

    this.factoryContract.removeAllListeners();
    this.launchpadContracts.forEach(contract => {
      contract.removeAllListeners();
    });

    if (this.provider instanceof ethers.WebSocketProvider) {
      try {
        await this.provider.destroy();
      } catch (destroyError) {
        // Ignore destroy errors during cleanup
      }
    }
  }

  /**
   * Reset retry count after successful connection
   */
  resetRetryCount(): void {
    this.retryCount = 0;
  }
}
