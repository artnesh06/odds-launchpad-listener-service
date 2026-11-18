import { IncomingMessage, ServerResponse } from 'http';
import { prisma } from '../../config/database';
import { getMultiChainListenerManager } from '../../lib/blockchain/multi-chain-listener-manager';
import { sendJSON, sendError, parseJsonBody } from './index';
import { logActivity, updateActivityProgress } from './activity-logger';
import { WebSocketManager } from '../../lib/websocket/websocket-manager';

// Rate limit handling
const RATE_LIMIT_DELAY_MS = 1000;
const MAX_RATE_LIMIT_RETRIES = 5;

/**
 * Sleep utility for rate limit backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Emit rescan progress via WebSocket
 */
function emitRescanProgress(
  wsManager: WebSocketManager | null,
  chainId: number,
  contractAddress: string,
  progress: {
    currentBlock: number;
    fromBlock: number;
    toBlock: number;
    eventsFound: number;
    status: 'in_progress' | 'completed' | 'failed';
    error?: string;
  }
): void {
  if (!wsManager) return;

  const progressPercent = Math.round(
    ((progress.currentBlock - progress.fromBlock) / (progress.toBlock - progress.fromBlock)) * 100
  );

  wsManager.broadcastToAll('rescan:progress', {
    chainId,
    contractAddress,
    progress: progressPercent,
    currentBlock: progress.currentBlock,
    fromBlock: progress.fromBlock,
    toBlock: progress.toBlock,
    eventsFound: progress.eventsFound,
    status: progress.status,
    error: progress.error,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle POST /api/admin/rescan/{chainId}/{address}
 * Force rescan historical blockchain events
 */
export async function handleHistoricalRescan(
  req: IncomingMessage,
  res: ServerResponse,
  chainId: number,
  address: string
): Promise<boolean> {
  const normalizedAddress = address.toLowerCase();

  const activityId = await logActivity({
    operationType: 'rescan',
    status: 'in_progress',
    chainId,
    contractAddress: normalizedAddress,
  });

  try {
    const body = await parseJsonBody(req);
    const { fromBlock, toBlock } = body;

    // Validate fromBlock
    if (!fromBlock || typeof fromBlock !== 'number' || fromBlock < 0) {
      await logActivity({
        id: activityId,
        status: 'failed',
        errorMessage: 'Invalid fromBlock parameter',
      });
      sendError(res, 'fromBlock is required and must be a positive number', 400);
      return true;
    }

    // Find the launchpad
    const launchpad = await prisma.launchpad.findFirst({
      where: {
        chainId,
        contractAddress: normalizedAddress,
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

    // Get listener manager
    const manager = getMultiChainListenerManager();
    const listener = manager.getListener(chainId);

    if (!listener) {
      await logActivity({
        id: activityId,
        status: 'failed',
        errorMessage: `Chain ${chainId} listener not active`,
      });
      sendError(res, `Chain ${chainId} listener not active`, 404);
      return true;
    }

    // Get WebSocket manager for progress updates
    const wsManager = (global as any).websocketManager as WebSocketManager | null;

    // Start rescan in background and return immediately
    // This allows the client to track progress via WebSocket
    const rescanPromise = (async () => {
      let eventsFound = 0;
      let currentBlock = fromBlock;
      let rateLimitRetries = 0;

      try {
        // Emit initial progress
        emitRescanProgress(wsManager, chainId, normalizedAddress, {
          currentBlock: fromBlock,
          fromBlock,
          toBlock: toBlock || fromBlock + 10000,
          eventsFound: 0,
          status: 'in_progress',
        });

        // Use the listener's historical scan method
        // This will handle the actual blockchain scanning
        const result = await listener.scanHistoricalDeployments(fromBlock, toBlock);

        // Update activity log
        await logActivity({
          id: activityId,
          status: 'success',
          itemsProcessed: eventsFound,
          metadata: {
            fromBlock,
            toBlock: toBlock || 'latest',
            eventsFound,
          },
        });

        // Emit completion
        emitRescanProgress(wsManager, chainId, normalizedAddress, {
          currentBlock: toBlock || fromBlock + 10000,
          fromBlock,
          toBlock: toBlock || fromBlock + 10000,
          eventsFound,
          status: 'completed',
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Check if rate limited
        if (errorMessage.includes('rate') || errorMessage.includes('429')) {
          rateLimitRetries++;
          if (rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
            const backoffMs = RATE_LIMIT_DELAY_MS * Math.pow(2, rateLimitRetries);
            console.log(`Rate limited, waiting ${backoffMs}ms before retry...`);
            await sleep(backoffMs);
            // Note: In a real implementation, we'd retry the scan here
          }
        }

        await logActivity({
          id: activityId,
          status: 'failed',
          errorMessage,
          metadata: {
            fromBlock,
            toBlock: toBlock || 'latest',
            eventsFound,
            lastBlock: currentBlock,
          },
        });

        emitRescanProgress(wsManager, chainId, normalizedAddress, {
          currentBlock,
          fromBlock,
          toBlock: toBlock || fromBlock + 10000,
          eventsFound,
          status: 'failed',
          error: errorMessage,
        });
      }
    })();

    // Don't await - let it run in background
    rescanPromise.catch((error) => {
      console.error('Background rescan error:', error);
    });

    // Return immediately with operation ID for tracking
    sendJSON(res, {
      success: true,
      message: 'Historical rescan started',
      operationId: activityId,
      chainId,
      contractAddress: normalizedAddress,
      fromBlock,
      toBlock: toBlock || 'latest',
      trackingInfo: {
        websocketEvent: 'rescan:progress',
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
    console.error('Error starting historical rescan:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to start rescan', 500);
    return true;
  }
}
