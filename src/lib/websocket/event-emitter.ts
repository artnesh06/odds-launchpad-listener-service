/**
 * WebSocket Event Emitter
 * Bridges blockchain events to WebSocket broadcasts
 */

import { WebSocketManager } from './websocket-manager';

export interface MintEventData {
  contractAddress: string;
  chainId: number;
  minter: string;
  tokenId: string;
  quantity: number;
  timestamp: Date;
  transactionHash: string;
  phaseId?: string;
  imageUrl?: string;
}

export interface BatchMintEventData {
  contractAddress: string;
  chainId: number;
  minter: string;
  tokenIds: string[]; // Array of token IDs
  totalQuantity: number;
  timestamp: Date;
  transactionHash: string;
  phaseId?: string;
  imageUrl?: string;
}

export interface CollectionEventData {
  contractAddress: string;
  chainId: number;
  name: string;
  totalSupply: number;
  creator: string;
  timestamp: Date;
  imageUrl?: string;
}

export interface CollectionUpdateEventData {
  contractAddress: string;
  chainId: number;
  totalMinted?: number;
  mintedPercent?: number;
  volume?: number;
  holders?: number;
  timestamp: Date;
}

export interface BurnEventData {
  contractAddress: string;
  chainId: number;
  owner: string;
  tokenId: string;
  timestamp: Date;
  transactionHash: string;
}

export interface AirdropEventData {
  contractAddress: string;
  chainId: number;
  operator: string;
  recipients: string[];
  totalQuantity: number;
  timestamp: Date;
  transactionHash: string;
}

export interface RevealEventData {
  contractAddress: string;
  chainId: number;
  revealed: boolean;
  timestamp: Date;
  transactionHash: string;
}

export interface PhaseEventData {
  contractAddress: string;
  phaseId: string;
  minted: number;
  isActive: boolean;
  timestamp: Date;
}

export type BlockchainEvent = 
  | ({ type: 'mint' } & MintEventData)
  | ({ type: 'collection' } & CollectionEventData)
  | ({ type: 'collectionUpdate' } & CollectionUpdateEventData)
  | ({ type: 'phase' } & PhaseEventData)
  | ({ type: 'burn' } & BurnEventData)
  | ({ type: 'airdrop' } & AirdropEventData)
  | ({ type: 'reveal' } & RevealEventData);

export class EventEmitter {
  constructor(private manager: WebSocketManager) {}

  /**
   * Emit mint event to appropriate rooms
   * 
   * Strategy:
   * - Personal notification: Send to minter's wallet room (wallet:{address})
   * - Launchpad updates: Send to launchpad room (launchpad:{contractAddress})
   * - Homepage feed: Send to homepage rooms for activity feed
   */
  emitMintEvent(data: MintEventData): void {
    try {
      // Convert Date to ISO string for JSON serialization
      const serializedData = {
        ...data,
        timestamp: data.timestamp instanceof Date ? data.timestamp.toISOString() : data.timestamp
      };

      // 1. PERSONAL: Send to minter's wallet room (for personal notifications)
      if (data.minter) {
        this.manager.broadcastToRoom(
          `wallet:${data.minter.toLowerCase()}`, 
          'mint', 
          serializedData
        );
        console.log(`[EventEmitter] Mint event sent to wallet room: wallet:${data.minter.toLowerCase()}`);
      }

      // 2. LAUNCHPAD ROOM: Send to launchpad-specific room (for real-time stats)
      this.manager.broadcastToRoom(
        `launchpad:${data.contractAddress.toLowerCase()}`, 
        'mint', 
        serializedData
      );
      console.log(`[EventEmitter] Mint event sent to launchpad room: launchpad:${data.contractAddress.toLowerCase()}`);

      // 3. HOMEPAGE FEED: Send to homepage rooms (for activity feed)
      // All chains homepage
      this.manager.broadcastToRoom('homepage:all', 'mint', serializedData);
      
      // Chain-specific homepage
      this.manager.broadcastToRoom(`homepage:chain:${data.chainId}`, 'mint', serializedData);
      
      console.log(`[EventEmitter] Mint event sent to homepage rooms`);
    } catch (error) {
      console.error('[EventEmitter] Failed to emit mint event:', error);
    }
  }

