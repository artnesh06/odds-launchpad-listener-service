import Bull, { Queue, Job, JobOptions } from 'bull';
import { getQueueConfig, QUEUE_CONFIGS, QueueName } from './queue-config';
import type {
  MintEventJob,
  NFTMetadataJob,
  MarketplaceEventJob,
  ActivityEventJob,
  HistoricalSyncJob,
  NotificationJob,
} from './queue-config';

/**
 * Queue Manager
 * Centralized management for all Bull queues
 */
export class QueueManager {
  private queues: Map<string, Queue> = new Map();
  private config = getQueueConfig();
  private isInitialized = false;

  /**
   * Initialize all queues
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('⚠️ Queue Manager already initialized');
      return;
    }

    console.log('🚀 Initializing Queue Manager...');

    try {
      // Create all queues
      for (const [key, queueConfig] of Object.entries(QUEUE_CONFIGS)) {
        const queue = new Bull(queueConfig.name, {
          redis: this.config.redis,
          defaultJobOptions: queueConfig.jobOptions,
        });

        // Setup event listeners
        this.setupQueueEventListeners(queue, queueConfig.name);

        this.queues.set(queueConfig.name, queue);
        console.log(`✅ Queue initialized: ${queueConfig.name}`);
      }

      this.isInitialized = true;
      console.log(`✅ Queue Manager initialized with ${this.queues.size} queues`);
    } catch (error) {
      console.error('❌ Failed to initialize Queue Manager:', error);
      throw error;
    }
  }

  /**
   * Setup event listeners for a queue
   */
  private setupQueueEventListeners(queue: Queue, queueName: string): void {
    // Job completed
    queue.on('completed', (job: Job, result: any) => {
      console.log(`✅ [${queueName}] Job ${job.id} completed`);
    });

    // Job failed
    queue.on('failed', (job: Job, err: Error) => {
      console.error(`❌ [${queueName}] Job ${job.id} failed:`, err.message);
    });

    // Job stalled
    queue.on('stalled', (job: Job) => {
      console.warn(`⚠️ [${queueName}] Job ${job.id} stalled`);
    });

    // Queue error
    queue.on('error', (error: Error) => {
      console.error(`❌ [${queueName}] Queue error:`, error);
    });

    // Queue paused
    queue.on('paused', () => {
      console.log(`⏸️ [${queueName}] Queue paused`);
    });

    // Queue resumed
    queue.on('resumed', () => {
      console.log(`▶️ [${queueName}] Queue resumed`);
    });
  }

  /**
   * Get a queue by name
   */
  getQueue(queueName: QueueName): Queue | undefined {
    return this.queues.get(queueName);
  }

  /**
   * Add a mint event job
   */
  async addMintEventJob(data: MintEventJob, options?: JobOptions): Promise<Job<MintEventJob>> {
    const queue = this.getQueue(QueueName.MINT_EVENTS);
    if (!queue) {
      throw new Error('Mint events queue not initialized');
    }

    return queue.add(data, {
      ...QUEUE_CONFIGS.MINT_EVENTS.jobOptions,
      ...options,
      jobId: `mint-${data.chainId}-${data.txHash}-${data.logIndex}`, // Prevent duplicates
    });
  }

  /**
   * Add an NFT metadata job
   */
  async addNFTMetadataJob(data: NFTMetadataJob, options?: JobOptions): Promise<Job<NFTMetadataJob>> {
    const queue = this.getQueue(QueueName.NFT_METADATA);
    if (!queue) {
      throw new Error('NFT metadata queue not initialized');
    }

    return queue.add(data, {
      ...QUEUE_CONFIGS.NFT_METADATA.jobOptions,
      ...options,
      jobId: `metadata-${data.chainId}-${data.contractAddress}-${data.tokenId}`,
    });
  }

  /**
   * Add a marketplace event job
   */
  async addMarketplaceEventJob(
    data: MarketplaceEventJob,
    options?: JobOptions
  ): Promise<Job<MarketplaceEventJob>> {
    const queue = this.getQueue(QueueName.MARKETPLACE_EVENTS);
    if (!queue) {
      throw new Error('Marketplace events queue not initialized');
    }

    return queue.add(data, {
      ...QUEUE_CONFIGS.MARKETPLACE_EVENTS.jobOptions,
      ...options,
      jobId: `marketplace-${data.chainId}-${data.txHash}-${data.eventType}`,
    });
  }

