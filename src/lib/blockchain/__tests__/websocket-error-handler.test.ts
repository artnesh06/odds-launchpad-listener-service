/**
 * Unit tests for WebSocketErrorHandler
 * 
 * Tests the error handling functionality for WebSocket connections
 * and event processing errors.
 * 
 * Requirements: 2.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketErrorHandler, MintEventData } from '../websocket-error-handler';
import { prisma } from '../../../config/database';
import { blockchainWebSocketMetrics } from '../../monitoring/blockchain-websocket-metrics';

// Mock dependencies
vi.mock('../../../config/database', () => ({
  prisma: {
    failedEvent: {
      create: vi.fn()
    }
  }
}));

vi.mock('../../monitoring/blockchain-websocket-metrics', () => ({
  blockchainWebSocketMetrics: {
    incrementWebSocketErrors: vi.fn()
  }
}));

vi.mock('../../../utils/error-logger', () => ({
  logError: vi.fn()
}));

describe('WebSocketErrorHandler', () => {
  let errorHandler: WebSocketErrorHandler;
  let mockWebSocketManager: any;
  let mockAlertService: any;

  beforeEach(() => {
    errorHandler = new WebSocketErrorHandler();
    
    // Create mock WebSocket manager
    mockWebSocketManager = {
      handleReconnection: vi.fn().mockResolvedValue(undefined),
      getConnectionStatus: vi.fn().mockReturnValue({
        isConnected: false,
        launchpadAddress: '0x123',
        reconnectAttempts: 0
      })
    };

    // Create mock alert service
    mockAlertService = {
      sendAlert: vi.fn().mockResolvedValue(undefined)
    };

    errorHandler.setWebSocketManager(mockWebSocketManager);
    errorHandler.setAlertService(mockAlertService);

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('handleConnectionError', () => {
    it('should log error and trigger reconnection', async () => {
      const launchpadAddress = '0x123abc';
      const error = new Error('Connection failed');

      await errorHandler.handleConnectionError(launchpadAddress, error);

      // Verify reconnection was triggered
      expect(mockWebSocketManager.handleReconnection).toHaveBeenCalledWith(launchpadAddress);
      
      // Verify metrics were updated
      expect(blockchainWebSocketMetrics.incrementWebSocketErrors).toHaveBeenCalled();
    });

    it('should send alert when max reconnection attempts exceeded', async () => {
      const launchpadAddress = '0x123abc';
      const error = new Error('Connection failed');

      // Mock connection status with max attempts exceeded
      mockWebSocketManager.getConnectionStatus.mockReturnValue({
        isConnected: false,
        launchpadAddress,
        reconnectAttempts: 10
      });

      await errorHandler.handleConnectionError(launchpadAddress, error);

      // Verify alert was sent
      expect(mockAlertService.sendAlert).toHaveBeenCalledWith({
        type: 'WEBSOCKET_CONNECTION_FAILED',
        launchpadAddress,
        attempts: 10,
        error: 'Connection failed'
      });
    });

    it('should handle reconnection failure gracefully', async () => {
      const launchpadAddress = '0x123abc';
      const error = new Error('Connection failed');
      const reconnectionError = new Error('Reconnection failed');

      mockWebSocketManager.handleReconnection.mockRejectedValue(reconnectionError);

      // Should not throw
      await expect(
        errorHandler.handleConnectionError(launchpadAddress, error)
      ).resolves.not.toThrow();
    });

    it('should handle missing WebSocketManager gracefully', async () => {
      const handler = new WebSocketErrorHandler();
      const launchpadAddress = '0x123abc';
      const error = new Error('Connection failed');

      // Should not throw even without WebSocketManager
      await expect(
        handler.handleConnectionError(launchpadAddress, error)
      ).resolves.not.toThrow();
    });
  });

  describe('handleEventProcessingError', () => {
    it('should store failed event in database', async () => {
      const event: MintEventData = {
        from: '0xabc',
        tokenId: '123',
        transactionHash: '0xtxhash',
        logIndex: 5,
        blockNumber: 1000,
        launchpadAddress: '0x123abc',
        source: 'websocket'
      };
      const error = new Error('Processing failed');

      await errorHandler.handleEventProcessingError(event, error);

      // Verify failed event was stored
      expect(prisma.failedEvent.create).toHaveBeenCalledWith({
        data: {
          transactionHash: event.transactionHash,
          logIndex: event.logIndex,
          launchpadAddress: event.launchpadAddress,
          error: error.message,
          errorStack: error.stack || null,
          eventData: JSON.stringify(event),
          source: event.source,
          blockNumber: event.blockNumber,
          retryCount: 0,
          createdAt: expect.any(Date)
        }
      });

      // Verify metrics were updated
      expect(blockchainWebSocketMetrics.incrementWebSocketErrors).toHaveBeenCalled();
    });

    it('should handle database error gracefully', async () => {
      const event: MintEventData = {
        from: '0xabc',
        tokenId: '123',
        transactionHash: '0xtxhash',
        logIndex: 5,
        blockNumber: 1000,
        launchpadAddress: '0x123abc',
        source: 'polling'
      };
      const error = new Error('Processing failed');
      const dbError = new Error('Database error');

      (prisma.failedEvent.create as any).mockRejectedValue(dbError);

      // Should not throw even if database fails
      await expect(
        errorHandler.handleEventProcessingError(event, error)
      ).resolves.not.toThrow();
    });

    it('should include error stack if available', async () => {
      const event: MintEventData = {
        from: '0xabc',
        tokenId: '123',
        transactionHash: '0xtxhash',
        logIndex: 5,
        blockNumber: 1000,
        launchpadAddress: '0x123abc',
        source: 'websocket'
      };
      const error = new Error('Processing failed');
      error.stack = 'Error stack trace';

      await errorHandler.handleEventProcessingError(event, error);

      expect(prisma.failedEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            errorStack: 'Error stack trace'
          })
        })
      );
    });
  });

  describe('setWebSocketManager', () => {
    it('should set WebSocket manager', () => {
      const handler = new WebSocketErrorHandler();
      const manager = {
        handleReconnection: vi.fn(),
        getConnectionStatus: vi.fn()
      };

      handler.setWebSocketManager(manager);

      // Verify by calling a method that uses the manager
      const error = new Error('Test');
      handler.handleConnectionError('0x123', error);

      expect(manager.handleReconnection).toHaveBeenCalled();
    });
  });

  describe('setAlertService', () => {
    it('should set alert service', async () => {
      const handler = new WebSocketErrorHandler();
      const alertService = {
        sendAlert: vi.fn().mockResolvedValue(undefined)
      };
      const manager = {
        handleReconnection: vi.fn().mockResolvedValue(undefined),
        getConnectionStatus: vi.fn().mockReturnValue({
          isConnected: false,
          launchpadAddress: '0x123',
          reconnectAttempts: 10
        })
      };

      handler.setWebSocketManager(manager);
      handler.setAlertService(alertService);

      const error = new Error('Test');
      await handler.handleConnectionError('0x123', error);

      expect(alertService.sendAlert).toHaveBeenCalled();
    });
  });
});