  /**
   * Emit batch mint event to appropriate rooms
   * 
   * Strategy:
   * - For batch mints (multiple NFTs in 1 transaction), send 1 event with array of tokenIds
   * - Personal notification: Send to minter's wallet room (wallet:{address})
   * - Launchpad updates: Send to launchpad room (launchpad:{contractAddress})
   * - Homepage feed: Send to homepage rooms for activity feed
   */
  emitBatchMintEvent(data: BatchMintEventData): void {
    try {
      // Convert Date to ISO string for JSON serialization
      const serializedData = {
        ...data,
        timestamp: data.timestamp instanceof Date ? data.timestamp.toISOString() : data.timestamp
      };

      // 1. PERSONAL: Send to minter's wallet room (for personal notifications)
      if (data.minter) {
        this.manager.broadcastToRoom(
          `wallet:${data.minter.toLowerCase()}`, 
          'batch-mint', 
          serializedData
        );
        console.log(`[EventEmitter] Batch mint event sent to wallet room: wallet:${data.minter.toLowerCase()} (${data.totalQuantity} NFTs)`);
      }

      // 2. LAUNCHPAD ROOM: Send to launchpad-specific room (for real-time stats)
      this.manager.broadcastToRoom(
        `launchpad:${data.contractAddress.toLowerCase()}`, 
        'batch-mint', 
        serializedData
      );
      console.log(`[EventEmitter] Batch mint event sent to launchpad room: launchpad:${data.contractAddress.toLowerCase()}`);

      // 3. HOMEPAGE FEED: Send to homepage rooms (for activity feed)
      // All chains homepage
      this.manager.broadcastToRoom('homepage:all', 'batch-mint', serializedData);
      
      // Chain-specific homepage
      this.manager.broadcastToRoom(`homepage:chain:${data.chainId}`, 'batch-mint', serializedData);
      
      console.log(`[EventEmitter] Batch mint event sent to homepage rooms`);
    } catch (error) {
      console.error('[EventEmitter] Failed to emit batch mint event:', error);
    }
  }

  /**
   * Emit collection event to appropriate rooms
   * 
   * Strategy:
   * - New collections are broadcast to homepage rooms only
   * - This is for discovery and trending sections
   */
  emitCollectionEvent(data: CollectionEventData): void {
    try {
      // Convert Date to ISO string for JSON serialization
      const serializedData = {
        ...data,
        timestamp: data.timestamp instanceof Date ? data.timestamp.toISOString() : data.timestamp
      };

      // Broadcast to all homepage viewers (for discovery)
      this.manager.broadcastToRoom('homepage:all', 'collection:new', serializedData);
      console.log(`[EventEmitter] New collection event sent to homepage:all`);

      // Broadcast to chain-specific homepage
      this.manager.broadcastToRoom(`homepage:chain:${data.chainId}`, 'collection:new', serializedData);
      console.log(`[EventEmitter] New collection event sent to homepage:chain:${data.chainId}`);
    } catch (error) {
      console.error('[EventEmitter] Failed to emit collection event:', error);
    }
  }

  /**
   * Emit collection update event to appropriate rooms
   * 
   * Strategy:
   * - Collection stats updates go to launchpad room (for real-time stats)
   * - Also sent to homepage for trending/volume updates
   */
  emitCollectionUpdateEvent(data: CollectionUpdateEventData): void {
    try {
      // Convert Date to ISO string for JSON serialization
      const serializedData = {
        ...data,
        timestamp: data.timestamp instanceof Date ? data.timestamp.toISOString() : data.timestamp
      };

      // 1. LAUNCHPAD ROOM: Send to launchpad-specific room (for real-time stats)
      this.manager.broadcastToRoom(
        `launchpad:${data.contractAddress.toLowerCase()}`, 
        'collection:update', 
        serializedData
      );
      console.log(`[EventEmitter] Collection update sent to launchpad:${data.contractAddress.toLowerCase()}`);

      // 2. HOMEPAGE: Send to homepage rooms (for trending updates)
      this.manager.broadcastToRoom('homepage:all', 'collection:update', serializedData);
      this.manager.broadcastToRoom(`homepage:chain:${data.chainId}`, 'collection:update', serializedData);
      console.log(`[EventEmitter] Collection update sent to homepage rooms`);
    } catch (error) {
      console.error('[EventEmitter] Failed to emit collection update event:', error);
    }
  }

  /**
   * Emit phase event to launchpad room
   * 
   * Strategy:
   * - Phase updates only go to launchpad-specific room
   * - This is for users viewing that specific launchpad page
   */
  emitPhaseEvent(data: PhaseEventData): void {
    try {
      // Broadcast to launchpad-specific room only
      this.manager.broadcastToRoom(
        `launchpad:${data.contractAddress.toLowerCase()}`, 
        'phase:update', 
        data
      );
      console.log(`[EventEmitter] Phase update sent to launchpad:${data.contractAddress.toLowerCase()}`);
    } catch (error) {
      console.error('[EventEmitter] Failed to emit phase event:', error);
    }
  }

  /**
   * Emit burn event to appropriate rooms
   * 
   * Strategy:
   * - Personal notification: Send to owner's wallet room
   * - Launchpad updates: Send to launchpad room (for stats update)
   * - Homepage feed: Send to homepage rooms for activity
   */
  emitBurnEvent(data: BurnEventData): void {
    try {
      // 1. PERSONAL: Send to owner's wallet room (for personal notification)
      if (data.owner) {
        this.manager.broadcastToRoom(
          `wallet:${data.owner.toLowerCase()}`, 
          'burn', 
          data
        );
        console.log(`[EventEmitter] Burn event sent to wallet room: wallet:${data.owner.toLowerCase()}`);
      }

      // 2. LAUNCHPAD ROOM: Send to launchpad-specific room (for stats update)
      this.manager.broadcastToRoom(
        `launchpad:${data.contractAddress.toLowerCase()}`, 
        'burn', 
        data
      );
      console.log(`[EventEmitter] Burn event sent to launchpad room: launchpad:${data.contractAddress.toLowerCase()}`);

      // 3. HOMEPAGE FEED: Send to homepage rooms (for activity feed)
      this.manager.broadcastToRoom('homepage:all', 'burn', data);
      this.manager.broadcastToRoom(`homepage:chain:${data.chainId}`, 'burn', data);
      console.log(`[EventEmitter] Burn event sent to homepage rooms`);
    } catch (error) {
      console.error('[EventEmitter] Failed to emit burn event:', error);
    }
  }

