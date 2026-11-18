import { Queue } from 'bull';
import { getQueueManager } from './queue-manager';
import { QueueName, QUEUE_CONFIGS } from './queue-config';
import {
  MintEventProcessor,
  NFTMetadataProcessor,
  MarketplaceEventProcessor,
  ActivityEventProcessor,
  HistoricalSyncProcessor,
  NotificationProcessor,
} from './processors';
import { AlchemyNFTService } from '../alchemy-nft-service';
import { AlchemySpamDetector } from '../alchemy-spam-detector';
import { EventEmitter } from '../websocket/event-emitter';

/**
 * Queue Worker
 * Manages queue processors and workers
 */
export class QueueWorker {
  private queueManager = getQueueManager();
  private processors: Map<string, any> = new Map();
  private isRunning = false;

  // Services
  private alchemyService?: AlchemyNFTService;
  private spamDetector?: AlchemySpamDetector;
  private eventEmitter?: EventEmitter;

  constructor(eventEmitter?: EventEmitter) {
    this.eventEmitter = eventEmitter;
    this.initializeServices();
  }

  /**
   * Initialize Alchemy services
   */
  private initializeServices(): void {
    const alchemyApiKey = process.env.ALCHEMY_API_KEY;
    if (alchemyApiKey) {
      this.alchemyService = new AlchemyNFTService({
        apiKey: alchemyApiKey,
        network: 'eth-mainnet',
      });
      this.spamDetector = new AlchemySpamDetector(this.alchemyService);
      console.log('✅ Alchemy services initialized for queue workers');
    } else {
      console.warn('⚠️ ALCHEMY_API_KEY not set, metadata fetching will be limited');
    }
  }

  /**
   * Start all queue workers
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Queue workers already running');
      return;
    }

    console.log('🚀 Starting queue workers...');

    try {
      // Ensure queue manager is initialized
      if (!this.queueManager.isReady()) {
        await this.queueManager.initialize();
      }

      // Initialize processors
      this.initializeProcessors();

      // Start workers for each queue
      await this.startMintEventWorker();
      await this.startNFTMetadataWorker();
      await this.startMarketplaceEventWorker();
      await this.startActivityEventWorker();
      await this.startHistoricalSyncWorker();
      await this.startNotificationWorker();

      this.isRunning = true;
      console.log('✅ All queue workers started');
    } catch (error) {
      console.error('❌ Failed to start queue workers:', error);
      throw error;
    }
  }

  /**
   * Initialize all processors
   */
  private initializeProcessors(): void {
    this.processors.set(
      QueueName.MINT_EVENTS,
      new MintEventProcessor(this.alchemyService, this.spamDetector, this.eventEmitter)
    );

    if (this.alchemyService) {
      this.processors.set(QueueName.NFT_METADATA, new NFTMetadataProcessor(this.alchemyService));
    }

    this.processors.set(QueueName.MARKETPLACE_EVENTS, new MarketplaceEventProcessor());
    this.processors.set(QueueName.ACTIVITY_EVENTS, new ActivityEventProcessor());
    this.processors.set(QueueName.HISTORICAL_SYNC, new HistoricalSyncProcessor());
    this.processors.set(QueueName.NOTIFICATIONS, new NotificationProcessor(this.eventEmitter));

    console.log(`✅ Initialized ${this.processors.size} processors`);
  }

  /**
   * Start mint event worker
   */
  private async startMintEventWorker(): Promise<void> {
    const queue = this.queueManager.getQueue(QueueName.MINT_EVENTS);
    if (!queue) {
      throw new Error('Mint events queue not found');
    }

    const processor = this.processors.get(QueueName.MINT_EVENTS);
    const config = QUEUE_CONFIGS.MINT_EVENTS;

    queue.process(config.concurrency, async (job) => {
      return processor.process(job);
    });

    console.log(`✅ Mint event worker started (concurrency: ${config.concurrency})`);
  }

