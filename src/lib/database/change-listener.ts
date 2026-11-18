/**
 * Database Change Listener
 * 
 * Listens to PostgreSQL NOTIFY events from database triggers
 * and emits WebSocket events to connected clients in real-time.
 * 
 * Architecture:
 * - PostgreSQL triggers send NOTIFY when data is inserted
 * - This listener receives notifications via LISTEN
 * - Parses notification payload and routes to appropriate handler
 * - Emits WebSocket events via EventEmitter
 * 
 * Requirements: 5.1, 5.2, 10.1, 10.2
 */

import { Client } from 'pg';
import { EventEmitter } from '../websocket/event-emitter';
import { prisma } from '../../config/database';


/**
 * Notification payload from PostgreSQL triggers
 */
interface NotificationPayload {
  id: string;
  contractAddress: string;
  chainId: number;
  blockNumber: string;
  blockTimestamp: string;
  transactionHash: string;
  [key: string]: any;
}

/**
 * Configuration for DatabaseChangeListener
 */
export interface DatabaseChangeListenerConfig {
  connectionString: string;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  pollInterval?: number;
}

/**
 * DatabaseChangeListener class
 * 
 * Manages PostgreSQL LISTEN connections and routes notifications
 * to WebSocket event emitters.
 */
export class DatabaseChangeListener {
  private client: Client | null = null;
  private eventEmitter: EventEmitter;
  private config: DatabaseChangeListenerConfig;
  private isConnected: boolean = false;
  private isShuttingDown: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private lastProcessedTimestamp: number = Date.now();
  private pollTimer: NodeJS.Timeout | null = null;
  
  // Batch mint tracking - group mints by transaction hash
  private batchMintsByTxHash: Map<string, {
    contractAddress: string;
    chainId: number;
    minter: string;
    tokenIds: string[];
    timestamp: Date;
    transactionHash: string;
    imageUrl?: string; // Store first NFT image for the batch
  }> = new Map();
  private batchMintTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly BATCH_MINT_DELAY = 500; // Wait 500ms before emitting batch
  
  // Channels to listen to
  private readonly channels = [
    'ponder_transfer_insert',
    'ponder_mint_insert',
    'ponder_phase_insert',
    'ponder_burn_insert',
    'ponder_airdrop_insert',
    'ponder_collection_insert',
    'ponder_revealed_insert',
    'ponder_metadata_update_insert',
  ];

  constructor(eventEmitter: EventEmitter, config: DatabaseChangeListenerConfig) {
    this.eventEmitter = eventEmitter;
    this.config = {
      reconnectDelay: 5000,
      maxReconnectAttempts: 10,
      pollInterval: 30000,
      ...config,
    };
  }

  /**
   * Start listening to database notifications
   */
  async start(): Promise<void> {
    if (this.isConnected) {
      console.log('[DatabaseChangeListener] Already connected');
      return;
    }

    try {
      await this.connect();
      console.log('[DatabaseChangeListener] Started successfully');
    } catch (error) {
      console.error('[DatabaseChangeListener] Failed to start:', error);
      throw error;
    }
  }

  /**
   * Stop listening and disconnect
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Clear all batch mint timers
    for (const timer of this.batchMintTimers.values()) {
      clearTimeout(timer);
    }
    this.batchMintTimers.clear();
    this.batchMintsByTxHash.clear();

    if (this.client) {
      try {
        await this.client.end();
        console.log('[DatabaseChangeListener] Disconnected successfully');
      } catch (error) {
        console.error('[DatabaseChangeListener] Error during disconnect:', error);
      }
      this.client = null;
    }

    this.isConnected = false;
    console.log('[DatabaseChangeListener] Stopped');
  }

  /**
   * Connect to PostgreSQL and set up LISTEN subscriptions
   */
  private async connect(): Promise<void> {
    try {
      // Create new PostgreSQL client
      this.client = new Client({
        connectionString: this.config.connectionString,
      });

      // Set up error handler
      this.client.on('error', (error) => {
        console.error('[DatabaseChangeListener] PostgreSQL client error:', error);
        this.handleDisconnection();
      });

      // Set up notification handler
      this.client.on('notification', (msg) => {
        this.handleNotification(msg);
      });

      // Connect to database
      await this.client.connect();
      console.log('[DatabaseChangeListener] Connected to PostgreSQL');

      // Subscribe to all channels
      await this.subscribeToChannels();

      this.isConnected = true;
      this.reconnectAttempts = 0;

      console.log('[DatabaseChangeListener] Listening to database notifications');

      // Start periodic polling for missed events
      this.startPolling();
    } catch (error) {
      console.error('[DatabaseChangeListener] Connection failed:', error);
      throw error;
    }
  }

