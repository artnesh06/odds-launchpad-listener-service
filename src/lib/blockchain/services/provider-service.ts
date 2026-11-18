/**
 * Provider service for managing RPC connections
 * Handles WebSocket and HTTP providers with rate limiting
 */

import { ethers } from 'ethers';

// WebSocket polyfill for Node.js environment
if (typeof WebSocket === 'undefined') {
  try {
    const WS = require('ws');
    (global as any).WebSocket = WS;
  } catch (error) {
    // Silent fail - will use HTTP providers as fallback
  }
}

export class ProviderService {
  private provider: ethers.JsonRpcProvider | ethers.WebSocketProvider;
  private chainId: number;
  private lastRateLimitLog: number = 0;

  constructor(rpcUrl: string, chainId: number, launchpadCount: number = 0) {
    this.chainId = chainId;

    if (rpcUrl.startsWith('ws://') || rpcUrl.startsWith('wss://')) {
      this.provider = new ethers.WebSocketProvider(rpcUrl);
      console.log(`🔌 Using WebSocket provider for chain ${chainId}`);
    } else {
      const network = ethers.Network.from(chainId);
      this.provider = new ethers.JsonRpcProvider(rpcUrl, network, {
        staticNetwork: true // Skip network detection to avoid "failed to detect network" errors
      });
      
      // Set polling interval based on launchpad count
      if (launchpadCount > 15) {
        this.provider.pollingInterval = 20000;
      } else if (launchpadCount > 10) {
        this.provider.pollingInterval = 15000;
      } else {
        this.provider.pollingInterval = 10000;
      }
      
      console.log(`📡 Using HTTP provider for chain ${chainId} (polling: ${this.provider.pollingInterval / 1000}s, ${launchpadCount} launchpads)`);
      
      this.setupErrorHandler();
    }
  }

  private setupErrorHandler(): void {
    // Note: ethers v6 doesn't support 'error' event on providers
    // Errors are handled through try-catch in individual method calls
    // This method is kept for future compatibility if needed
  }

  getProvider(): ethers.JsonRpcProvider | ethers.WebSocketProvider {
    return this.provider;
  }

  isWebSocket(): boolean {
    return this.provider instanceof ethers.WebSocketProvider;
  }

  /**
   * Get appropriate delay based on provider type and launchpad count
   */
  getSetupDelay(launchpadCount: number): number {
    if (this.isWebSocket()) {
      return 100;
    }
    
    if (launchpadCount > 15) {
      return 1000;
    } else if (launchpadCount > 10) {
      return 700;
    } else {
      return 400;
    }
  }

  /**
   * Test connection with timeout
   */
  async testConnection(timeoutMs: number = 10000): Promise<void> {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('RPC connection timeout')), timeoutMs)
    );

    const connectionPromise = this.provider.getBlockNumber();

    try {
      await Promise.race([connectionPromise, timeoutPromise]);
    } catch (error) {
      throw new Error(`RPC connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async destroy(): Promise<void> {
    if (this.provider instanceof ethers.WebSocketProvider) {
      await this.provider.destroy();
      console.log(`🔌 WebSocket connection closed for chain ${this.chainId}`);
    }
  }
}
