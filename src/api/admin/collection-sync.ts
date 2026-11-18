/**
 * Collection Sync Admin Endpoint
 * 
 * Endpoint untuk sync semua transaksi (mint, transfer, burn) dari 1 collection
 * dengan parameter contract address dan chain ID.
 * 
 * POST /api/admin/sync-collection/{chainId}/{contractAddress}
 */

import { IncomingMessage, ServerResponse } from 'http';
import { prisma } from '../../config/database';
import { sendJSON, sendError, parseJsonBody } from './index';
import { logActivity } from './activity-logger';
import { WebSocketManager } from '../../lib/websocket/websocket-manager';
import { createCollectionSyncService } from '../../lib/blockchain/collection-sync-service';
import { getChainConfig } from '../../config/chains';

/**
 * Handle POST /api/admin/sync-collection/{chainId}/{contractAddress}
 * Sync all transactions for a collection
 */
export async function handleCollectionSync(
  req: IncomingMessage,
  res: ServerResponse,
  chainId: number,
  contractAddress: string
): Promise<boolean> {
  const normalizedAddress = contractAddress.toLowerCase();

  const activityId = await logActivity({
    operationType: 'collection_sync',
    status: 'in_progress',
    chainId,
    contractAddress: normalizedAddress,
  });

  try {
    // Parse request body
    const body = await parseJsonBody(req);
    const {
      fromBlock,
      toBlock,
      skipExisting = true,
      batchSize = 1000,
    } = body;

    // Validate chain
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig) {
      await logActivity({
        id: activityId,
        status: 'failed',
        errorMessage: `Chain ${chainId} not supported`,
      });
      sendError(res, `Chain ${chainId} not supported`, 400);
      return true;
    }

    // Find the launchpad
    const launchpad = await prisma.launchpad.findFirst({
      where: {
        chainId,
        contractAddress: normalizedAddress,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!launchpad) {
      await logActivity({
        id: activityId,
        status: 'failed',
        errorMessage: 'Launchpad not found',
      });
      sendError(res, 'Launchpad not found', 404);
      return true;
    }

    // Get deployment block from activity
    const activity = await prisma.activity.findFirst({
      where: {
        chainId,
        type: 'LAUNCHPAD_CREATED',
        launchpadId: launchpad.id,
        blockNumber: { not: null },
      },
      select: {
        blockNumber: true,
      },
      orderBy: {
        blockNumber: 'asc',
      },
    });

    const deploymentBlock = activity?.blockNumber || null;

    // Validate fromBlock
    if (fromBlock !== undefined && (typeof fromBlock !== 'number' || fromBlock < 0)) {
      await logActivity({
        id: activityId,
        status: 'failed',
        errorMessage: 'Invalid fromBlock parameter',
      });
      sendError(res, 'fromBlock must be a positive number', 400);
      return true;
    }

    // Validate toBlock
    if (toBlock !== undefined && (typeof toBlock !== 'number' || toBlock < 0)) {
      await logActivity({
        id: activityId,
        status: 'failed',
        errorMessage: 'Invalid toBlock parameter',
      });
      sendError(res, 'toBlock must be a positive number', 400);
      return true;
    }

    // Validate batchSize
    if (typeof batchSize !== 'number' || batchSize < 100 || batchSize > 10000) {
      await logActivity({
        id: activityId,
        status: 'failed',
        errorMessage: 'Invalid batchSize parameter',
      });
      sendError(res, 'batchSize must be between 100 and 10000', 400);
      return true;
    }

    // Get WebSocket manager for progress updates
    const wsManager = (global as any).websocketManager as WebSocketManager | null;

    // Start sync in background and return immediately
    const syncPromise = (async () => {
      try {
        console.log(`🔄 Starting collection sync for ${normalizedAddress} on chain ${chainId}`);
        console.log(`   Launchpad: ${launchpad.name}`);
        console.log(`   From block: ${fromBlock || deploymentBlock || 'will be determined from first mint'}`);
        console.log(`   To block: ${toBlock || 'latest'}`);
        console.log(`   Skip existing: ${skipExisting}`);
        console.log(`   Batch size: ${batchSize}`);

        // Create sync service
        const syncService = createCollectionSyncService(
          chainId,
          chainConfig.rpcUrl,
          wsManager
        );

        // Run sync
        const result = await syncService.syncCollectionTransactions({
          contractAddress: normalizedAddress,
          chainId,
          fromBlock,
          toBlock,
          skipExisting,
          batchSize,
          rpcUrl: chainConfig.rpcUrl,
        });

        // Update activity log
        if (result.success) {
          await logActivity({
            id: activityId,
            status: 'success',
            itemsProcessed: result.totalEvents,
            metadata: {
              fromBlock: result.fromBlock,
              toBlock: result.toBlock,
              totalEvents: result.totalEvents,
              mints: result.mints,
              transfers: result.transfers,
              burns: result.burns,
              errors: result.errors,
              duration: result.duration,
            },
          });

          console.log(`✅ Collection sync completed successfully`);
          console.log(`   Total events: ${result.totalEvents}`);
          console.log(`   Mints: ${result.mints}`);
          console.log(`   Transfers: ${result.transfers}`);
          console.log(`   Burns: ${result.burns}`);
          console.log(`   Errors: ${result.errors}`);
          console.log(`   Duration: ${result.duration}ms`);
        } else {
          await logActivity({
            id: activityId,
            status: 'failed',
            errorMessage: result.errorDetails?.join('; ') || 'Unknown error',
            metadata: {
              fromBlock: result.fromBlock,
              toBlock: result.toBlock,
              errors: result.errors,
              duration: result.duration,
            },
          });

          console.error(`❌ Collection sync failed`);
          console.error(`   Errors: ${result.errors}`);
          if (result.errorDetails) {
            result.errorDetails.forEach((error) => {
              console.error(`   - ${error}`);
            });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        await logActivity({
          id: activityId,
          status: 'failed',
          errorMessage,
        });

        console.error(`❌ Fatal error during collection sync:`, error);
      }
    })();

    // Don't await - let it run in background
    syncPromise.catch((error) => {
      console.error('Background collection sync error:', error);
    });

    // Return immediately with operation ID for tracking
    sendJSON(res, {
      success: true,
      message: 'Collection sync started',
      operationId: activityId,
      chainId,
      contractAddress: normalizedAddress,
      launchpad: {
        id: launchpad.id,
        name: launchpad.name,
      },
      syncOptions: {
        fromBlock: fromBlock || deploymentBlock || 'will be determined',
        toBlock: toBlock || 'latest',
        skipExisting,
        batchSize,
      },
      trackingInfo: {
        websocketEvent: 'collection-sync:progress',
        activityLogId: activityId,
      },
    });
    return true;
  } catch (error) {
    await logActivity({
      id: activityId,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    console.error('Error starting collection sync:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to start sync', 500);
    return true;
  }
}