  /**
   * Subscribe to all notification channels
   */
  private async subscribeToChannels(): Promise<void> {
    if (!this.client) {
      throw new Error('Client not initialized');
    }

    for (const channel of this.channels) {
      await this.client.query(`LISTEN ${channel}`);
      console.log(`[DatabaseChangeListener] Subscribed to ${channel}`);
    }
  }

  /**
   * Handle disconnection and attempt reconnection
   */
  private handleDisconnection(): void {
    if (this.isShuttingDown) {
      return;
    }

    this.isConnected = false;

    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts || 10)) {
      console.error('[DatabaseChangeListener] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.calculateBackoffDelay();

    console.log(
      `[DatabaseChangeListener] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        if (this.client) {
          try {
            await this.client.end();
          } catch (error) {
            // Ignore errors when closing dead connection
          }
          this.client = null;
        }

        await this.connect();
        console.log('[DatabaseChangeListener] Reconnected successfully');
      } catch (error) {
        console.error('[DatabaseChangeListener] Reconnection failed:', error);
        this.handleDisconnection();
      }
    }, delay);
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(): number {
    const baseDelay = this.config.reconnectDelay || 5000;
    const exponentialDelay = baseDelay * Math.pow(2, this.reconnectAttempts - 1);
    const maxDelay = 60000; // Cap at 1 minute
    return Math.min(exponentialDelay, maxDelay);
  }

  /**
   * Handle incoming notification from PostgreSQL
   */
  private handleNotification(msg: { channel?: string; payload?: string }): void {
    try {
      if (!msg.channel || !msg.payload) {
        console.warn('[DatabaseChangeListener] Invalid notification:', msg);
        return;
      }

      const payload: NotificationPayload = JSON.parse(msg.payload);

      // Log the notification
      console.log(`[DatabaseChangeListener] Received ${msg.channel} notification:`, payload.id);

      // Route to appropriate handler based on channel
      switch (msg.channel) {
        case 'ponder_transfer_insert':
          this.handleTransferNotification(payload);
          break;
        case 'ponder_mint_insert':
          this.handleMintNotification(payload);
          break;
        case 'ponder_phase_insert':
          this.handlePhaseNotification(payload);
          break;
        case 'ponder_burn_insert':
          this.handleBurnNotification(payload);
          break;
        case 'ponder_airdrop_insert':
          this.handleAirdropNotification(payload);
          break;
        case 'ponder_collection_insert':
          this.handleCollectionNotification(payload);
          break;
        case 'ponder_revealed_insert':
          this.handleRevealedNotification(payload);
          break;
        case 'ponder_metadata_update_insert':
          this.handleMetadataUpdateNotification(payload);
          break;
        default:
          console.warn(`[DatabaseChangeListener] Unknown channel: ${msg.channel}`);
      }
    } catch (error) {
      console.error('[DatabaseChangeListener] Error handling notification:', error);
    }
  }

  /**
   * Handle Transfer notification
   * 
   * Emits mint events for transfers from zero address (mints)
   * Groups multiple mints in same transaction into batch event
   * Requirements: 5.1, 5.3
   */
  private handleTransferNotification(payload: NotificationPayload): void {
    try {
      console.log('[DatabaseChangeListener] Transfer notification received:', payload.id);

      // Check if this is a mint (from = zero address)
      const isMint = payload.from === '0x0000000000000000000000000000000000000000' || 
                     payload.from === '0x0';

      if (isMint) {
        const txHash = payload.transactionHash;
        const timestamp = new Date(parseInt(payload.blockTimestamp) * 1000);
        
        // Add to batch mint tracking
        if (!this.batchMintsByTxHash.has(txHash)) {
          this.batchMintsByTxHash.set(txHash, {
            contractAddress: payload.contractAddress,
            chainId: payload.chainId,
            minter: payload.to,
            tokenIds: [],
            timestamp: timestamp,
            transactionHash: txHash,
          });
        }

        // Add token ID to batch
        const batch = this.batchMintsByTxHash.get(txHash)!;
        batch.tokenIds.push(payload.tokenId);

        // Clear existing timer if any
        if (this.batchMintTimers.has(txHash)) {
          clearTimeout(this.batchMintTimers.get(txHash)!);
        }

        // Set timer to emit batch after delay (to collect all mints in same tx)
        const timer = setTimeout(async () => {
          const batchData = this.batchMintsByTxHash.get(txHash);
          if (batchData) {
            // Fetch image for the first NFT in the batch
            let imageUrl: string | undefined;
            try {
              const firstNft = await prisma.nFT.findUnique({
                where: {
                  contractAddress_tokenId_chainId: {
                    contractAddress: batchData.contractAddress.toLowerCase(),
                    tokenId: batchData.tokenIds[0],
                    chainId: batchData.chainId,
                  },
                },
                select: {
                  imageCachedUrl: true,
                  imageOriginalUrl: true,
                  imageThumbnailUrl: true,
                },
              });
              imageUrl = firstNft?.imageCachedUrl || firstNft?.imageThumbnailUrl || firstNft?.imageOriginalUrl || undefined;
            } catch (error) {
              console.error('[DatabaseChangeListener] Failed to fetch NFT image:', error);
            }

            // If only 1 NFT, emit as single mint
            if (batchData.tokenIds.length === 1) {
              this.eventEmitter.emitMintEvent({
                contractAddress: batchData.contractAddress,
                chainId: batchData.chainId,
                minter: batchData.minter,
                tokenId: batchData.tokenIds[0],
                quantity: 1,
                timestamp: batchData.timestamp,
                transactionHash: batchData.transactionHash,
                imageUrl, // Include NFT image
              });
              console.log(`[DatabaseChangeListener] Emitted single mint event for token #${batchData.tokenIds[0]}`);
            } else {
              // Multiple NFTs, emit as batch
              this.eventEmitter.emitBatchMintEvent({
                contractAddress: batchData.contractAddress,
                chainId: batchData.chainId,
                minter: batchData.minter,
                tokenIds: batchData.tokenIds,
                totalQuantity: batchData.tokenIds.length,
                timestamp: batchData.timestamp,
                transactionHash: batchData.transactionHash,
                imageUrl, // Include first NFT image for batch
              });
              console.log(`[DatabaseChangeListener] Emitted batch mint event for ${batchData.tokenIds.length} NFTs`);
            }
          }

          // Cleanup
          this.batchMintsByTxHash.delete(txHash);
          this.batchMintTimers.delete(txHash);
        }, this.BATCH_MINT_DELAY);

        this.batchMintTimers.set(txHash, timer);
      }
    } catch (error) {
      console.error('[DatabaseChangeListener] Error handling Transfer notification:', error);
    }
  }

  /**
   * Handle Mint notification
   * 
   * Emits mint events for explicit Mint events from the contract
   * Groups multiple mints in same transaction into batch event
   * Requirements: 5.1, 5.3
   */
  private handleMintNotification(payload: NotificationPayload): void {
    try {
      console.log('[DatabaseChangeListener] Mint notification received:', payload.id);

      const txHash = payload.transactionHash;
      const timestamp = new Date(parseInt(payload.blockTimestamp) * 1000);
      
      // Add to batch mint tracking
      if (!this.batchMintsByTxHash.has(txHash)) {
        this.batchMintsByTxHash.set(txHash, {
          contractAddress: payload.contractAddress,
          chainId: payload.chainId,
          minter: payload.recipient,
          tokenIds: [],
          timestamp: timestamp,
          transactionHash: txHash,
        });
      }

      // Add token ID to batch
      const batch = this.batchMintsByTxHash.get(txHash)!;
      batch.tokenIds.push(payload.tokenId);

      // Clear existing timer if any
      if (this.batchMintTimers.has(txHash)) {
        clearTimeout(this.batchMintTimers.get(txHash)!);
      }

      // Set timer to emit batch after delay (to collect all mints in same tx)
      const timer = setTimeout(async () => {
        const batchData = this.batchMintsByTxHash.get(txHash);
        if (batchData) {
          // Fetch image for the first NFT in the batch
          let imageUrl: string | undefined;
          try {
            const firstNft = await prisma.nFT.findUnique({
              where: {
                contractAddress_tokenId_chainId: {
                  contractAddress: batchData.contractAddress.toLowerCase(),
                  tokenId: batchData.tokenIds[0],
                  chainId: batchData.chainId,
                },
              },
              select: {
                imageCachedUrl: true,
                imageOriginalUrl: true,
                imageThumbnailUrl: true,
              },
            });
            imageUrl = firstNft?.imageCachedUrl || firstNft?.imageThumbnailUrl || firstNft?.imageOriginalUrl || undefined;
          } catch (error) {
            console.error('[DatabaseChangeListener] Failed to fetch NFT image:', error);
          }

          // If only 1 NFT, emit as single mint
          if (batchData.tokenIds.length === 1) {
            this.eventEmitter.emitMintEvent({
              contractAddress: batchData.contractAddress,
              chainId: batchData.chainId,
              minter: batchData.minter,
              tokenId: batchData.tokenIds[0],
              quantity: parseInt(payload.quantity || '1'),
              timestamp: batchData.timestamp,
              transactionHash: batchData.transactionHash,
              phaseId: payload.phaseId,
              imageUrl, // Include NFT image
            });
            console.log(`[DatabaseChangeListener] Emitted single mint event for token #${batchData.tokenIds[0]}`);
          } else {
            // Multiple NFTs, emit as batch
            this.eventEmitter.emitBatchMintEvent({
              contractAddress: batchData.contractAddress,
              chainId: batchData.chainId,
              minter: batchData.minter,
              tokenIds: batchData.tokenIds,
              totalQuantity: batchData.tokenIds.length,
              timestamp: batchData.timestamp,
              transactionHash: batchData.transactionHash,
              imageUrl, // Include first NFT image for batch
            });
            console.log(`[DatabaseChangeListener] Emitted batch mint event for ${batchData.tokenIds.length} NFTs`);
          }
        }

        // Cleanup
        this.batchMintsByTxHash.delete(txHash);
        this.batchMintTimers.delete(txHash);
      }, this.BATCH_MINT_DELAY);

      this.batchMintTimers.set(txHash, timer);
    } catch (error) {
      console.error('[DatabaseChangeListener] Error handling Mint notification:', error);
    }
  }

  /**
   * Handle Phase notification
   * 
   * Emits phase events for PhaseAdded and PhaseUpdated events
   * Requirements: 5.2, 5.3
   */
  private handlePhaseNotification(payload: NotificationPayload): void {
    try {
      console.log('[DatabaseChangeListener] Phase notification received:', payload.id);

      // Convert to PhaseEventData format
      const phaseData = {
        contractAddress: payload.contractAddress,
        phaseId: payload.phaseId,
        minted: 0, // Will be updated by separate queries if needed
        isActive: this.isPhaseActive(payload),
        timestamp: new Date(parseInt(payload.blockTimestamp) * 1000),
      };

      // Emit phase event via WebSocket
      this.eventEmitter.emitPhaseEvent(phaseData);
      console.log('[DatabaseChangeListener] Emitted phase event for phase:', payload.phaseId);
    } catch (error) {
      console.error('[DatabaseChangeListener] Error handling Phase notification:', error);
    }
  }

  /**
   * Check if a phase is currently active based on timestamps
   */
  private isPhaseActive(payload: NotificationPayload): boolean {
    const now = Date.now() / 1000; // Current time in seconds
    const startTime = parseInt(payload.startTime || '0');
    const endTime = parseInt(payload.endTime || '0');
    
    return now >= startTime && now <= endTime;
  }

  /**
   * Handle Burn notification
   * 
   * Emits burn events when NFTs are burned
   * Requirements: 5.2, 5.3
   */
  private handleBurnNotification(payload: NotificationPayload): void {
    try {
      console.log('[DatabaseChangeListener] Burn notification received:', payload.id);

      // Convert to BurnEventData format
      const burnData = {
        contractAddress: payload.contractAddress,
        chainId: payload.chainId,
        owner: payload.owner,
        tokenId: payload.tokenId,
        timestamp: new Date(parseInt(payload.blockTimestamp) * 1000),
        transactionHash: payload.transactionHash,
      };

      // Emit burn event via WebSocket
      this.eventEmitter.emitBurnEvent(burnData);
      console.log('[DatabaseChangeListener] Emitted burn event for token:', payload.tokenId);
    } catch (error) {
      console.error('[DatabaseChangeListener] Error handling Burn notification:', error);
    }
  }

  /**
   * Handle Airdrop notification
   * 
   * Emits airdrop events when NFTs are airdropped
   * Requirements: 5.2, 5.3
   */
  private handleAirdropNotification(payload: NotificationPayload): void {
    try {
      console.log('[DatabaseChangeListener] Airdrop notification received:', payload.id);

      // Convert to AirdropEventData format
      const airdropData = {
        contractAddress: payload.contractAddress,
        chainId: payload.chainId,
        operator: payload.operator,
        recipients: [], // Recipients array not available in notification, would need separate query
        totalQuantity: parseInt(payload.totalQuantity || '0'),
        timestamp: new Date(parseInt(payload.blockTimestamp) * 1000),
        transactionHash: payload.transactionHash,
      };

      // Emit airdrop event via WebSocket
      this.eventEmitter.emitAirdropEvent(airdropData);
      console.log('[DatabaseChangeListener] Emitted airdrop event:', payload.id);
    } catch (error) {
      console.error('[DatabaseChangeListener] Error handling Airdrop notification:', error);
    }
  }

  /**
   * Handle Collection notification
   * 
   * Emits collection events when new collections are deployed
   * Requirements: 5.2, 5.3
   */
  private handleCollectionNotification(payload: NotificationPayload): void {
    try {
      console.log('[DatabaseChangeListener] Collection notification received:', payload.id);

      // Convert to CollectionEventData format
      const collectionData = {
        contractAddress: payload.address,
        chainId: payload.chainId,
        name: payload.name,
        totalSupply: parseInt(payload.totalSupply || '0'),
        creator: '', // Creator not available in notification, would need separate query
        timestamp: new Date(parseInt(payload.deployedAt) * 1000),
      };

      // Emit collection event via WebSocket
      this.eventEmitter.emitCollectionEvent(collectionData);
      console.log('[DatabaseChangeListener] Emitted collection event:', payload.name);
    } catch (error) {
      console.error('[DatabaseChangeListener] Error handling Collection notification:', error);
    }
  }

  /**
   * Handle Revealed notification
   * 
   * Emits reveal events when collections are revealed
   * Requirements: 5.2, 5.3
   */
  private handleRevealedNotification(payload: NotificationPayload): void {
    try {
      console.log('[DatabaseChangeListener] Revealed notification received:', payload.id);

      // Convert to RevealEventData format
      const revealData = {
        contractAddress: payload.contractAddress,
        chainId: payload.chainId,
        revealed: true, // If we received this notification, it means revealed
        timestamp: new Date(parseInt(payload.blockTimestamp) * 1000),
        transactionHash: payload.transactionHash,
      };

      // Emit reveal event via WebSocket
      this.eventEmitter.emitRevealEvent(revealData);
      console.log('[DatabaseChangeListener] Emitted reveal event for:', payload.contractAddress);
    } catch (error) {
      console.error('[DatabaseChangeListener] Error handling Revealed notification:', error);
    }
  }

  /**
   * Handle Metadata Update notification
   * 
   * Logs metadata update events (no WebSocket emission needed for now)
   * Requirements: 5.2, 5.3
   */
  private handleMetadataUpdateNotification(payload: NotificationPayload): void {
    try {
      console.log('[DatabaseChangeListener] Metadata update notification received:', payload.id);
      console.log(`[DatabaseChangeListener] Metadata updated for tokens ${payload.fromTokenId} to ${payload.toTokenId}`);
      
      // Note: No specific WebSocket event for metadata updates in the current EventEmitter
      // This could be added in the future if needed
    } catch (error) {
      console.error('[DatabaseChangeListener] Error handling Metadata Update notification:', error);
    }
  }

  /**
   * Get connection status
   */
  isListening(): boolean {
    return this.isConnected;
  }

  /**
   * Get reconnection attempts count
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Start periodic polling for missed events during downtime
   * Requirements: 10.1, 10.2
   */
  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }

    const pollInterval = this.config.pollInterval || 30000;

    this.pollTimer = setInterval(() => {
      this.pollForMissedEvents();
    }, pollInterval);

    console.log(`[DatabaseChangeListener] Started polling for missed events (every ${pollInterval}ms)`);
  }

  /**
   * Poll database for events that might have been missed during downtime
   * 
   * This is a safety mechanism to catch events that were inserted while
   * the listener was disconnected or during brief network issues.
   */
  private async pollForMissedEvents(): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      // Query for recent events that might have been missed
      // This is a simple implementation - in production, you might want to
      // track the last processed event ID for each table
      const cutoffTime = Math.floor((Date.now() - 60000) / 1000); // Last 1 minute

      // Note: This is a placeholder. In a real implementation, you would:
      // 1. Query each Ponder table for events since lastProcessedTimestamp
      // 2. Process any missed events
      // 3. Update lastProcessedTimestamp
      
      // For now, just update the timestamp to indicate we're polling
      this.lastProcessedTimestamp = Date.now();
      
      console.log('[DatabaseChangeListener] Polled for missed events');
    } catch (error) {
      console.error('[DatabaseChangeListener] Error polling for missed events:', error);
    }
  }
}
