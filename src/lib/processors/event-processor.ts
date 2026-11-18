/**
 * EventProcessor - Handles event deduplication and processing
 * 
 * This class processes events from both WebSocket and polling sources,
 * ensuring each event is processed exactly once using transaction hash
 * and log index as unique identifiers.
 * 
 * Features:
 * - In-memory cache for fast deduplication checks
 * - Database persistence for long-term deduplication
 * - FIFO cache eviction when size limit is reached
 * - Integration with existing mint event handlers
 * - Metrics collection for event sources
 * 
 * Requirements: 6.1, 6.2, 6.3, 6.4, 8.5
 */

import { prisma, withDbLimit, withRetry } from '../../config/database';
import { blockchainWebSocketMetrics } from '../monitoring/blockchain-websocket-metrics';

/**
 * Mint event data structure from WebSocket or polling sources
 */
export interface MintEventData {
  from: string;
  tokenId: string;
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
  launchpadAddress: string;
  source: 'websocket' | 'polling';
}

/**
 * Handler function type for processing mint events
 * Accepts MintEventData and returns a Promise
 */
export type MintEventHandler = (event: MintEventData) => Promise<void>;

/**
 * EventProcessor handles event deduplication and routing
 */
export class EventProcessor {
  private processedEvents: Set<string>; // In-memory cache
  private readonly CACHE_SIZE = 10000;
  private mintEventHandler?: MintEventHandler;

  constructor(mintEventHandler?: MintEventHandler) {
    this.processedEvents = new Set<string>();
    this.mintEventHandler = mintEventHandler;
  }

  /**
   * Set the mint event handler
   * Allows setting the handler after construction
   * 
   * @param handler - Function to handle mint events
   */
  setMintEventHandler(handler: MintEventHandler): void {
    this.mintEventHandler = handler;
  }

  /**
   * Process a mint event from any source with deduplication
   * 
   * @param event - Mint event data from WebSocket or polling
   * @returns Promise that resolves when event is processed
   * 
   * Requirements: 6.1, 6.3, 6.4
   */
  async processMintEvent(event: MintEventData): Promise<void> {
    // 1. Create unique event identifier
    const eventId = `${event.transactionHash}-${event.logIndex}`;

    // 2. Check if already processed
    if (await this.isEventProcessed(event.transactionHash, event.logIndex)) {
      console.log(`[EventProcessor] Skipping duplicate event: ${eventId} from ${event.source}`);
      return;
    }

    // 3. Mark as processed (both cache and database)
    await this.markEventProcessed(event.transactionHash, event.logIndex);

    // 4. Log event processing
    console.log(`[EventProcessor] Processing mint event: ${eventId} from ${event.source}`);

    // 5. Increment metrics based on event source
    // Requirement 8.5: Expose metrics for mint events received via WebSocket vs polling
    if (event.source === 'websocket') {
      blockchainWebSocketMetrics.incrementMintEventsWebSocket();
    } else if (event.source === 'polling') {
      blockchainWebSocketMetrics.incrementMintEventsPolling();
    }

    // 6. Route to existing mint event handler
    if (this.mintEventHandler) {
      try {
        await this.mintEventHandler(event);
        console.log(`[EventProcessor] Successfully processed event ${eventId} through handler`);
      } catch (error) {
        console.error(`[EventProcessor] Error processing event ${eventId} through handler:`, error);
        // Re-throw to allow caller to handle the error
        throw error;
      }
    } else {
      console.warn(`[EventProcessor] No mint event handler configured for event ${eventId}`);
    }
  }

  /**
   * Check if an event has already been processed
   * 
   * Checks in-memory cache first for performance, then falls back to database.
   * If found in database but not in cache, adds to cache for future lookups.
   * 
   * @param txHash - Transaction hash
   * @param logIndex - Log index within the transaction
   * @returns Promise<boolean> - true if event was already processed
   * 
   * Requirements: 6.2, 6.3
   */
  async isEventProcessed(txHash: string, logIndex: number): Promise<boolean> {
    const eventId = `${txHash}-${logIndex}`;

    // Check in-memory cache first (fast path)
    if (this.processedEvents.has(eventId)) {
      return true;
    }

    // Check database (slower path) - use direct call without retry for reads
    try {
      const existing = await withDbLimit(async () => {
        return await prisma.processedEvent.findUnique({
          where: {
            transactionHash_logIndex: {
              transactionHash: txHash,
              logIndex: logIndex
            }
          }
        });
      });

      if (existing) {
        // Add to cache for future lookups
        this.processedEvents.add(eventId);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`[EventProcessor] Error checking if event processed:`, error);
      // On error, assume not processed to avoid losing events
      return false;
    }
  }

  /**
   * Mark an event as processed
   * 
   * Updates both in-memory cache and database. Implements FIFO eviction
   * when cache size exceeds limit.
   * 
   * @param txHash - Transaction hash
   * @param logIndex - Log index within the transaction
   * @returns Promise that resolves when event is marked as processed
   * 
   * Requirements: 6.2, 6.3
   */
  async markEventProcessed(txHash: string, logIndex: number): Promise<void> {
    const eventId = `${txHash}-${logIndex}`;

    // Add to in-memory cache
    this.processedEvents.add(eventId);

    // Maintain cache size with FIFO eviction
    if (this.processedEvents.size > this.CACHE_SIZE) {
      // Get first item (oldest) and remove it
      const firstItem = this.processedEvents.values().next().value;
      if (firstItem) {
        this.processedEvents.delete(firstItem);
      }
    }

    // Store in database - use direct call without retry for unique constraint violations
    try {
      await withDbLimit(async () => {
        await prisma.processedEvent.create({
          data: {
            transactionHash: txHash,
            logIndex: logIndex,
            processedAt: new Date()
          }
        });
      });
    } catch (error: any) {
      // If it's a unique constraint violation (P2002), the event was already marked
      // This is expected in race conditions and not an error
      if (error?.code === 'P2002') {
        console.log(`[EventProcessor] Event ${eventId} already marked as processed (race condition)`);
        return;
      }

      // For other errors, log but don't throw - we don't want to block event processing
      console.error(`[EventProcessor] Error marking event as processed:`, error);
    }
  }

  /**
   * Get cache statistics for monitoring
   * 
   * @returns Object with cache size and limit
   */
  getCacheStats(): { size: number; limit: number; utilizationPercent: number } {
    return {
      size: this.processedEvents.size,
      limit: this.CACHE_SIZE,
      utilizationPercent: (this.processedEvents.size / this.CACHE_SIZE) * 100
    };
  }

  /**
   * Clear the in-memory cache
   * Useful for testing or manual cache management
   */
  clearCache(): void {
    this.processedEvents.clear();
    console.log('[EventProcessor] Cache cleared');
  }
}

// Export singleton instance
export const eventProcessor = new EventProcessor();
