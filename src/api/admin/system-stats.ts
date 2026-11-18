import { IncomingMessage, ServerResponse } from 'http';
import { prisma } from '../../config/database';
import { getMultiChainListenerManager } from '../../lib/blockchain/multi-chain-listener-manager';
import { dbSemaphore } from '../../config/database';
import { sendJSON, sendError } from './index';

// Track service start time for uptime calculation
const serviceStartTime = Date.now();

/**
 * Handle GET /api/admin/stats
 * Get overall system statistics
 */
export async function handleSystemStats(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  try {
    // Get listener manager status
    const manager = getMultiChainListenerManager();
    const chainStatuses = await manager.getStatus();
    const activeChains = chainStatuses.filter((s) => s.isRunning).length;

    // Get database stats
    const [
      totalLaunchpads,
      activeLaunchpads,
      totalNFTs,
      totalMints,
      lastMint,
      totalHolders,
    ] = await Promise.all([
      prisma.launchpad.count(),
      prisma.launchpad.count({ where: { status: 'ACTIVE' } }),
      prisma.nFT.count(),
      prisma.mint.count(),
      prisma.mint.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      prisma.mint.groupBy({
        by: ['minter'],
        _count: true,
      }).then((result) => result.length),
    ]);

    // Get launchpad stats by chain
    const launchpadsByChain = await prisma.launchpad.groupBy({
      by: ['chainId'],
      _count: { id: true },
      where: { status: 'ACTIVE' },
    });

    // Get mint stats for last 24 hours
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const mintsLast24h = await prisma.mint.count({
      where: { createdAt: { gte: last24Hours } },
    });

    // Get database connection stats
    const dbStatus = dbSemaphore.getStatus();

    // Get WebSocket stats if available
    let websocketStats = null;
    const wsManager = (global as any).websocketManager;
    if (wsManager) {
      try {
        const healthStatus = wsManager.getHealthStatus();
        const performanceMetrics = wsManager.getPerformanceMetrics();
        websocketStats = {
          activeConnections: healthStatus.connectionCount,
          roomCount: healthStatus.roomCount,
          messagesPerSecond: Math.round(performanceMetrics.messagesPerSecond * 100) / 100,
          totalMessagesDelivered: performanceMetrics.totalMessagesDelivered || 0,
        };
      } catch (error) {
        // WebSocket stats not available
      }
    }

    // Calculate uptime
    const uptimeMs = Date.now() - serviceStartTime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    const uptimeMinutes = Math.floor(uptimeSeconds / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    const uptimeDays = Math.floor(uptimeHours / 24);

    // Memory usage
    const memoryUsage = process.memoryUsage();

    sendJSON(res, {
      timestamp: new Date().toISOString(),
      
      // Core stats
      launchpads: {
        total: totalLaunchpads,
        active: activeLaunchpads,
        byChain: launchpadsByChain.reduce((acc, item) => {
          acc[item.chainId] = item._count.id;
          return acc;
        }, {} as Record<number, number>),
      },
      
      nfts: {
        total: totalNFTs,
      },
      
      mints: {
        total: totalMints,
        last24Hours: mintsLast24h,
        lastMintAt: lastMint?.createdAt?.toISOString() || null,
      },
      
      holders: {
        unique: totalHolders,
      },
      
      // Chain listeners
      chains: {
        total: chainStatuses.length,
        active: activeChains,
        statuses: chainStatuses.map((s) => ({
          chainId: s.chainId,
          chainName: s.chainName,
          isRunning: s.isRunning,
          launchpadCount: s.launchpadCount,
          error: s.error,
        })),
      },
      
      // Database
      database: {
        activeConnections: dbStatus.current,
        maxConnections: dbStatus.max,
        waiting: dbStatus.waiting,
      },
      
      // WebSocket
      websocket: websocketStats,
      
      // System
      uptime: {
        milliseconds: uptimeMs,
        seconds: uptimeSeconds,
        formatted: `${uptimeDays}d ${uptimeHours % 24}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s`,
      },
      
      memory: {
        heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memoryUsage.rss / 1024 / 1024),
        externalMB: Math.round(memoryUsage.external / 1024 / 1024),
      },
      
      // Node info
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      },
    });
    return true;
  } catch (error) {
    console.error('Error getting system stats:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to get system stats', 500);
    return true;
  }
}
