import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma Client instance
 * Prevents multiple database connections in development
 */
let prismaInstance: PrismaClient | null = null;
let isConnecting = false;

/**
 * Database Semaphore - limits concurrent database operations
 * Prevents "too many connections" errors during batch operations
 */
class DatabaseSemaphore {
  private currentConnections: number = 0;
  private readonly maxConnections: number;
  private waitQueue: Array<() => void> = [];

  constructor(maxConnections: number = 15) {
    this.maxConnections = maxConnections;
  }

  async acquire(): Promise<void> {
    if (this.currentConnections < this.maxConnections) {
      this.currentConnections++;
      return;
    }

    // Wait for a slot to become available
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.currentConnections++;
        resolve();
      });
    });
  }

  release(): void {
    this.currentConnections--;
    
    // If there are waiting operations, let one proceed
    if (this.waitQueue.length > 0 && this.currentConnections < this.maxConnections) {
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }

  getStatus(): { current: number; max: number; waiting: number } {
    return {
      current: this.currentConnections,
      max: this.maxConnections,
      waiting: this.waitQueue.length
    };
  }
}

// Global semaphore instance - limit to 15 concurrent DB operations
export const dbSemaphore = new DatabaseSemaphore(15);

/**
 * Execute database operation with semaphore protection
 * Prevents too many concurrent connections
 */
export async function withDbLimit<T>(operation: () => Promise<T>): Promise<T> {
  await dbSemaphore.acquire();
  try {
    return await operation();
  } finally {
    dbSemaphore.release();
  }
}

/**
 * Create a new Prisma Client with proper configuration
 * Connection limit reduced to work with semaphore
 */
function createPrismaClient(): PrismaClient {
  // Build connection URL with pool settings
  let connectionUrl = process.env.DATABASE_URL || '';
  
  // Add connection pool settings if not already present
  // Keep connection_limit low since we control concurrency with semaphore
  if (!connectionUrl.includes('connection_limit')) {
    const separator = connectionUrl.includes('?') ? '&' : '?';
    connectionUrl += `${separator}connection_limit=20&pool_timeout=30`;
  }
  
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['error', 'warn']
      : ['error'],
    datasources: {
      db: {
        url: connectionUrl
      }
    }
  });
  client.$use(blockTimeMiddleware);
  return client;
}

// ---------------------------------------------------------------------------
// Event time = block time
//
// Activities and mints used to get createdAt = "when the listener stored them",
// so events replayed after downtime (or during a history backfill) showed up as
// "minted 1h ago". When a row carries a blockNumber, createdAt is now the
// timestamp of that block.
// ---------------------------------------------------------------------------

const blockTimeCache = new Map<string, Date>();

async function blockTime(chainId: number, blockNumber: number): Promise<Date | null> {
  const key = `${chainId}:${blockNumber}`;
  const hit = blockTimeCache.get(key);
  if (hit) return hit;
  try {
    // Lazy import: chain-provider depends on modules that import this file
    const { getChainProvider } = await import('../lib/blockchain/chain-provider');
    const block = await getChainProvider(chainId).getBlock(blockNumber);
    if (!block) return null;
    const date = new Date(block.timestamp * 1000);
    if (blockTimeCache.size > 5000) blockTimeCache.clear();
    blockTimeCache.set(key, date);
    return date;
  } catch {
    return null; // fall back to the default (now)
  }
}

function defaultChainId(): number {
  const first = parseInt((process.env.LISTENER_CHAIN_IDS || '4326').split(',')[0], 10);
  return Number.isFinite(first) ? first : 4326;
}

async function withBlockTime(data: any): Promise<void> {
  if (!data || typeof data !== 'object' || data.createdAt) return;
  const blockNumber = typeof data.blockNumber === 'number' ? data.blockNumber : Number(data.blockNumber);
  if (!Number.isFinite(blockNumber) || blockNumber <= 0) return;
  const chainId = typeof data.chainId === 'number' ? data.chainId : defaultChainId();
  const time = await blockTime(chainId, blockNumber);
  if (time) data.createdAt = time;
}

const BLOCK_TIME_MODELS = new Set(['Activity', 'Mint']);

async function blockTimeMiddleware(params: any, next: (params: any) => Promise<any>) {
  if (params.model && BLOCK_TIME_MODELS.has(params.model)) {
    if (params.action === 'create') await withBlockTime(params.args?.data);
    else if (params.action === 'upsert') await withBlockTime(params.args?.create);
    else if (params.action === 'createMany') {
      const rows = Array.isArray(params.args?.data) ? params.args.data : [params.args?.data];
      for (const row of rows) await withBlockTime(row);
    }
  }
  return next(params);
}

/**
 * Get or create Prisma Client instance with auto-reconnect
 * @returns Prisma Client singleton
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = createPrismaClient();
  }
  return prismaInstance;
}

/**
 * Reconnect Prisma Client after connection error
 */
