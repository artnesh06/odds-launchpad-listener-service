/**
 * Integration tests for EventProcessor wiring to ActivityListener
 * 
 * Tests that EventProcessor correctly routes mint events to the existing
 * mint event handler with proper data format conversion.
 * 
 * Task 8.3: Wire EventProcessor to existing mint event handler
 * Requirements: 6.1, 6.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventProcessor, MintEventData } from '../event-processor';
import { ethers } from 'ethers';

describe('EventProcessor Integration - Task 8.3', () => {
  let processor: EventProcessor;
  let mockHandler: ReturnType<typeof vi.fn>;
  let processedEvents: Set<string>;

  beforeEach(() => {
    // Create a mock handler
    mockHandler = vi.fn().mockResolvedValue(undefined);
    
    // Create processor with mock handler (skip database operations for these tests)
    processor = new EventProcessor(mockHandler);
    
    // Track processed events for duplicate detection
    processedEvents = new Set<string>();
    
    // Mock the database methods to avoid actual DB calls
    // Use a proper implementation that tracks duplicates
    vi.spyOn(processor as any, 'isEventProcessed').mockImplementation(async (txHash: string, logIndex: number) => {
      const eventId = `${txHash}-${logIndex}`;
      return processedEvents.has(eventId);
    });
    
    vi.spyOn(processor as any, 'markEventProcessed').mockImplementation(async (txHash: string, logIndex: number) => {
      const eventId = `${txHash}-${logIndex}`;
      processedEvents.add(eventId);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('Wiring to existing mint event handler', () => {
    it('should call the handler when processing mint events', async () => {
      const event: MintEventData = {
        from: '0xrecipient123',
        tokenId: '42',
        transactionHash: '0xtxhash123',
        logIndex: 0,
        blockNumber: 12345,
        launchpadAddress: '0xlaunchpad123',
        source: 'websocket'
      };

      await processor.processMintEvent(event);

      // Verify handler was called
      expect(mockHandler).toHaveBeenCalledTimes(1);
      expect(mockHandler).toHaveBeenCalledWith(event);
    });

    it('should pass correct event data format to handler', async () => {
      const event: MintEventData = {
        from: '0xuser456',
        tokenId: '100',
        transactionHash: '0xtxhash456',
        logIndex: 2,
        blockNumber: 67890,
        launchpadAddress: '0xlaunchpad456',
        source: 'polling'
      };

      await processor.processMintEvent(event);

      // Verify the exact data format passed to handler
      const calledWith = mockHandler.mock.calls[0][0];
      expect(calledWith).toEqual({
        from: '0xuser456',
        tokenId: '100',
        transactionHash: '0xtxhash456',
        logIndex: 2,
        blockNumber: 67890,
        launchpadAddress: '0xlaunchpad456',
        source: 'polling'
      });
    });

    it('should handle events from both websocket and polling sources', async () => {
      const wsEvent: MintEventData = {
        from: '0xuser1',
        tokenId: '1',
        transactionHash: '0xtx1',
        logIndex: 0,
        blockNumber: 100,
        launchpadAddress: '0xlaunchpad1',
        source: 'websocket'
      };

      const pollEvent: MintEventData = {
        from: '0xuser2',
        tokenId: '2',
        transactionHash: '0xtx2',
        logIndex: 0,
        blockNumber: 101,
        launchpadAddress: '0xlaunchpad2',
        source: 'polling'
      };

      await processor.processMintEvent(wsEvent);
      await processor.processMintEvent(pollEvent);

      // Both should call the handler
      expect(mockHandler).toHaveBeenCalledTimes(2);
      expect(mockHandler).toHaveBeenNthCalledWith(1, wsEvent);
      expect(mockHandler).toHaveBeenNthCalledWith(2, pollEvent);
    });

    it('should not call handler for duplicate events', async () => {
      const event: MintEventData = {
        from: '0xuser',
        tokenId: '5',
        transactionHash: '0xtxdup',
        logIndex: 0,
        blockNumber: 200,
        launchpadAddress: '0xlaunchpad',
        source: 'websocket'
      };

      // Process first time
      await processor.processMintEvent(event);
      
      // Process duplicate
      await processor.processMintEvent(event);

      // Handler should only be called once
      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should propagate handler errors', async () => {
      const handlerError = new Error('Handler processing failed');
      mockHandler.mockRejectedValueOnce(handlerError);

      const event: MintEventData = {
        from: '0xuser',
        tokenId: '10',
        transactionHash: '0xtxerror',
        logIndex: 0,
        blockNumber: 300,
        launchpadAddress: '0xlaunchpad',
        source: 'websocket'
      };

      // Should throw the handler error
      await expect(processor.processMintEvent(event)).rejects.toThrow('Handler processing failed');
    });

    it('should handle events with large token IDs', async () => {
      const event: MintEventData = {
        from: '0xuser',
        tokenId: '999999999999999999',
        transactionHash: '0xtxlarge',
        logIndex: 0,
        blockNumber: 400,
        launchpadAddress: '0xlaunchpad',
        source: 'websocket'
      };

      await processor.processMintEvent(event);

      expect(mockHandler).toHaveBeenCalledWith(event);
      expect(mockHandler.mock.calls[0][0].tokenId).toBe('999999999999999999');
    });

    it('should handle events with high log index', async () => {
      const event: MintEventData = {
        from: '0xuser',
        tokenId: '1',
        transactionHash: '0xtxhighlog',
        logIndex: 999,
        blockNumber: 500,
        launchpadAddress: '0xlaunchpad',
        source: 'polling'
      };

      await processor.processMintEvent(event);

      expect(mockHandler).toHaveBeenCalledWith(event);
      expect(mockHandler.mock.calls[0][0].logIndex).toBe(999);
    });
  });

  describe('Handler configuration', () => {
    it('should allow setting handler after construction', async () => {
      const newProcessor = new EventProcessor();
      const newHandler = vi.fn().mockResolvedValue(undefined);

      // Set handler after construction
      newProcessor.setMintEventHandler(newHandler);

      const event: MintEventData = {
        from: '0xuser',
        tokenId: '1',
        transactionHash: '0xtx',
        logIndex: 0,
        blockNumber: 100,
        launchpadAddress: '0xlaunchpad',
        source: 'websocket'
      };

      await newProcessor.processMintEvent(event);

      expect(newHandler).toHaveBeenCalledTimes(1);
    });

    it('should warn when no handler is configured', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const newProcessor = new EventProcessor();

      const event: MintEventData = {
        from: '0xuser',
        tokenId: '1',
        transactionHash: '0xtxnohandler',
        logIndex: 0,
        blockNumber: 100,
        launchpadAddress: '0xlaunchpad',
        source: 'websocket'
      };

      await newProcessor.processMintEvent(event);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No mint event handler configured')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Data format compatibility', () => {
    it('should maintain all required fields for handler', async () => {
      const event: MintEventData = {
        from: '0xrecipient',
        tokenId: '123',
        transactionHash: '0xtxhash',
        logIndex: 5,
        blockNumber: 1000,
        launchpadAddress: '0xlaunchpad',
        source: 'websocket'
      };

      await processor.processMintEvent(event);

      const calledWith = mockHandler.mock.calls[0][0];
      
      // Verify all required fields are present
      expect(calledWith).toHaveProperty('from');
      expect(calledWith).toHaveProperty('tokenId');
      expect(calledWith).toHaveProperty('transactionHash');
      expect(calledWith).toHaveProperty('logIndex');
      expect(calledWith).toHaveProperty('blockNumber');
      expect(calledWith).toHaveProperty('launchpadAddress');
      expect(calledWith).toHaveProperty('source');
    });

    it('should preserve field types', async () => {
      const event: MintEventData = {
        from: '0xrecipient',
        tokenId: '456',
        transactionHash: '0xtxhash',
        logIndex: 10,
        blockNumber: 2000,
        launchpadAddress: '0xlaunchpad',
        source: 'polling'
      };

      await processor.processMintEvent(event);

      const calledWith = mockHandler.mock.calls[0][0];
      
      // Verify field types
      expect(typeof calledWith.from).toBe('string');
      expect(typeof calledWith.tokenId).toBe('string');
      expect(typeof calledWith.transactionHash).toBe('string');
      expect(typeof calledWith.logIndex).toBe('number');
      expect(typeof calledWith.blockNumber).toBe('number');
      expect(typeof calledWith.launchpadAddress).toBe('string');
      expect(typeof calledWith.source).toBe('string');
    });

    it('should handle checksum addresses correctly', async () => {
      const checksumAddress = ethers.getAddress('0xabcdef1234567890abcdef1234567890abcdef12');
      
      const event: MintEventData = {
        from: checksumAddress,
        tokenId: '1',
        transactionHash: '0xtxhash',
        logIndex: 0,
        blockNumber: 100,
        launchpadAddress: checksumAddress,
        source: 'websocket'
      };

      await processor.processMintEvent(event);

      const calledWith = mockHandler.mock.calls[0][0];
      expect(calledWith.from).toBe(checksumAddress);
      expect(calledWith.launchpadAddress).toBe(checksumAddress);
    });
  });
});
