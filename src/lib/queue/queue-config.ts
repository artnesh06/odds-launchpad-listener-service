import { QueueOptions, JobOptions } from 'bull';

/**
 * Queue Configuration
 * Centralized configuration for all queues
 */

export interface QueueConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    maxRetriesPerRequest: number;
  };
  defaultJobOptions: JobOptions;
  queueOptions: QueueOptions;
}

/**
 * Get Redis configuration from environment
 */
export function getRedisConfig() {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: 3,
  };
}

/**
 * Default job options for all queues
 */
export const DEFAULT_JOB_OPTIONS: JobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000, // Start with 2 seconds
  },
  removeOnComplete: {
    age: 86400, // Keep completed jobs for 24 hours
    count: 1000, // Keep last 1000 completed jobs
  },
  removeOnFail: {
    age: 604800, // Keep failed jobs for 7 days
    count: 5000, // Keep last 5000 failed jobs
  },
};

/**
 * Queue-specific configurations
 */
export const QUEUE_CONFIGS = {
  // Mint events queue - high priority, high volume
  MINT_EVENTS: {
    name: 'mint-events',
    concurrency: 10, // Process 10 jobs concurrently
    priority: 1, // High priority
    jobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 5, // More retries for critical mints
    },
  },

  // NFT metadata queue - medium priority
  NFT_METADATA: {
    name: 'nft-metadata',
    concurrency: 5,
    priority: 2,
    jobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      timeout: 30000, // 30 second timeout for metadata fetching
    },
  },

  // Marketplace events queue - medium priority
  MARKETPLACE_EVENTS: {
    name: 'marketplace-events',
    concurrency: 8,
    priority: 2,
    jobOptions: DEFAULT_JOB_OPTIONS,
  },

  // Activity events queue - low priority
  ACTIVITY_EVENTS: {
    name: 'activity-events',
    concurrency: 5,
    priority: 3,
    jobOptions: DEFAULT_JOB_OPTIONS,
  },

  // Historical sync queue - low priority, long-running
  HISTORICAL_SYNC: {
    name: 'historical-sync',
    concurrency: 2, // Limit concurrent historical syncs
    priority: 4,
    jobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      timeout: 600000, // 10 minute timeout
      attempts: 2, // Fewer retries for historical sync
    },
  },

  // Notification queue - high priority, low volume
  NOTIFICATIONS: {
    name: 'notifications',
    concurrency: 3,
    priority: 1,
    jobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 5,
    },
  },
};

/**
 * Get queue configuration
 */
export function getQueueConfig(): QueueConfig {
  const redis = getRedisConfig();

  return {
    redis,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
    queueOptions: {
      redis,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
      settings: {
        lockDuration: 30000, // 30 seconds
        stalledInterval: 30000, // Check for stalled jobs every 30 seconds
        maxStalledCount: 2, // Retry stalled jobs twice
      },
    },
  };
}

/**
 * Queue names enum for type safety
 */
export enum QueueName {
  MINT_EVENTS = 'mint-events',
  NFT_METADATA = 'nft-metadata',
  MARKETPLACE_EVENTS = 'marketplace-events',
  ACTIVITY_EVENTS = 'activity-events',
  HISTORICAL_SYNC = 'historical-sync',
  NOTIFICATIONS = 'notifications',
}

/**
 * Job types for each queue
 */
export interface MintEventJob {
  chainId: number;
  launchpadAddress: string;
  from: string;
  to: string;
  tokenId: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  timestamp: Date;
}

export interface NFTMetadataJob {
  chainId: number;
  contractAddress: string;
  tokenId: string;
  tokenUri?: string;
  forceRefresh?: boolean;
}

export interface MarketplaceEventJob {
  chainId: number;
  marketplace: string;
  eventType: 'sale' | 'listing' | 'offer' | 'cancel';
  contractAddress: string;
  tokenId: string;
  data: any;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
}

export interface ActivityEventJob {
  chainId: number;
  launchpadAddress?: string;
  eventType: string;
  data: any;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
}

export interface HistoricalSyncJob {
  chainId: number;
  contractAddress: string;
  startBlock: number;
  endBlock: number;
  syncType: 'nft' | 'marketplace' | 'activity';
}

export interface NotificationJob {
  type: 'mint' | 'sale' | 'listing' | 'alert';
  recipients: string[];
  data: any;
  priority: 'high' | 'medium' | 'low';
}
