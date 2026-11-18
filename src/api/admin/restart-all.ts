import { IncomingMessage, ServerResponse } from 'http';
import { getMultiChainListenerManager } from '../../lib/blockchain/multi-chain-listener-manager';
import { sendJSON, sendError } from './index';
import { logActivity } from './activity-logger';

/**
 * Handle POST /api/admin/restart-all
 * Restart all chain listeners
 */
export async function handleRestartAll(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const activityId = await logActivity({
    operationType: 'restart',
    status: 'in_progress',
    metadata: { action: 'restart_all' },
  });

  try {
    const manager = getMultiChainListenerManager();
    
    // Get current status before restart
    const statusBefore = await manager.getStatus();
    const activeChainIds = manager.getActiveChainIds();

    const results: Array<{
      chainId: number;
      chainName: string;
      success: boolean;
      error?: string;
    }> = [];

    // Restart each chain
    for (const status of statusBefore) {
      try {
        await manager.restartChain(status.chainId);
        results.push({
          chainId: status.chainId,
          chainName: status.chainName,
          success: true,
        });
      } catch (error) {
        results.push({
          chainId: status.chainId,
          chainName: status.chainName,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Get status after restart
    const statusAfter = await manager.getStatus();

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    await logActivity({
      id: activityId,
      status: failCount === 0 ? 'success' : 'failed',
      itemsProcessed: successCount,
      itemsFailed: failCount,
      metadata: {
        results,
        chainsRestarted: successCount,
        chainsFailed: failCount,
      },
    });

    sendJSON(res, {
      success: failCount === 0,
      message: `Restarted ${successCount}/${results.length} chain listeners`,
      results,
      summary: {
        total: results.length,
        successful: successCount,
        failed: failCount,
      },
      statusAfter: statusAfter.map((s) => ({
        chainId: s.chainId,
        chainName: s.chainName,
        isRunning: s.isRunning,
        launchpadCount: s.launchpadCount,
        error: s.error,
      })),
    });
    return true;
  } catch (error) {
    await logActivity({
      id: activityId,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    console.error('Error restarting all listeners:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to restart listeners', 500);
    return true;
  }
}
