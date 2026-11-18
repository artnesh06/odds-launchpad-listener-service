import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { QueueManager, getQueueManager } from '../queue-manager';
import { QueueName } from '../queue-config';

describe('QueueManager', () => {
  let queueManager: QueueManager;

  beforeAll(async () => {
    // Mock Bull Queue implementation
    const mockQueue = {
      add: vi.fn().mockResolvedValue({ id: 'test-job-id' }),
      process: vi.fn(),
      on: vi.fn(),
      getWaitingCount: vi.fn().mockResolvedValue(0),
      getActiveCount: vi.fn().mockResolvedValue(0),
      getCompletedCount: vi.fn().mockResolvedValue(0),
      getFailedCount: vi.fn().mockResolvedValue(0),
      getDelayedCount: vi.fn().mockResolvedValue(0),
      getPausedCount: vi.fn().mockResolvedValue(0),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      clean: vi.fn().mockResolvedValue(undefined),
      getFailed: vi.fn().mockResolvedValue([]),
      getJob: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Mock Redis connection for testing
    vi.mock('bull', () => ({
      default: vi.fn().mockImplementation(() => mockQueue),
    }));

    queueManager = getQueueManager();
    await queueManager.initialize();
  });

  afterAll(async () => {
    await queueManager.close();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      expect(queueManager.isReady()).toBe(true);
    });

    it('should get queue by name', () => {
      const queue = queueManager.getQueue(QueueName.MINT_EVENTS);
      expect(queue).toBeDefined();
    });
  });

  describe('Job Management', () => {
    it('should add mint event job', async () => {
      const job = await queueManager.addMintEventJob({
        chainId: 1,
        launchpadAddress: '0x123',
        from: '0x000',
        to: '0x456',
        tokenId: '1',
        txHash: '0xabc',
        blockNumber: 12345,
        logIndex: 0,
        timestamp: new Date(),
      });

      expect(job).toBeDefined();
      expect(job.id).toBe('test-job-id');
    });

    it('should add NFT metadata job', async () => {
      const job = await queueManager.addNFTMetadataJob({
        chainId: 1,
        contractAddress: '0x123',
        tokenId: '1',
      });

      expect(job).toBeDefined();
    });

    it('should add marketplace event job', async () => {
      const job = await queueManager.addMarketplaceEventJob({
        chainId: 1,
        marketplace: 'opensea',
        eventType: 'sale',
        contractAddress: '0x123',
        tokenId: '1',
        data: {},
        txHash: '0xabc',
        blockNumber: 12345,
        timestamp: new Date(),
      });

      expect(job).toBeDefined();
    });
  });

  describe('Queue Statistics', () => {
    it('should get queue stats', async () => {
      const stats = await queueManager.getQueueStats(QueueName.MINT_EVENTS);

      expect(stats).toHaveProperty('waiting');
      expect(stats).toHaveProperty('active');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
    });

    it('should get all queue stats', async () => {
      const allStats = await queueManager.getAllQueueStats();

      expect(allStats).toHaveProperty(QueueName.MINT_EVENTS);
      expect(allStats).toHaveProperty(QueueName.NFT_METADATA);
    });
  });

  describe('Queue Control', () => {
    it('should pause queue', async () => {
      await expect(queueManager.pauseQueue(QueueName.MINT_EVENTS)).resolves.not.toThrow();
    });

    it('should resume queue', async () => {
      await expect(queueManager.resumeQueue(QueueName.MINT_EVENTS)).resolves.not.toThrow();
    });

    it('should clean queue', async () => {
      await expect(queueManager.cleanQueue(QueueName.MINT_EVENTS)).resolves.not.toThrow();
    });
  });
});