  /**
   * Emit airdrop event to appropriate rooms
   * 
   * Strategy:
   * - Personal notifications: Send to each recipient's wallet room
   * - Launchpad updates: Send to launchpad room (for stats)
   * - Homepage feed: Send to homepage rooms for activity
   */
  emitAirdropEvent(data: AirdropEventData): void {
    try {
      // 1. PERSONAL: Send to each recipient's wallet room
      if (data.recipients && data.recipients.length > 0) {
        data.recipients.forEach(recipient => {
          this.manager.broadcastToRoom(
            `wallet:${recipient.toLowerCase()}`, 
            'airdrop', 
            data
          );
        });
        console.log(`[EventEmitter] Airdrop event sent to ${data.recipients.length} wallet rooms`);
      }

      // 2. LAUNCHPAD ROOM: Send to launchpad-specific room
      this.manager.broadcastToRoom(
        `launchpad:${data.contractAddress.toLowerCase()}`, 
        'airdrop', 
        data
      );
      console.log(`[EventEmitter] Airdrop event sent to launchpad room: launchpad:${data.contractAddress.toLowerCase()}`);

      // 3. HOMEPAGE FEED: Send to homepage rooms
      this.manager.broadcastToRoom('homepage:all', 'airdrop', data);
      this.manager.broadcastToRoom(`homepage:chain:${data.chainId}`, 'airdrop', data);
      console.log(`[EventEmitter] Airdrop event sent to homepage rooms`);
    } catch (error) {
      console.error('[EventEmitter] Failed to emit airdrop event:', error);
    }
  }

  /**
   * Emit reveal event to launchpad room
   * 
   * Strategy:
   * - Reveal events only go to launchpad-specific room
   * - This is for users viewing that specific launchpad page
   */
  emitRevealEvent(data: RevealEventData): void {
    try {
      // Broadcast to launchpad-specific room only
      this.manager.broadcastToRoom(
        `launchpad:${data.contractAddress.toLowerCase()}`, 
        'reveal', 
        data
      );
      console.log(`[EventEmitter] Reveal event sent to launchpad:${data.contractAddress.toLowerCase()}`);
    } catch (error) {
      console.error('[EventEmitter] Failed to emit reveal event:', error);
    }
  }

  /**
   * Emit batch of events with deduplication
   */
  emitBatchEvents(events: BlockchainEvent[]): void {
    try {
      // Deduplicate events
      const uniqueEvents = this.deduplicateEvents(events);

      // Emit each unique event
      for (const event of uniqueEvents) {
        switch (event.type) {
          case 'mint':
            this.emitMintEvent(event);
            break;
          case 'collection':
            this.emitCollectionEvent(event);
            break;
          case 'collectionUpdate':
            this.emitCollectionUpdateEvent(event);
            break;
          case 'phase':
            this.emitPhaseEvent(event);
            break;
          case 'burn':
            this.emitBurnEvent(event);
            break;
          case 'airdrop':
            this.emitAirdropEvent(event);
            break;
          case 'reveal':
            this.emitRevealEvent(event);
            break;
        }
      }
    } catch (error) {
      console.error('[EventEmitter] Failed to emit batch events:', error);
    }
  }

  /**
   * Deduplicate events based on transaction hash and token ID
   */
  private deduplicateEvents(events: BlockchainEvent[]): BlockchainEvent[] {
    const seen = new Set<string>();
    const uniqueEvents: BlockchainEvent[] = [];

    for (const event of events) {
      let key: string;

      if (event.type === 'mint') {
        key = `${event.transactionHash}-${event.tokenId}`;
      } else if (event.type === 'collection') {
        key = `collection-${event.contractAddress}-${event.chainId}`;
      } else if (event.type === 'collectionUpdate') {
        key = `collectionUpdate-${event.contractAddress}-${event.timestamp.getTime()}`;
      } else if (event.type === 'phase') {
        key = `phase-${event.contractAddress}-${event.phaseId}`;
      } else if (event.type === 'burn') {
        key = `${event.transactionHash}-${event.tokenId}`;
      } else if (event.type === 'airdrop') {
        key = `${event.transactionHash}`;
      } else if (event.type === 'reveal') {
        key = `reveal-${event.contractAddress}-${event.transactionHash}`;
      } else {
        continue;
      }

      if (!seen.has(key)) {
        seen.add(key);
        uniqueEvents.push(event);
      }
    }

    return uniqueEvents;
  }
}