  /**
   * Add an activity event job
   */
  async addActivityEventJob(
    data: ActivityEventJob,
    options?: JobOptions
  ): Promise<Job<ActivityEventJob>> {
    const queue = this.getQueue(QueueName.ACTIVITY_EVENTS);
    if (!queue) {
      throw new Error('Activity events queue not initialized');
    }

    return queue.add(data, {
      ...QUEUE_CONFIGS.ACTIVITY_EVENTS.jobOptions,
      ...options,
      jobId: `activity-${data.chainId}-${data.txHash}-${data.eventType}`,
    });
  }

  /**
   * Add a historical sync job
   */
  async addHistoricalSyncJob(
    data: HistoricalSyncJob,
    options?: JobOptions
  ): Promise<Job<HistoricalSyncJob>> {
    const queue = this.getQueue(QueueName.HISTORICAL_SYNC);
    if (!queue) {
      throw new Error('Historical sync queue not initialized');
    }

    return queue.add(data, {
      ...QUEUE_CONFIGS.HISTORICAL_SYNC.jobOptions,
      ...options,
      jobId: `sync-${data.chainId}-${data.contractAddress}-${data.startBlock}-${data.endBlock}`,
    });
  }

  /**
   * Add a notification job
   */
  async addNotificationJob(
    data: NotificationJob,
    options?: JobOptions
  ): Promise<Job<NotificationJob>> {
    const queue = this.getQueue(QueueName.NOTIFICATIONS);
    if (!queue) {
      throw new Error('Notifications queue not initialized');
    }

    return queue.add(data, {
      ...QUEUE_CONFIGS.NOTIFICATIONS.jobOptions,
      ...options,
      priority: data.priority === 'high' ? 1 : data.priority === 'medium' ? 2 : 3,
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(queueName: QueueName): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  }> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      queue.getPausedCount(),
    ]);

    return { waiting, active, completed, failed, delayed, paused };
  }

  /**
   * Get all queues statistics
   */
  async getAllQueueStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    for (const queueName of Object.values(QueueName)) {
      try {
        stats[queueName] = await this.getQueueStats(queueName);
      } catch (error) {
        console.error(`Error getting stats for queue ${queueName}:`, error);
        stats[queueName] = { error: 'Failed to get stats' };
      }
    }

    return stats;
  }

  /**
   * Pause a queue
   */
  async pauseQueue(queueName: QueueName): Promise<void> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.pause();
    console.log(`⏸️ Queue ${queueName} paused`);
  }

  /**
   * Resume a queue
   */
  async resumeQueue(queueName: QueueName): Promise<void> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.resume();
    console.log(`▶️ Queue ${queueName} resumed`);
  }

  /**
   * Clean completed jobs from a queue
   */
  async cleanQueue(queueName: QueueName, grace: number = 86400000): Promise<void> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    await queue.clean(grace, 'completed');
    await queue.clean(grace * 7, 'failed'); // Keep failed jobs longer
    console.log(`🧹 Queue ${queueName} cleaned`);
  }

  /**
   * Get failed jobs from a queue
   */
  async getFailedJobs(queueName: QueueName, start = 0, end = 10): Promise<Job[]> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    return queue.getFailed(start, end);
  }

  /**
   * Retry a failed job
   */
  async retryFailedJob(queueName: QueueName, jobId: string): Promise<void> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const job = await queue.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    await job.retry();
    console.log(`🔄 Job ${jobId} retried`);
  }

  /**
   * Retry all failed jobs in a queue
   */
  async retryAllFailedJobs(queueName: QueueName): Promise<number> {
    const queue = this.getQueue(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const failedJobs = await queue.getFailed();
    let retried = 0;

    for (const job of failedJobs) {
      try {
        await job.retry();
        retried++;
      } catch (error) {
        console.error(`Failed to retry job ${job.id}:`, error);
      }
    }

    console.log(`🔄 Retried ${retried}/${failedJobs.length} failed jobs in ${queueName}`);
    return retried;
  }

  /**
   * Close all queues
   */
  async close(): Promise<void> {
    console.log('🛑 Closing all queues...');

    const closePromises = Array.from(this.queues.values()).map((queue) => queue.close());
    await Promise.all(closePromises);

    this.queues.clear();
    this.isInitialized = false;

    console.log('✅ All queues closed');
  }

  /**
   * Check if queue manager is initialized
   */
  isReady(): boolean {
    return this.isInitialized;
  }
}

// Singleton instance
let queueManagerInstance: QueueManager | null = null;

/**
 * Get Queue Manager singleton instance
 */
export function getQueueManager(): QueueManager {
  if (!queueManagerInstance) {
    queueManagerInstance = new QueueManager();
  }
  return queueManagerInstance;
}

/**
 * Initialize Queue Manager (call once at startup)
 */
export async function initializeQueueManager(): Promise<QueueManager> {
  const manager = getQueueManager();
  if (!manager.isReady()) {
    await manager.initialize();
  }
  return manager;
}
