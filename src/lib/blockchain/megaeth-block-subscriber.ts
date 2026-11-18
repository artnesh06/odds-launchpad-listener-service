/**
 * MegaETH Block Subscriber
 * 
 * Alternative strategy for MegaETH since eth_subscribe('logs') is not supported:
 * 1. Subscribe to newHeads (new blocks)
 * 2. Fetch block transactions
 * 3. Parse transaction receipts for event logs
 * 4. Filter for our contract addresses
 * 
 * Note: This is more complex than polling and may not be more efficient.
 * Consider using polling-only strategy instead.
 */

import { ethers } from 'ethers';
import WebSocket from 'ws';

export interface MegaETHBlockSubscriberConfig {
  wsUrl: string;
  chainId: number;
  addresses: string[]; // Contract addresses to monitor
  topics: string[]; // Event topics to filter
  provider: ethers.JsonRpcProvider; // For fetching block data
  onLog: (log: any) => void;
  onError?: (error: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * MegaETH Block Subscriber
 * Subscribes to newHeads and processes block transactions
 */
export class MegaETHBlockSubscriber {
  private ws?: WebSocket;
  private config: MegaETHBlockSubscriberConfig;
  private subscriptionId?: string;
  private keepAliveInterval?: NodeJS.Timeout;
  private reconnectTimeout?: NodeJS.Timeout;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private messageId: number = 1;
  private lastProcessedBlock: number = 0;
  
  private readonly KEEP_ALIVE_INTERVAL_MS = 30000;
  private readonly RECONNECT_DELAY_MS = 5000;

  constructor(config: MegaETHBlockSubscriberConfig) {
    this.config = config;
  }

  /**
   * Connect and subscribe to new blocks
   */
  async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      console.log(`⚠️ Already connected or connecting to MegaETH WebSocket`);
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    try {
      console.log(`🔌 Connecting to MegaETH for block subscription: ${this.config.wsUrl}`);
      
      this.ws = new WebSocket(this.config.wsUrl);

      this.ws.on('open', () => {
        console.log(`✅ Connected to MegaETH WebSocket`);
        this.isConnecting = false;
        
        this.subscribeToBlocks();
        this.startKeepAlive();
        
        if (this.config.onConnect) {
          this.config.onConnect();
        }
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error(`❌ Error parsing WebSocket message:`, error);
        }
      });

      this.ws.on('error', (error) => {
        console.error(`❌ MegaETH WebSocket error:`, error.message);
        this.isConnecting = false;
        
        if (this.config.onError) {
          this.config.onError(error);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.warn(`⚠️ MegaETH WebSocket closed - code: ${code}, reason: ${reason.toString()}`);
        this.isConnecting = false;
        this.cleanup();
        
        if (this.config.onDisconnect) {
          this.config.onDisconnect();
        }
        
        if (this.shouldReconnect) {
          console.log(`🔄 Reconnecting in ${this.RECONNECT_DELAY_MS / 1000}s...`);
          this.reconnectTimeout = setTimeout(() => {
            this.connect();
          }, this.RECONNECT_DELAY_MS);
        }
      });

    } catch (error) {
      console.error(`❌ Failed to connect to MegaETH WebSocket:`, error);
      this.isConnecting = false;
      throw error;
    }
  }

  /**
   * Subscribe to new blocks
   */
  private subscribeToBlocks(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error(`❌ Cannot subscribe: WebSocket not open`);
      return;
    }

    const newHeadsRequest = {
      jsonrpc: '2.0',
      method: 'eth_subscribe',
      params: ['newHeads'],
      id: this.messageId++
    };
    
    console.log(`📡 Subscribing to newHeads (new blocks)...`);
    this.ws.send(JSON.stringify(newHeadsRequest));
  }

