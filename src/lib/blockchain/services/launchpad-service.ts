/**
 * LaunchpadService - Manages launchpad operations and featured status (Multi-Chain)
 * 
 * This service handles launchpad-related operations, particularly managing
 * the featured status of launchpads and coordinating with the WebSocketManager
 * to establish or remove real-time monitoring connections.
 * 
 * Features:
 * - Update featured status of launchpads
 * - Manage WebSocket connections based on featured status
 * - Query featured launchpads
 * - Multi-chain support: Coordinates with MultiChainListenerManager
 * 
 * Requirements: 4.2, 4.3, 1.3
 */

import { PrismaClient } from '@prisma/client';

/**
 * LaunchpadService class for managing launchpad operations
 * Multi-chain: Works with MultiChainListenerManager to manage WebSocket connections per chain
 */
export class LaunchpadService {
  private prisma: PrismaClient;
  // WebSocketManager is now managed by MultiChainListenerManager
  // This service will call MultiChainListenerManager methods instead

  /**
   * Create a new LaunchpadService
   * 
   * @param prisma - Prisma client for database operations
   */
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    console.log('[LaunchpadService] Initialized (Multi-Chain)');
  }

  /**
   * Update featured status and manage WebSocket connection
   * 
   * Updates the isFeatured status of a launchpad in the database and
   * manages the corresponding WebSocket connection via MultiChainListenerManager:
   * - If changing to featured=true: adds WebSocket listener
   * - If changing to featured=false: removes WebSocket listener
   * 
   * @param launchpadId - ID of the launchpad to update
   * @param isFeatured - New featured status (true or false)
   * @returns Promise that resolves when update is complete
   * @throws Error if launchpad is not found
   * 
   * Requirements: 4.2, 4.3
   */
  async updateFeaturedStatus(
    launchpadId: string,
    isFeatured: boolean
  ): Promise<void> {
    console.log(`[LaunchpadService] Updating featured status for launchpad ${launchpadId} to ${isFeatured}`);

    // 1. Get current launchpad from database
    const launchpad = await this.prisma.launchpad.findUnique({
      where: { id: launchpadId },
      select: {
        id: true,
        contractAddress: true,
        name: true,
        isFeatured: true,
        chainId: true // Get chain ID for multi-chain support
      }
    });

    // Validate launchpad exists
    if (!launchpad) {
      const errorMsg = `Launchpad ${launchpadId} not found`;
      console.error(`[LaunchpadService] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    console.log(`[LaunchpadService] Found launchpad: ${launchpad.name} (${launchpad.contractAddress}) on chain ${launchpad.chainId}`);
    console.log(`[LaunchpadService] Current featured status: ${launchpad.isFeatured}`);

    // Check if status is actually changing
    if (launchpad.isFeatured === isFeatured) {
      console.log(`[LaunchpadService] Featured status is already ${isFeatured}, no changes needed`);
      return;
    }

    // 2. Update isFeatured in database
    await this.prisma.launchpad.update({
      where: { id: launchpadId },
      data: { isFeatured }
    });

    console.log(`[LaunchpadService] ✓ Updated database: isFeatured = ${isFeatured}`);

    // 3. Manage WebSocket connection via MultiChainListenerManager
    try {
      // Import MultiChainListenerManager dynamically to avoid circular dependency
      const { getMultiChainListenerManager } = await import('./multi-chain-listener-manager');
      const manager = getMultiChainListenerManager();
      
      // Get the WebSocketManager for this chain
      const listener = manager.getListener(launchpad.chainId);
      
      if (!listener) {
        console.warn(`[LaunchpadService] No listener found for chain ${launchpad.chainId}, WebSocket management skipped`);
        return;
      }
      
      // Get WebSocketManager from the listener (if available)
      const webSocketManager = (listener as any).webSocketManager;
      
      if (!webSocketManager) {
        console.warn(`[LaunchpadService] WebSocket not enabled for chain ${launchpad.chainId}, skipping WebSocket management`);
        return;
      }

      if (isFeatured && !launchpad.isFeatured) {
        // Becoming featured: add WebSocket listener
        console.log(`[LaunchpadService] Launchpad becoming featured, adding WebSocket listener...`);
        await webSocketManager.addListener(launchpad.contractAddress);
        console.log(`[LaunchpadService] ✅ WebSocket listener added for ${launchpad.name} on chain ${launchpad.chainId}`);
      } else if (!isFeatured && launchpad.isFeatured) {
        // No longer featured: remove WebSocket listener
        console.log(`[LaunchpadService] Launchpad no longer featured, removing WebSocket listener...`);
        await webSocketManager.removeListener(launchpad.contractAddress);
        console.log(`[LaunchpadService] ✅ WebSocket listener removed for ${launchpad.name} on chain ${launchpad.chainId}`);
      }
    } catch (error) {
      // Log error but don't throw - database update succeeded
      console.error(`[LaunchpadService] Error managing WebSocket connection:`, error);
      console.warn(`[LaunchpadService] Database updated successfully, but WebSocket management failed`);
      console.warn(`[LaunchpadService] Manual intervention may be required for ${launchpad.contractAddress} on chain ${launchpad.chainId}`);
      
      // Re-throw the error so caller knows there was an issue
      throw new Error(`Failed to manage WebSocket connection for launchpad ${launchpadId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    console.log(`[LaunchpadService] ✅ Successfully updated featured status for ${launchpad.name} on chain ${launchpad.chainId}`);
  }

  /**
   * Get all featured launchpads (optionally filtered by chain)
   * 
   * Queries the database for all launchpads where isFeatured=true.
   * 
   * @param chainId - Optional chain ID to filter by specific chain
   * @returns Promise that resolves to array of featured launchpads
   * 
   * Requirements: 1.3
   */
  async getFeaturedLaunchpads(chainId?: number) {
    console.log(`[LaunchpadService] Querying featured launchpads${chainId ? ` for chain ${chainId}` : ' (all chains)'}...`);

    const featuredLaunchpads = await this.prisma.launchpad.findMany({
      where: { 
        isFeatured: true,
        ...(chainId && { chainId }) // Filter by chain if provided
      },
      select: {
        id: true,
        contractAddress: true,
        name: true,
        symbol: true,
        description: true,
        chainId: true,
        creator: true,
        totalMaxSupply: true,
        mintedCount: true,
        status: true,
        isFeatured: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`[LaunchpadService] Found ${featuredLaunchpads.length} featured launchpad(s)${chainId ? ` on chain ${chainId}` : ''}`);

    return featuredLaunchpads;
  }
}
