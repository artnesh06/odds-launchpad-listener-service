/**
 * WebSocketErrorHandler - Handles errors for blockchain WebSocket connections
 * 
 * This class provides error handling for WebSocket connections to blockchain
 * contracts, including connection errors and event processing errors.
 * 
 * Features:
 * - Handles connection errors with reconnection triggering
 * - Handles event processing errors with failed event storage
 * - Logs errors with context for debugging
 * - Sends alerts for critical failures
 * 
 * Requirements: 2.5
 */

import { prisma } from '../../config/database';
import { logError } from '../../utils/error-logger';
import { blockchainWebSocketMetrics } from '../monitoring/blockchain-websocket-metrics';

/**
 * Mint event data structure
 */
export interface MintEventData {
  from: string;
  tokenId: string;
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
  launchpadAddress: string;
  source: 'websocket' | 'polling';
}

/**
 * Alert service interface for sending critical alerts
 */
interface AlertService {
  sendAlert(alert: {
    type: string;
    launchpadAddress: string;
    attempts?: number;
    error?: string;
  }): Promise<void>;
}

/**
 * WebSocketManager interface for reconnection handling
 */
interface WebSocketManagerInterface {
  handleReconnection(launchpadAddress: string): Promise<void>;
  getConnectionStatus(launchpadAddress: string): {
    isConnected: boolean;
    launchpadAddress: string;
    connectedAt?: Date;
    lastError?: Error;
    reconnectAttempts: number;
  };
}

/**
 * Configuration for max reconnection attempts
 */
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * WebSocketErrorHandler class
 */
export class WebSocketErrorHandler {
  private webSocketManager: WebSocketManagerInterface | null = null;
  private alertService: AlertService | null = null;

  /**
   * Set the WebSocket manager for reconnection handling
   * 
   * @param manager - WebSocket manager instance
   */
  setWebSocketManager(manager: WebSocketManagerInterface): void {
    this.webSocketManager = manager;
  }

  /**
   * Set the alert service for critical alerts
   * 
   * @param service - Alert service instance
   */
  setAlertService(service: AlertService): void {
    this.alertService = service;
  }

  /**
   * Handle WebSocket connection error
   * 
   * Logs the error with context, updates connection status, triggers reconnection,
   * and sends alerts if max reconnection attempts are exceeded.
   * 
   * @param launchpadAddress - Address of the launchpad contract
   * @param error - Error that occurred
   * @returns Promise that resolves when error is handled
   * 
   * Requirements: 2.5
   */
  async handleConnectionError(
    launchpadAddress: string,
    error: Error
  ): Promise<void> {
    // 1. Log error with context
    console.error('[WebSocketErrorHandler] Connection error:', {
      launchpadAddress,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Log to centralized error logger
    logError(
      'WebSocketErrorHandler',
      error,
      {
        launchpadAddress,
        errorType: 'connection_error',
        timestamp: new Date().toISOString()
      },
      'high'
    );

    // Increment error metrics
    blockchainWebSocketMetrics.incrementWebSocketErrors();

    // 2. Update connection status (handled by WebSocketManager internally)
    // The connection status will be updated when reconnection is attempted

    // 3. Trigger reconnection
    if (this.webSocketManager) {
      try {
        await this.webSocketManager.handleReconnection(launchpadAddress);
      } catch (reconnectionError) {
        console.error('[WebSocketErrorHandler] Reconnection failed:', reconnectionError);
        
        logError(
          'WebSocketErrorHandler',
          reconnectionError as Error,
          {
            launchpadAddress,
            errorType: 'reconnection_failed',
            timestamp: new Date().toISOString()
          },
          'critical'
        );
      }

      // 4. Alert if max reconnection attempts exceeded
      const status = this.webSocketManager.getConnectionStatus(launchpadAddress);
      if (status && status.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(
          `[WebSocketErrorHandler] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) exceeded for ${launchpadAddress}`
        );

        if (this.alertService) {
          await this.alertService.sendAlert({
            type: 'WEBSOCKET_CONNECTION_FAILED',
            launchpadAddress,
            attempts: status.reconnectAttempts,
            error: error.message
          });
        }
      }
    } else {
      console.warn('[WebSocketErrorHandler] WebSocketManager not set, cannot trigger reconnection');
    }
  }

  /**
   * Handle event processing error
   * 
   * Logs the error with event context, stores the failed event for retry,
   * and does not mark the event as processed to allow retry.
   * 
   * @param event - Mint event data that failed to process
   * @param error - Error that occurred during processing
   * @returns Promise that resolves when error is handled
   * 
   * Requirements: 2.5
   */
  async handleEventProcessingError(
    event: MintEventData,
    error: Error
  ): Promise<void> {
    // 1. Log error with event context
    console.error('[WebSocketErrorHandler] Event processing error:', {
      transactionHash: event.transactionHash,
      launchpadAddress: event.launchpadAddress,
      source: event.source,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });

    // Log to centralized error logger
    logError(
      'WebSocketErrorHandler',
      error,
      {
        transactionHash: event.transactionHash,
        launchpadAddress: event.launchpadAddress,
        source: event.source,
        errorType: 'event_processing_error',
        timestamp: new Date().toISOString()
      },
      'high'
    );

    // Increment error metrics
    blockchainWebSocketMetrics.incrementWebSocketErrors();

    // 2. Store failed event for retry
    try {
      await prisma.failedEvent.create({
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
          createdAt: new Date()
        }
      });

      console.log(
        `[WebSocketErrorHandler] Failed event stored for retry: ${event.transactionHash}-${event.logIndex}`
      );
    } catch (dbError) {
      console.error('[WebSocketErrorHandler] Failed to store failed event:', dbError);
      
      logError(
        'WebSocketErrorHandler',
        dbError as Error,
        {
          transactionHash: event.transactionHash,
          launchpadAddress: event.launchpadAddress,
          errorType: 'failed_event_storage_error',
          timestamp: new Date().toISOString()
        },
        'critical'
      );
    }

    // 3. Don't mark as processed (allow retry)
    // Event will be reprocessed on next poll or reconnection
    console.log(
      `[WebSocketErrorHandler] Event ${event.transactionHash}-${event.logIndex} not marked as processed, will retry`
    );
  }
}

/**
 * Singleton instance of WebSocketErrorHandler
 */
export const webSocketErrorHandler = new WebSocketErrorHandler();