  /**
   * Start NFT metadata worker
   */
  private async startNFTMetadataWorker(): Promise<void> {
    const queue = this.queueManager.getQueue(QueueName.NFT_METADATA);
    if (!queue) {
      throw new Error('NFT metadata queue not found');
    }

    const processor = this.processors.get(QueueName.NFT_METADATA);
    if (!processor) {
      console.warn('⚠️ NFT metadata processor not available (Alchemy not configured)');
      return;
    }

    const config = QUEUE_CONFIGS.NFT_METADATA;

    queue.process(config.concurrency, async (job) => {
      return processor.process(job);
    });

    console.log(`✅ NFT metadata worker started (concurrency: ${config.concurrency})`);
  }

  /**
   * Start marketplace event worker
   */
  private async startMarketplaceEventWorker(): Promise<void> {
    const queue = this.queueManager.getQueue(QueueName.MARKETPLACE_EVENTS);
    if (!queue) {
      throw new Error('Marketplace events queue not found');
    }

    const processor = this.processors.get(QueueName.MARKETPLACE_EVENTS);
    const config = QUEUE_CONFIGS.MARKETPLACE_EVENTS;

    queue.process(config.concurrency, async (job) => {
      return processor.process(job);
    });

    console.log(`✅ Marketplace event worker started (concurrency: ${config.concurrency})`);
  }

  /**
   * Start activity event worker
   */
  private async startActivityEventWorker(): Promise<void> {
    const queue = this.queueManager.getQueue(QueueName.ACTIVITY_EVENTS);
    if (!queue) {
      throw new Error('Activity events queue not found');
    }

    const processor = this.processors.get(QueueName.ACTIVITY_EVENTS);
    const config = QUEUE_CONFIGS.ACTIVITY_EVENTS;

    queue.process(config.concurrency, async (job) => {
      return processor.process(job);
    });

    console.log(`✅ Activity event worker started (concurrency: ${config.concurrency})`);
  }

  /**
   * Start historical sync worker
   */
  private async startHistoricalSyncWorker(): Promise<void> {
    const queue = this.queueManager.getQueue(QueueName.HISTORICAL_SYNC);
    if (!queue) {
      throw new Error('Historical sync queue not found');
    }

    const processor = this.processors.get(QueueName.HISTORICAL_SYNC);
    const config = QUEUE_CONFIGS.HISTORICAL_SYNC;

    queue.process(config.concurrency, async (job) => {
      return processor.process(job);
    });

    console.log(`✅ Historical sync worker started (concurrency: ${config.concurrency})`);
  }

  /**
   * Start notification worker
   */
  private async startNotificationWorker(): Promise<void> {
    const queue = this.queueManager.getQueue(QueueName.NOTIFICATIONS);
    if (!queue) {
      throw new Error('Notifications queue not found');
    }

    const processor = this.processors.get(QueueName.NOTIFICATIONS);
    const config = QUEUE_CONFIGS.NOTIFICATIONS;

    queue.process(config.concurrency, async (job) => {
      return processor.process(job);
    });

    console.log(`✅ Notification worker started (concurrency: ${config.concurrency})`);
  }

  /**
   * Stop all queue workers
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️ Queue workers not running');
      return;
    }

    console.log('🛑 Stopping queue workers...');

    try {
      // Close all queues (this will stop processing)
      await this.queueManager.close();

      this.processors.clear();
      this.isRunning = false;

      console.log('✅ All queue workers stopped');
    } catch (error) {
      console.error('❌ Error stopping queue workers:', error);
      throw error;
    }
  }

  /**
   * Check if workers are running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get worker statistics
   */
  async getStats(): Promise<any> {
    return this.queueManager.getAllQueueStats();
  }
}

// Singleton instance
let queueWorkerInstance: QueueWorker | null = null;

/**
 * Get Queue Worker singleton instance
 */
export function getQueueWorker(eventEmitter?: EventEmitter): QueueWorker {
  if (!queueWorkerInstance) {
    queueWorkerInstance = new QueueWorker(eventEmitter);
  }
  return queueWorkerInstance;
}

/**
 * Initialize and start Queue Worker
 */
export async function initializeQueueWorker(eventEmitter?: EventEmitter): Promise<QueueWorker> {
  const worker = getQueueWorker(eventEmitter);
  if (!worker.isActive()) {
    await worker.start();
  }
  return worker;
}
