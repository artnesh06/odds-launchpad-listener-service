/**
 * MegaETH Realtime API Subscriber
 * 
 * Uses eth_subscribe over WebSocket to get real-time event streaming
 * from MegaETH's mini-blocks (10ms latency)
 * 
 * Reference: https://docs.megaeth.systems/devs/realtime-api
 */

import { ethers } from 'ethers';
import WebSocket from 'ws';

export interface MegaETHSubscriptionConfig {
  wsUrl: string;
  httpUrl?: string; // Optional HTTP URL for fetching data
  provider: ethers.JsonRpcProvider | ethers.WebSocketProvider; // Provider for fetching blocks/receipts
  chainId: number;
  addresses: string[]; // Contract addresses to monitor
  topics: string[]; // Event topics to filter
  onLog: (log: any) => void;
  onError?: (error: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * MegaETH Realtime Subscriber
 * Subscribes to newHeads -> Fetches Block -> Filters Txs -> Gets Receipts -> Emits Logs
 */
export class MegaETHRealtimeSubscriber {
  private ws?: WebSocket;
  private config: MegaETHSubscriptionConfig;
  private subscriptionId?: string;
  private keepAliveInterval?: NodeJS.Timeout;
  private reconnectTimeout?: NodeJS.Timeout;
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private messageId: number = 1;
  
  // Keep-alive: send eth_chainId every 30 seconds
  private readonly KEEP_ALIVE_INTERVAL_MS = 30000;
  private readonly RECONNECT_DELAY_MS = 5000;

  constructor(config: MegaETHSubscriptionConfig) {
    this.config = config;
  }

  /**
   * Connect and subscribe to newHeads
   */
  async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      console.log(`⚠️ Already connected or connecting to MegaETH WebSocket`);
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    try {
      console.log(`🔌 Connecting to MegaETH Realtime API: ${this.config.wsUrl}`);
      
      this.ws = new WebSocket(this.config.wsUrl);

      this.ws.on('open', () => {
        console.log(`✅ Connected to MegaETH Realtime API`);
        this.isConnecting = false;
        
        // Subscribe to new blocks
        this.subscribeToNewHeads();
        
        // Start keep-alive ping
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
        if (this.config.onError) this.config.onError(error);
      });

      this.ws.on('close', (code, reason) => {
        console.warn(`⚠️ MegaETH WebSocket closed - code: ${code}, reason: ${reason.toString()}`);
        this.isConnecting = false;
        this.cleanup();
        
        if (this.config.onDisconnect) this.config.onDisconnect();
        
        // Auto-reconnect
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
   * Subscribe to newHeads
   */
  private subscribeToNewHeads(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const request = {
      jsonrpc: '2.0',
      id: this.messageId++,
      method: 'eth_subscribe',
      params: ['newHeads']
    };
    
    console.log(`📡 Subscribing to newHeads...`);
    this.ws.send(JSON.stringify(request));
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: any): void {
    // Subscription confirmation
    if (message.id && message.result && typeof message.result === 'string') {
      this.subscriptionId = message.result;
      console.log(`✅ Subscribed to MegaETH newHeads - Subscription ID: ${this.subscriptionId}`);
      return;
    }

    // New block notification
    if (message.method === 'eth_subscription' && message.params) {
      const { result } = message.params;
      if (result && result.number) {
        // Process the new block
        this.processNewBlock(result.number); // Hex string
      }
    }
  }

  /**
   * Process a new block: Fetch Block -> Filter Txs -> Get Receipts -> Emit Logs
   */
  private async processNewBlock(blockNumberHex: string): Promise<void> {
    try {
      const blockNumber = parseInt(blockNumberHex, 16);
      // console.log(`📦 New Block: ${blockNumber}`);

      // 1. Fetch full block with transactions
      // We use the provider passed in config (HTTP or WS)
      const block = await this.config.provider.getBlock(blockNumber, true);
      
      if (!block || !block.prefetchedTransactions) {
        return;
      }

      // 2. Filter transactions relevant to our contracts
      const relevantTxs = block.prefetchedTransactions.filter((tx) => {
        if (!tx.to) return false;
        // Check if tx.to is one of our monitored addresses
        // Using Map or Set would be faster for O(1) lookups, but array is fine for < 1000 addresses
        return this.config.addresses.includes(tx.to.toLowerCase());
      });

      if (relevantTxs.length === 0) return;

      console.log(`⚡ Found ${relevantTxs.length} relevant txs in block ${blockNumber}`);

      // 3. Process each relevant transaction
      for (const tx of relevantTxs) {
        try {
          // Get transaction receipt to find logs/events
          const receipt = await this.config.provider.getTransactionReceipt(tx.hash);
          
          if (!receipt || !receipt.logs) continue;

          // 4. Emit logs that match our criteria
          for (const log of receipt.logs) {
             // Only emit if log address matches (double check)
             if (this.config.addresses.includes(log.address.toLowerCase())) {
                // Pass the raw log-like structure that ActivityListener expects
                // ActivityListener expects: { address, topics, data, transactionHash, blockNumber, logIndex }
                this.config.onLog({
                  address: log.address,
                  topics: [...log.topics],
                  data: log.data,
                  transactionHash: log.transactionHash,
                  // Convert number to hex string for compatibility with ActivityListener's raw parsing
                  blockNumber: '0x' + log.blockNumber.toString(16),
                  logIndex: '0x' + log.index.toString(16)
                });
             }
          }
        } catch (txError) {
          console.error(`❌ Error processing tx ${tx.hash}:`, txError);
        }
      }

    } catch (error) {
      console.error(`❌ Error processing block ${blockNumberHex}:`, error);
    }
  }

  /**
   * Start keep-alive ping (eth_chainId)
   */
  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: this.messageId++
        }));
      }
    }, this.KEEP_ALIVE_INTERVAL_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = undefined;
    }
  }

  private cleanup(): void {
    this.stopKeepAlive();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    this.subscriptionId = undefined;
  }

  async disconnect(): Promise<void> {
    console.log(`🛑 Disconnecting from MegaETH...`);
    this.shouldReconnect = false;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    console.log(`✅ Disconnected`);
  }
}