  /**
   * Handle incoming WebSocket messages
   */
  private async handleMessage(message: any): Promise<void> {
    // Subscription confirmation
    if (message.id && message.result && typeof message.result === 'string') {
      this.subscriptionId = message.result;
      console.log(`✅ Subscribed to MegaETH newHeads - Subscription ID: ${this.subscriptionId}`);
      return;
    }

    // New block notification
    if (message.method === 'eth_subscription' && message.params) {
      const { subscription, result } = message.params;
      
      if (subscription === this.subscriptionId && result.number) {
        const blockNumber = parseInt(result.number, 16);
        
        // Prevent duplicate processing
        if (blockNumber <= this.lastProcessedBlock) {
          return;
        }
        
        console.log(`📦 [MegaETH] New block: ${blockNumber} (${result.hash})`);
        
        // Process block transactions
        await this.processBlock(blockNumber, result.hash);
        
        this.lastProcessedBlock = blockNumber;
      }
      return;
    }

    // Keep-alive response
    if (message.id && message.result) {
      return;
    }

    // Error response
    if (message.error) {
      if (message.error.code === -32601) {
        console.warn(`⚠️ MegaETH doesn't support this subscription method`);
        console.log(`   └─ Falling back to polling`);
        return;
      }
      
      console.error(`❌ MegaETH subscription error:`, message.error);
      if (this.config.onError) {
        this.config.onError(message.error);
      }
    }
  }

  /**
   * Process a block to extract relevant transactions
   */
  private async processBlock(blockNumber: number, blockHash: string): Promise<void> {
    try {
      // Fetch full block with transactions
      const block = await this.config.provider.getBlock(blockNumber, true);
      
      if (!block || !block.transactions) {
        console.warn(`⚠️ Block ${blockNumber} has no transactions`);
        return;
      }

      console.log(`🔍 [MegaETH] Block ${blockNumber}: ${block.transactions.length} transactions`);

      // Filter transactions to our contract addresses
      const relevantTxs = block.transactions.filter((tx: any) => {
        if (!tx.to) return false;
        return this.config.addresses.includes(tx.to.toLowerCase());
      });

      if (relevantTxs.length === 0) {
        console.log(`   └─ No relevant transactions found`);
        return;
      }

      console.log(`   └─ Found ${relevantTxs.length} relevant transactions`);

      // Fetch receipts for relevant transactions
      for (const tx of relevantTxs) {
        try {
          const receipt = await this.config.provider.getTransactionReceipt(tx.hash);
          
          if (!receipt || !receipt.logs) continue;

          // Filter logs by our topics
          const relevantLogs = receipt.logs.filter((log: any) => {
            if (!this.config.addresses.includes(log.address.toLowerCase())) {
              return false;
            }
            
            // Check if any of our topics match
            if (this.config.topics.length === 0) return true;
            
            return log.topics.some((topic: string) => 
              this.config.topics.includes(topic)
            );
          });

          // Emit each relevant log
          for (const log of relevantLogs) {
            console.log(`📨 [MegaETH] Event found in tx ${tx.hash.slice(0, 10)}...`);
            console.log(`   └─ Address: ${log.address}`);
            console.log(`   └─ Topics: ${log.topics.length}`);
            
            this.config.onLog(log);
          }
        } catch (error) {
          console.error(`❌ Error fetching receipt for ${tx.hash}:`, error);
        }
      }
    } catch (error) {
      console.error(`❌ Error processing block ${blockNumber}:`, error);
    }
  }

  /**
   * Start keep-alive ping
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();

    this.keepAliveInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const keepAliveRequest = {
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: this.messageId++
        };
        
        this.ws.send(JSON.stringify(keepAliveRequest));
        console.log(`💓 Keep-alive ping sent`);
      }
    }, this.KEEP_ALIVE_INTERVAL_MS);

    console.log(`💓 Keep-alive started (every ${this.KEEP_ALIVE_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop keep-alive ping
   */
  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = undefined;
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.stopKeepAlive();
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    
    this.subscriptionId = undefined;
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    console.log(`🛑 Disconnecting from MegaETH Block Subscriber...`);
    
    this.shouldReconnect = false;
    this.cleanup();

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.subscriptionId) {
      const unsubscribeRequest = {
        jsonrpc: '2.0',
        method: 'eth_unsubscribe',
        params: [this.subscriptionId],
        id: this.messageId++
      };
      
      this.ws.send(JSON.stringify(unsubscribeRequest));
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }

    console.log(`✅ Disconnected from MegaETH Block Subscriber`);
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && !!this.subscriptionId;
  }
}
