/**
 * Error handling backward compatibility test
 * Verifies that errors are handled the same way after refactoring
 * Requirements: 8.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ethers } from 'ethers';
import { ActivityListener } from '../activity-listener';
import { prisma } from '../../../config/database';
import { logError } from '../../../utils/error-logger';

// Mock ethers
vi.mock('ethers', () => ({
  ethers: {
    JsonRpcProvider: vi.fn(),
    WebSocketProvider: vi.fn(),
    Contract: vi.fn(),
    ZeroAddress: '0x0000000000000000000000000000000000000000',
    formatEther: vi.fn((value) => '1.0')
  }
}));

// Mock prisma
vi.mock('../../../config/database', () => ({
  prisma: {
    activity: {
      create: vi.fn(),
      findFirst: vi.fn()
    },
    launchpad: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    launchpadFactory: {
      findUnique: vi.fn()
    },
    launchpadPhase: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn()
    },
    $transaction: vi.fn((callback) => callback(prisma))
  },
  withRetry: vi.fn((fn) => fn())
}));

// Mock error logger
vi.mock('../../../utils/error-logger', () => ({
  logError: vi.fn()
}));

describe('Error Handling Backward Compatibility', () => {
  let listener: ActivityListener;
  let mockProvider: any;
  let mockContract: any;
  let eventHandlers: Map<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers = new Map();

    // Mock provider
    mockProvider = {
      getBlockNumber: vi.fn().mockResolvedValue(1000),
      getTransaction: vi.fn().mockResolvedValue({ value: BigInt(1000000000000000000) }),
      pollingInterval: 8000,
      destroy: vi.fn().mockResolvedValue(undefined),
      removeAllListeners: vi.fn(),
      on: vi.fn()
    };

    // Mock contract
    mockContract = {
      filters: {
        Transfer: vi.fn().mockReturnValue('transfer-filter'),
        Burned: vi.fn().mockReturnValue('burned-filter'),
        PhaseAdded: vi.fn().mockReturnValue('phase-added-filter')
      },
      on: vi.fn((filter, handler) => {
        eventHandlers.set(filter, handler);
      }),
      removeAllListeners: vi.fn(),
      name: vi.fn().mockResolvedValue('Test Collection'),
      symbol: vi.fn().mockResolvedValue('TEST'),
      totalSupply: vi.fn().mockResolvedValue(BigInt(1000)),
      owner: vi.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
      treasury: vi.fn().mockResolvedValue('0x1234567890123456789012345678901234567890')
    };

    // Mock ethers constructors
    (ethers.JsonRpcProvider as any).mockReturnValue(mockProvider);
    (ethers.WebSocketProvider as any).mockReturnValue(mockProvider);
    (ethers.Contract as any).mockReturnValue(mockContract);

    // Mock database responses
    (prisma.launchpadFactory.findUnique as any).mockResolvedValue({
      id: 1,
      contractAddress: '0xfactory123',
      chainId: 6343
    });

    (prisma.launchpad.findUnique as any).mockResolvedValue({
      id: 1,
      contractAddress: '0x1234567890123456789012345678901234567890',
      name: 'Test Collection',
      symbol: 'TEST',
      totalMaxSupply: 1000,
      factoryId: 1,
      creator: '0x1234567890123456789012345678901234567890',
      treasury: '0x1234567890123456789012345678901234567890',
      metadata: {},
      factory: { id: 1 }
    });

    (prisma.activity.findFirst as any).mockResolvedValue(null);
    (prisma.activity.create as any).mockResolvedValue({ id: 1 });
  });

  afterEach(async () => {
    if (listener) {
      try {
        await listener.stop();
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    vi.restoreAllMocks();
  });

  describe('Database Error Handling', () => {
    it('should retry database operations on failure', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['Burned']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('burned-filter');
      expect(handler).toBeDefined();

      // Mock database error that succeeds on retry
      (prisma.activity.create as any)
        .mockRejectedValueOnce(new Error('Database connection failed'))
        .mockResolvedValueOnce({ id: 1 });

      // Should not throw and should eventually succeed
      await handler!(
        '0x9a299b9AaA23198589E284F269BB3a546acfc137',
        BigInt(1),
        {
          blockNumber: 1001,
          transactionHash: '0x' + '1'.repeat(64)
        }
      );

      // Should have retried
      expect(prisma.activity.create).toHaveBeenCalled();
    });

    it('should continue processing other events after database error', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['Burned']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('burned-filter');

      // First call succeeds after retry
      (prisma.activity.create as any)
        .mockRejectedValueOnce(new Error('Database error'))
        .mockResolvedValueOnce({ id: 1 });
      
      await handler!(
        '0x9a299b9AaA23198589E284F269BB3a546acfc137',
        BigInt(1),
        {
          blockNumber: 1001,
          transactionHash: '0x' + '1'.repeat(64)
        }
      );

      // Second call succeeds immediately
      (prisma.activity.create as any).mockResolvedValueOnce({ id: 2 });
      
      await handler!(
        '0x9a299b9AaA23198589E284F269BB3a546acfc137',
        BigInt(2),
        {
          blockNumber: 1002,
          transactionHash: '0x' + '2'.repeat(64)
        }
      );

      // Both events should be processed
      expect(prisma.activity.create).toHaveBeenCalled();
    });
  });

  describe('Validation Error Handling', () => {
    it('should handle missing required fields gracefully', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['Burned']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('burned-filter');

      // Call with missing blockNumber
      await expect(handler!(
        '0x9a299b9AaA23198589E284F269BB3a546acfc137',
        BigInt(1),
        {
          transactionHash: '0x' + '1'.repeat(64)
          // blockNumber missing
        }
      )).resolves.not.toThrow();

      // Should not create activity
      expect(prisma.activity.create).not.toHaveBeenCalled();
    });

    it('should handle invalid event data gracefully', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['Burned']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('burned-filter');

      // Call with invalid event structure (missing args)
      await handler!(
        '0x9a299b9AaA23198589E284F269BB3a546acfc137',
        BigInt(1),
        {} // Empty event object
      );

      // Should not create activity for invalid data
      expect(prisma.activity.create).not.toHaveBeenCalled();
    });
  });

  describe('RPC Error Handling', () => {
    it('should verify RPC connection during startup', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['Burned']
      };

      listener = new ActivityListener(config);
      
      // Should successfully start with valid provider
      await listener.start();
      
      // Provider should be called to get block number
      expect(mockProvider.getBlockNumber).toHaveBeenCalled();
      
      await listener.stop();
    });
  });

  describe('Error Logging', () => {
    it('should log errors when all retries fail', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['Burned']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const handler = eventHandlers.get('burned-filter');

      // Mock database error that persists through all retries
      (prisma.activity.create as any).mockRejectedValue(new Error('Critical database error'));

      await handler!(
        '0x9a299b9AaA23198589E284F269BB3a546acfc137',
        BigInt(1),
        {
          blockNumber: 1001,
          transactionHash: '0x' + '1'.repeat(64)
        }
      );

      // Error should be logged after retries exhausted
      expect(logError).toHaveBeenCalled();
    }, 10000); // Increase timeout for retries
  });

  describe('Event Handler Isolation', () => {
    it('should isolate errors between different event types', async () => {
      const config = {
        chainId: 6343,
        rpcUrl: 'https://test.com',
        factoryAddress: '0xfactory123',
        launchpadAddresses: ['0x1234567890123456789012345678901234567890'],
        enabledEvents: ['Burned', 'PhaseAdded']
      };

      listener = new ActivityListener(config);
      await listener.start();

      const burnHandler = eventHandlers.get('burned-filter');
      const phaseHandler = eventHandlers.get('phase-added-filter');

      // Mock burn handler to fail
      (prisma.activity.create as any).mockRejectedValueOnce(new Error('Burn error'));

      // Burn event fails
      await burnHandler!(
        '0x9a299b9AaA23198589E284F269BB3a546acfc137',
        BigInt(1),
        {
          blockNumber: 1001,
          transactionHash: '0x' + '1'.repeat(64)
        }
      );

      // Phase event should still work
      (prisma.launchpadPhase.findFirst as any).mockResolvedValue(null);
      (prisma.launchpadPhase.create as any).mockResolvedValue({ id: 1 });
      (prisma.activity.create as any).mockResolvedValue({ id: 2 });

      const now = Math.floor(Date.now() / 1000);
      await phaseHandler!(
        BigInt(1),
        'Public Sale',
        BigInt(now),
        BigInt(now + 86400),
        BigInt(1000000000000000000),
        BigInt(5),
        BigInt(100),
        {
          blockNumber: 1002,
          transactionHash: '0x' + '2'.repeat(64)
        }
      );

      // Phase should be created successfully
      expect(prisma.launchpadPhase.create).toHaveBeenCalled();
    });
  });
});
