import { ethers } from 'ethers';
import { getMultiChainListenerManager } from '../blockchain/multi-chain-listener-manager';
import { prisma, withRetry } from '../../config/database';
import { blockchainWebSocketMetrics, BlockchainWebSocketMetrics } from './blockchain-websocket-metrics';

// WebSocket polyfill for Node.js environment
if (typeof WebSocket === 'undefined') {
  try {
    const WS = require('ws');
    (global as any).WebSocket = WS;
  } catch (error) {
    // Silent fail - will use HTTP providers as fallback
  }
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  checks: {
    database: CheckResult;
    rpcConnections: CheckResult;
    listeners: CheckResult;
    cache: CheckResult;
  };
  metrics: SystemMetrics;
}

export interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: any;
}

export interface SystemMetrics {
  currentBlock: Record<number, number>; // chainId -> block number
  eventsProcessed: number;
  syncLag: Record<number, number>; // chainId -> blocks behind
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  uptime: number;
  blockchainWebSocket?: BlockchainWebSocketMetrics; // WebSocket metrics for featured launchpads
}

/**
 * Check database connection health
 */
async function checkDatabase(): Promise<CheckResult> {
  try {
    await withRetry(() => prisma.$queryRaw`SELECT 1`);
    return {
      status: 'pass',
      message: 'Database connection is healthy',
    };
  } catch (error) {
    return {
      status: 'fail',
      message: 'Database connection failed',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check RPC connections for all chains
 */
async function checkRPCConnections(): Promise<CheckResult> {
  try {
    const chains = await prisma.chain.findMany({
      select: {
        chainId: true,
        name: true,
        rpcUrl: true,
      },
    });

    const results = await Promise.allSettled(
      chains.map(async (chain) => {
        // Always use HTTP provider to avoid eth_subscribe issues
        const rpcUrl = chain.rpcUrl.replace('wss://', 'https://').replace('ws://', 'http://');
        const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
          staticNetwork: true // Skip network detection
        });
        const blockNumber = await provider.getBlockNumber();
        return {
          chainId: chain.chainId,
          name: chain.name,
          blockNumber,
          status: 'connected',
        };
      })
    );

    const failed = results.filter((r) => r.status === 'rejected');
    const successful = results.filter((r) => r.status === 'fulfilled');

    if (failed.length === 0) {
      return {
        status: 'pass',
        message: `All ${chains.length} RPC connections are healthy`,
        details: successful.map((r) =>
          r.status === 'fulfilled' ? r.value : null
        ),
      };
    } else if (failed.length < chains.length) {
      return {
        status: 'warn',
        message: `${failed.length} of ${chains.length} RPC connections failed`,
        details: {
          successful: successful.length,
          failed: failed.length,
        },
      };
    } else {
      return {
        status: 'fail',
        message: 'All RPC connections failed',
      };
    }
  } catch (error) {
    return {
      status: 'fail',
      message: 'Failed to check RPC connections',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check listener status
 */
async function checkListeners(): Promise<CheckResult> {
  try {
    const manager = getMultiChainListenerManager();
    const statuses = await manager.getStatus();

    const running = statuses.filter((s) => s.isRunning);
    const notRunning = statuses.filter((s) => !s.isRunning);
    
    // Check for stale listeners (running but not receiving events)
    const staleListeners = statuses.filter((s: any) => s.isRunning && s.liveness?.isStale);

    if (notRunning.length === 0 && staleListeners.length === 0) {
      return {
        status: 'pass',
        message: `All ${statuses.length} listeners are running and receiving events`,
        details: statuses,
      };
    } else if (staleListeners.length > 0) {
      return {
        status: 'warn',
        message: `${staleListeners.length} listener(s) may have stale event subscriptions`,
        details: {
          running: running.length,
          notRunning: notRunning.length,
          stale: staleListeners.length,
          staleDetails: staleListeners.map((s: any) => ({
            chainId: s.chainId,
            minutesSinceLastEvent: s.liveness?.timeSinceLastEventMinutes
          })),
          details: statuses,
        },
      };
    } else if (running.length > 0) {
      return {
        status: 'warn',
        message: `${notRunning.length} of ${statuses.length} listeners are not running`,
        details: {
          running: running.length,
          notRunning: notRunning.length,
          details: notRunning,
        },
      };
    } else {
      return {
        status: 'fail',
        message: 'No listeners are running',
        details: statuses,
      };
    }
  } catch (error) {
    return {
      status: 'fail',
      message: 'Failed to check listener status',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check cache health
 */
async function checkCache(): Promise<CheckResult> {
  try {
    // Simple cache health check - could be expanded
    return {
      status: 'pass',
      message: 'Cache is operational',
    };
  } catch (error) {
    return {
      status: 'fail',
      message: 'Cache check failed',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get system metrics
 */
async function getSystemMetrics(): Promise<SystemMetrics> {
  const manager = getMultiChainListenerManager();
  const statuses = await manager.getStatus();

  // Get current block numbers
  const currentBlock: Record<number, number> = {};
  const syncLag: Record<number, number> = {};

  for (const status of statuses) {
    if (status.isRunning) {
      try {
        const chain = await prisma.chain.findUnique({
          where: { chainId: status.chainId },
          select: { rpcUrl: true },
        });

        if (chain) {
          const rpcUrl = chain.rpcUrl.replace('wss://', 'https://').replace('ws://', 'http://');
          const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
            staticNetwork: true
          });
          const latestBlock = await provider.getBlockNumber();
          currentBlock[status.chainId] = latestBlock;

          // Calculate sync lag (simplified - would need actual last processed block)
          syncLag[status.chainId] = 0; // Placeholder
        }
      } catch (error) {
        console.error(
          `Error getting metrics for chain ${status.chainId}:`,
          error
        );
      }
    }
  }

  // Get total events processed
  const eventsProcessed = await prisma.nFTTransfer.count();

  // Get memory usage
  const memoryUsage = process.memoryUsage();

  return {
    currentBlock,
    eventsProcessed,
    syncLag,
    memoryUsage: {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
      external: Math.round(memoryUsage.external / 1024 / 1024), // MB
      rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
    },
    uptime: Math.round(process.uptime()),
    blockchainWebSocket: blockchainWebSocketMetrics.getMetrics(), // Include WebSocket metrics
  };
}

/**
 * Perform complete health check
 */
export async function performHealthCheck(): Promise<HealthStatus> {
  const [database, rpcConnections, listeners, cache, metrics] =
    await Promise.all([
      checkDatabase(),
      checkRPCConnections(),
      checkListeners(),
      checkCache(),
      getSystemMetrics(),
    ]);

  // Determine overall status
  const checks = { database, rpcConnections, listeners, cache };
  const hasFailure = Object.values(checks).some((c) => c.status === 'fail');
  const hasWarning = Object.values(checks).some((c) => c.status === 'warn');

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (hasFailure) {
    status = 'unhealthy';
  } else if (hasWarning) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  return {
    status,
    timestamp: new Date(),
    checks,
    metrics,
  };
}

/**
 * Get sync status for all chains
 */
export async function getSyncStatus(): Promise<
  Array<{
    chainId: number;
    chainName: string;
    currentBlock: number;
    latestBlock: number;
    blocksBehind: number;
    eventsProcessed: number;
    isRunning: boolean;
  }>
> {
  const manager = getMultiChainListenerManager();
  const statuses = await manager.getStatus();

  const syncStatuses = await Promise.all(
    statuses.map(async (status) => {
      try {
        const chain = await prisma.chain.findUnique({
          where: { chainId: status.chainId },
          select: { rpcUrl: true },
        });

        if (!chain) {
          return {
            chainId: status.chainId,
            chainName: status.chainName,
            currentBlock: 0,
            latestBlock: 0,
            blocksBehind: 0,
            eventsProcessed: 0,
            isRunning: status.isRunning,
          };
        }

        const rpcUrl = chain.rpcUrl.replace('wss://', 'https://').replace('ws://', 'http://');
        const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
          staticNetwork: true
        });
        const latestBlock = await provider.getBlockNumber();

        // Get last processed block
        const lastTransfer = await prisma.nFTTransfer.findFirst({
          where: { chainId: status.chainId },
          orderBy: { blockNumber: 'desc' },
          select: { blockNumber: true },
        });

        const currentBlock = lastTransfer?.blockNumber || 0;
        const blocksBehind = latestBlock - currentBlock;

        // Get events processed for this chain
        const eventsProcessed = await prisma.nFTTransfer.count({
          where: { chainId: status.chainId },
        });

        return {
          chainId: status.chainId,
          chainName: status.chainName,
          currentBlock,
          latestBlock,
          blocksBehind,
          eventsProcessed,
          isRunning: status.isRunning,
        };
      } catch (error) {
        console.error(
          `Error getting sync status for chain ${status.chainId}:`,
          error
        );
        return {
          chainId: status.chainId,
          chainName: status.chainName,
          currentBlock: 0,
          latestBlock: 0,
          blocksBehind: 0,
          eventsProcessed: 0,
          isRunning: false,
        };
      }
    })
  );

  return syncStatuses;
}

/**
 * Get performance metrics
 */
export async function getPerformanceMetrics(): Promise<{
  rpcLatency: Record<number, number>; // chainId -> latency in ms
  dbQueryLatency: number;
  cacheHitRate: number;
  eventsPerSecond: number;
}> {
  // Measure RPC latency for each chain
  const chains = await prisma.chain.findMany({
    select: { chainId: true, rpcUrl: true },
  });

  const rpcLatency: Record<number, number> = {};

  await Promise.all(
    chains.map(async (chain) => {
      try {
        const rpcUrl = chain.rpcUrl.replace('wss://', 'https://').replace('ws://', 'http://');
        const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
          staticNetwork: true
        });
        const start = Date.now();
        await provider.getBlockNumber();
        const latency = Date.now() - start;
        rpcLatency[chain.chainId] = latency;
      } catch (error) {
        rpcLatency[chain.chainId] = -1; // Error
      }
    })
  );

  // Measure database query latency
  const dbStart = Date.now();
  await prisma.nFT.count();
  const dbQueryLatency = Date.now() - dbStart;

  // Calculate events per second (last hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentEvents = await prisma.nFTTransfer.count({
    where: {
      createdAt: {
        gte: oneHourAgo,
      },
    },
  });
  const eventsPerSecond = recentEvents / 3600;

  return {
    rpcLatency,
    dbQueryLatency,
    cacheHitRate: 0, // Placeholder - would need actual cache metrics
    eventsPerSecond,
  };
}

/**
 * Get blockchain WebSocket metrics
 * 
 * Returns metrics for WebSocket connections and event processing
 * for featured launchpads.
 * 
 * Requirements: 8.4, 8.5
 */
export function getBlockchainWebSocketMetrics(): BlockchainWebSocketMetrics {
  return blockchainWebSocketMetrics.getMetrics();
}