export async function reconnectPrisma(): Promise<void> {
  if (isConnecting) {
    console.log('⏳ Already reconnecting, waiting...');
    // Wait for ongoing reconnection
    while (isConnecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return;
  }

  isConnecting = true;
  try {
    console.log('🔄 Reconnecting to database...');
    
    // Disconnect old instance
    if (prismaInstance) {
      try {
        await prismaInstance.$disconnect();
      } catch (err) {
        console.warn('⚠️ Error disconnecting old Prisma instance:', err);
      }
      prismaInstance = null;
    }

    // Create new instance
    prismaInstance = createPrismaClient();
    
    // Test connection
    await prismaInstance.$queryRaw`SELECT 1`;
    console.log('✅ Database reconnected successfully');
  } catch (error) {
    console.error('❌ Failed to reconnect to database:', error);
    prismaInstance = null;
    throw error;
  } finally {
    isConnecting = false;
  }
}

/**
 * Check if error is a recoverable connection error
 */
export function isConnectionError(error: any): boolean {
  const errorCode = error?.code;
  const errorMessage = error?.message || '';
  
  // Prisma error codes
  const prismaConnectionErrors = [
    'P1001', // Can't reach database
    'P1002', // Database timeout
    'P1008', // Operations timed out
    'P1017', // Server closed connection
    'P2024', // Timed out fetching connection from pool
  ];
  
  // PostgreSQL error codes (from SQLSTATE)
  const pgConnectionErrors = [
    '57P01', // admin_shutdown - terminating connection due to administrator command
    '57P02', // crash_shutdown
    '57P03', // cannot_connect_now
    '08000', // connection_exception
    '08003', // connection_does_not_exist
    '08006', // connection_failure
    '08001', // sqlclient_unable_to_establish_sqlconnection
    '08004', // sqlserver_rejected_establishment_of_sqlconnection
  ];
  
  // Check Prisma error codes
  if (prismaConnectionErrors.includes(errorCode)) {
    return true;
  }
  
  // Check PostgreSQL error codes (can appear in message or nested)
  for (const pgCode of pgConnectionErrors) {
    if (errorMessage.includes(pgCode) || errorMessage.includes(`E${pgCode}`)) {
      return true;
    }
  }
  
  // Check common error message patterns
  const connectionErrorPatterns = [
    'Connection',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'forcibly closed',
    'terminating connection',
    'administrator command',
    'connection pool',
    'socket hang up',
    'read ECONNRESET',
    'write ECONNRESET',
    'Connection terminated',
    'Connection lost',
    'server closed the connection',
    'Cannot reach database',
    'Connection timed out',
  ];
  
  for (const pattern of connectionErrorPatterns) {
    if (errorMessage.toLowerCase().includes(pattern.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

/**
 * Execute a database operation with automatic retry on connection errors
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 5,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      if (isConnectionError(error) && attempt < maxRetries) {
        // Exponential backoff with jitter
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
        console.warn(`⚠️ Database connection error (attempt ${attempt}/${maxRetries}): ${error.message?.substring(0, 100)}`);
        console.log(`🔄 Reconnecting in ${Math.round(delay)}ms...`);
        
        try {
          await reconnectPrisma();
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        } catch (reconnectError) {
          console.error('❌ Reconnection failed:', reconnectError);
          // Wait before next retry anyway
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      // If not a connection error or max retries reached, throw
      if (attempt === maxRetries) {
        console.error(`❌ Database operation failed after ${maxRetries} attempts`);
        throw lastError;
      }
    }
  }
  
  throw lastError;
}

// Export singleton instance
export const prisma = getPrismaClient();

/**
 * Periodic health check interval (in ms)
 */
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
let healthCheckTimer: NodeJS.Timeout | null = null;

/**
 * Start periodic database health check
 * Automatically reconnects if connection is lost
 */
export function startDatabaseHealthCheck(): void {
  if (healthCheckTimer) {
    console.log('⚠️ Database health check already running');
    return;
  }

  console.log('🏥 Starting database health check (every 30s)');
  
  healthCheckTimer = setInterval(async () => {
    try {
      if (prismaInstance) {
        await prismaInstance.$queryRaw`SELECT 1`;
      }
    } catch (error: any) {
      console.warn('⚠️ Database health check failed:', error.message?.substring(0, 100));
      
      if (isConnectionError(error)) {
        console.log('🔄 Attempting automatic reconnection...');
        try {
          await reconnectPrisma();
          console.log('✅ Auto-reconnection successful');
        } catch (reconnectError) {
          console.error('❌ Auto-reconnection failed, will retry on next check');
        }
      }
    }
  }, HEALTH_CHECK_INTERVAL);

  // Don't prevent process from exiting
  healthCheckTimer.unref();
}

/**
 * Stop periodic database health check
 */
export function stopDatabaseHealthCheck(): void {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
    console.log('🛑 Database health check stopped');
  }
}

/**
 * Graceful shutdown - disconnect from database
 */
export async function disconnectDatabase(): Promise<void> {
  stopDatabaseHealthCheck();
  
  if (prismaInstance) {
    try {
      await prismaInstance.$disconnect();
      prismaInstance = null;
      console.log('✅ Database disconnected gracefully');
    } catch (error) {
      console.error('⚠️ Error during database disconnect:', error);
    }
  }
}

// Handle process termination
process.on('beforeExit', async () => {
  await disconnectDatabase();
});

process.on('SIGINT', async () => {
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await disconnectDatabase();
  process.exit(0);
});
