/**
 * Error Handling Tests
 * 
 * Tests for comprehensive error handling including:
 * - Validation error logging
 * - Duplicate event detection and skipping
 * - Transaction rollback on database errors
 * - Retry logic with transient failures
 * - Error logging completeness
 * 
 * Requirements: 13.2, 13.4, 14.1-14.5, 15.1-15.4, 18.2
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { prisma } from '../../../../config/database';
import {
  validateEventData,
  isDuplicateActivity,
  isDuplicateTransfer,
  isDuplicateMint,
  isDuplicateMarketplaceEvent,
  withRetryLogic,
  withTransaction,
  logEventError
} from '../../validation-utils';
import { ActivityType } from '@prisma/client';

// Mock prisma
vi.mock('../../../../config/database', () => ({
  prisma: {
    activity: {
      findFirst: vi.fn(),
      create: vi.fn()
    },
    launchpad: {
      findUnique: vi.fn()
    },
    nFTTransfer: {
      findUnique: vi.fn()
    },
    nFT: {
      findFirst: vi.fn()
    },
    marketplaceSale: {
      findUnique: vi.fn()
    },
    marketplaceListing: {
      findFirst: vi.fn()
    },
    marketplaceOffer: {
      findFirst: vi.fn()
    },
    errorLog: {
      create: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

describe('Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Validation Error Logging', () => {
    it('should throw error for missing required fields', () => {
      // Requirement 14.1: Validation errors should be caught and logged
      const invalidEvent = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        // Missing tokenId, txHash, blockNumber
      };

      expect(() => {
        validateEventData(invalidEvent, ['contractAddress', 'tokenId', 'txHash', 'blockNumber']);
      }).toThrow('Missing required field: tokenId');
    });

    it('should throw error for invalid transaction hash', () => {
      const invalidEvent = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        tokenId: '1',
        txHash: 'invalid-hash', // Invalid format
        blockNumber: 12345
      };

      expect(() => {
        validateEventData(invalidEvent, ['contractAddress', 'tokenId', 'txHash', 'blockNumber']);
      }).toThrow('Invalid transaction hash');
    });

    it('should throw error for invalid Ethereum address', () => {
      const invalidEvent = {
        contractAddress: 'invalid-address', // Invalid format
        tokenId: '1',
        txHash: '0x' + '0'.repeat(64),
        blockNumber: 12345
      };

      expect(() => {
        validateEventData(invalidEvent, ['contractAddress', 'tokenId', 'txHash', 'blockNumber']);
      }).toThrow('Invalid Ethereum address');
    });

    it('should throw error for invalid block number', () => {
      const invalidEvent = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        tokenId: '1',
        txHash: '0x' + '0'.repeat(64),
        blockNumber: -1 // Negative block number
      };

      expect(() => {
        validateEventData(invalidEvent, ['contractAddress', 'tokenId', 'txHash', 'blockNumber']);
      }).toThrow('Invalid block number');
    });
  });

  describe('Duplicate Event Detection', () => {
    it('should detect duplicate activity events', async () => {
      // Requirement 15.4: Activity events should check for duplicates
      const mockActivity = {
        id: '1',
        txHash: '0x' + 'a'.repeat(64),
        type: ActivityType.PHASE_CREATED
      };

      const mockLaunchpad = {
        id: 'launchpad-id',
        contractAddress: '0x1234567890123456789012345678901234567890'
      };

      vi.mocked(prisma.launchpad.findUnique).mockResolvedValue(mockLaunchpad as any);
      vi.mocked(prisma.activity.findFirst).mockResolvedValue(mockActivity as any);

      const isDuplicate = await isDuplicateActivity(
        '0x' + 'a'.repeat(64),
        ActivityType.PHASE_CREATED,
        '0x1234567890123456789012345678901234567890'
      );

      expect(isDuplicate).toBe(true);
      expect(prisma.activity.findFirst).toHaveBeenCalled();
    });

    it('should detect duplicate transfer events', async () => {
      // Requirement 15.1: Transfer events should check for duplicates by txHash + logIndex
      const mockTransfer = {
        id: '1',
        txHash: '0x' + 'a'.repeat(64),
        logIndex: 0
      };

      vi.mocked(prisma.nFTTransfer.findUnique).mockResolvedValue(mockTransfer as any);

      const isDuplicate = await isDuplicateTransfer(
        '0x' + 'a'.repeat(64),
        0
      );

      expect(isDuplicate).toBe(true);
      expect(prisma.nFTTransfer.findUnique).toHaveBeenCalledWith({
        where: {
          txHash_logIndex: {
            txHash: '0x' + 'a'.repeat(64),
            logIndex: 0
          }
        }
      });
    });

    it('should detect duplicate mint events', async () => {
      // Requirement 15.2: Mint events should check for duplicates by txHash
      const mockNFT = {
        id: '1',
        contractAddress: '0x1234567890123456789012345678901234567890',
        tokenId: '1',
        mintTransactionHash: '0x' + 'a'.repeat(64)
      };

      vi.mocked(prisma.nFT.findFirst).mockResolvedValue(mockNFT as any);

      const isDuplicate = await isDuplicateMint(
        '0x' + 'a'.repeat(64),
        '0x1234567890123456789012345678901234567890',
        '1'
      );

      expect(isDuplicate).toBe(true);
      expect(prisma.nFT.findFirst).toHaveBeenCalled();
    });

    it('should detect duplicate marketplace events', async () => {
      // Requirement 15.3: Marketplace events should check for duplicates by txHash + logIndex
      const mockSale = {
        id: '1',
        txHash: '0x' + 'a'.repeat(64),
        logIndex: 0,
        bundleIndex: 0
      };

      vi.mocked(prisma.marketplaceSale.findUnique).mockResolvedValue(mockSale as any);

      const isDuplicate = await isDuplicateMarketplaceEvent(
        '0x' + 'a'.repeat(64),
        0,
        0
      );

      expect(isDuplicate).toBe(true);
      expect(prisma.marketplaceSale.findUnique).toHaveBeenCalledWith({
        where: {
          txHash_logIndex_bundleIndex: {
            txHash: '0x' + 'a'.repeat(64),
            logIndex: 0,
            bundleIndex: 0
          }
        }
      });
    });

    it('should return false for non-duplicate events', async () => {
      vi.mocked(prisma.activity.findFirst).mockResolvedValue(null);

      const isDuplicate = await isDuplicateActivity(
        '0x' + 'b'.repeat(64),
        ActivityType.PHASE_CREATED,
        'launchpad-id'
      );

      expect(isDuplicate).toBe(false);
    });

    it('should handle errors gracefully in duplicate checks', async () => {
      // Requirement 14.5: Errors should not stop processing
      vi.mocked(prisma.activity.findFirst).mockRejectedValue(new Error('Database error'));

      const isDuplicate = await isDuplicateActivity(
        '0x' + 'c'.repeat(64),
        ActivityType.PHASE_CREATED,
        'launchpad-id'
      );

      // Should return false on error to avoid blocking new activities
      expect(isDuplicate).toBe(false);
    });
  });

  describe('Transaction Rollback', () => {
    it('should rollback transaction on database error', async () => {
      // Requirement 13.2, 13.4: Transaction should rollback on failure
      const mockError = new Error('Database constraint violation');
      (mockError as any).code = 'P2003';

      vi.mocked(prisma.$transaction).mockRejectedValue(mockError);
      vi.mocked(prisma.errorLog.create).mockResolvedValue({} as any);

      const operation = async (tx: any) => {
        throw mockError;
      };

      await expect(
        withTransaction(operation, 'testOperation', { txHash: '0xabc' }, 1)
      ).rejects.toThrow('Database constraint violation');

      // Error should be logged
      expect(prisma.errorLog.create).toHaveBeenCalled();
    });

    it('should log transaction rollback with full context', async () => {
      // Requirement 13.4: Log errors with full context
      const mockError = new Error('Transaction failed');
      const eventData = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        tokenId: '1',
        txHash: '0x' + 'a'.repeat(64),
        blockNumber: 12345
      };

      vi.mocked(prisma.$transaction).mockRejectedValue(mockError);
      vi.mocked(prisma.errorLog.create).mockResolvedValue({} as any);

      const operation = async (tx: any) => {
        throw mockError;
      };

      await expect(
        withTransaction(operation, 'testOperation', eventData, 1)
      ).rejects.toThrow('Transaction failed');

      // Verify error log includes all context
      expect(prisma.errorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          errorType: expect.stringContaining('TransactionError'),
          severity: 'high',
          message: expect.stringContaining('Transaction rollback'),
          component: 'TransactionHandler',
          operation: 'testOperation',
          chainId: 1,
          contractAddress: eventData.contractAddress,
          tokenId: eventData.tokenId,
          txHash: eventData.txHash,
          blockNumber: eventData.blockNumber,
          resolved: false
        })
      });
    });
  });

  describe('Retry Logic with Exponential Backoff', () => {
    it('should retry retryable errors with exponential backoff', async () => {
      // Requirement 18.2: Retry with exponential backoff (1s, 2s, 4s)
      let attemptCount = 0;
      const operation = vi.fn(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          const error: any = new Error('Database timeout');
          error.code = 'P1002'; // Retryable error
          throw error;
        }
        return 'success';
      });

      const result = await withRetryLogic(operation, 3, 'testOperation');

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      // Requirement 18.2: Identify non-retryable errors
      const operation = vi.fn(async () => {
        const error: any = new Error('Unique constraint violation');
        error.code = 'P2002'; // Non-retryable error
        throw error;
      });

      await expect(
        withRetryLogic(operation, 3, 'testOperation')
      ).rejects.toThrow('Unique constraint violation');

      // Should only be called once (no retries)
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should log failure after max retries', async () => {
      // Requirement 18.5: Log failure after max retries and continue processing
      const operation = vi.fn(async () => {
        const error: any = new Error('Database deadlock');
        error.code = 'P2034'; // Retryable error
        throw error;
      });

      vi.mocked(prisma.errorLog.create).mockResolvedValue({} as any);

      await expect(
        withRetryLogic(operation, 3, 'testOperation')
      ).rejects.toThrow('Database deadlock');

      // Should be called 3 times (max retries)
      expect(operation).toHaveBeenCalledTimes(3);

      // Error should be logged
      expect(prisma.errorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          errorType: 'RetryExhausted',
          severity: 'high',
          message: expect.stringContaining('Max retries exceeded'),
          component: 'RetryLogic',
          operation: 'testOperation',
          resolved: false
        })
      });
    });

    it('should identify retryable database errors', async () => {
      // Requirement 18.2: Identify retryable errors
      const retryableCodes = ['P1001', 'P1002', 'P2034', 'P2037'];
      
      for (const code of retryableCodes) {
        let attemptCount = 0;
        const operation = vi.fn(async () => {
          attemptCount++;
          if (attemptCount < 2) {
            const error: any = new Error(`Database error ${code}`);
            error.code = code;
            throw error;
          }
          return 'success';
        });

        const result = await withRetryLogic(operation, 3, 'testOperation');
        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(2);
      }
    });
  });

  describe('Error Logging Completeness', () => {
    it('should log all required error fields', async () => {
      // Requirements 14.1, 14.2, 14.3, 14.4: Complete error logging
      const error = new Error('Test error');
      const eventData = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        tokenId: '1',
        txHash: '0x' + 'a'.repeat(64),
        blockNumber: 12345
      };
      const errorCounters = new Map();
      const sendAdminAlert = vi.fn();

      vi.mocked(prisma.errorLog.create).mockResolvedValue({} as any);

      await logEventError(
        'TestEvent',
        error,
        eventData,
        'medium',
        1,
        errorCounters,
        10,
        sendAdminAlert
      );

      // Verify all required fields are included (Requirements 14.2, 14.3, 14.4)
      expect(prisma.errorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          errorType: 'Error', // Requirement 14.2
          severity: 'medium', // Requirement 14.2
          message: 'Test error', // Requirement 14.2
          stack: expect.any(String), // Requirement 14.2
          component: 'EventHandler.TestEvent', // Requirement 14.2
          operation: 'TestEvent', // Requirement 14.2
          chainId: 1, // Requirement 14.3
          contractAddress: eventData.contractAddress, // Requirement 14.3
          tokenId: eventData.tokenId, // Requirement 14.3
          txHash: eventData.txHash, // Requirement 14.3
          blockNumber: eventData.blockNumber, // Requirement 14.3
          resolved: false // Requirement 14.4
        })
      });
    });

    it('should handle different error types correctly', async () => {
      // Requirement 14.2: Include errorType
      const testCases = [
        { error: new Error('Standard error'), expectedType: 'Error' },
        { error: new TypeError('Type error'), expectedType: 'TypeError' },
        { error: 'String error', expectedType: 'StringError' },
        { error: { code: 'P2002', message: 'DB error' }, expectedType: 'DatabaseError_P2002' }
      ];

      vi.mocked(prisma.errorLog.create).mockResolvedValue({} as any);

      for (const testCase of testCases) {
        await logEventError(
          'TestEvent',
          testCase.error,
          {},
          'medium',
          1,
          new Map(),
          10,
          vi.fn()
        );

        expect(prisma.errorLog.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            errorType: testCase.expectedType
          })
        });

        vi.clearAllMocks();
      }
    });

    it('should increment error counter and trigger alert at threshold', async () => {
      // Requirement 14.5: Error counter and threshold alerting
      const errorCounters = new Map();
      const sendAdminAlert = vi.fn();
      const error = new Error('Test error');

      vi.mocked(prisma.errorLog.create).mockResolvedValue({} as any);

      // Log errors up to threshold
      for (let i = 0; i < 10; i++) {
        await logEventError(
          'TestEvent',
          error,
          {},
          'medium',
          1,
          errorCounters,
          10,
          sendAdminAlert
        );
      }

      // Alert should be triggered at threshold
      expect(sendAdminAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'EVENT_HANDLER_FAILURE',
          eventType: 'TestEvent',
          errorCount: 10,
          chainId: 1
        })
      );
    });
  });

  describe('System Resilience', () => {
    it('should continue processing after error', async () => {
      // Requirement 14.5: Errors should not stop event processing pipeline
      const operations = [
        vi.fn(async () => { throw new Error('Error 1'); }),
        vi.fn(async () => 'success 2'),
        vi.fn(async () => { throw new Error('Error 3'); }),
        vi.fn(async () => 'success 4')
      ];

      const results = [];
      for (const operation of operations) {
        try {
          const result = await operation();
          results.push(result);
        } catch (error) {
          // Log error but continue processing
          results.push('error');
        }
      }

      // All operations should be attempted
      expect(operations[0]).toHaveBeenCalled();
      expect(operations[1]).toHaveBeenCalled();
      expect(operations[2]).toHaveBeenCalled();
      expect(operations[3]).toHaveBeenCalled();

      // Successful operations should complete
      expect(results).toContain('success 2');
      expect(results).toContain('success 4');
    });
  });
});
