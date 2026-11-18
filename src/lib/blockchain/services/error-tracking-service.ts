/**
 * Error tracking and alerting service
 * Manages error counters and admin alerts
 */

import { logError } from '../../../utils/error-logger';
import type { ErrorCounter, ErrorSeverity, ErrorLogData } from '../types/activity-listener-types';

export class ErrorTrackingService {
  private errorCounters: Map<string, ErrorCounter> = new Map();
  private errorThreshold: number;
  private chainId: number;

  constructor(chainId: number, errorThreshold: number = 10) {
    this.chainId = chainId;
    this.errorThreshold = errorThreshold;
  }

  /**
   * Increment error counter and trigger alert if threshold exceeded
   */
  incrementErrorCounter(eventType: string): void {
    const counter = this.errorCounters.get(eventType) || {
      eventType,
      count: 0,
      lastError: new Date(),
      threshold: this.errorThreshold
    };

    counter.count++;
    counter.lastError = new Date();
    this.errorCounters.set(eventType, counter);

    if (counter.count >= counter.threshold) {
      this.sendAdminAlert({
        type: 'EVENT_HANDLER_FAILURE',
        eventType,
        errorCount: counter.count,
        lastError: counter.lastError,
        chainId: this.chainId
      });

      counter.count = 0;
      this.errorCounters.set(eventType, counter);
    }
  }

  /**
   * Send alert to administrators
   */
  private sendAdminAlert(alertData: {
    type: string;
    eventType: string;
    errorCount: number;
    lastError: Date;
    chainId: number;
  }): void {
    console.error('🚨 ADMIN ALERT:', {
      ...alertData,
      message: `Event handler for ${alertData.eventType} has failed ${alertData.errorCount} times on chain ${alertData.chainId}`
    });

    logError(
      `ActivityListener.AdminAlert`,
      new Error(`Event handler failure threshold exceeded for ${alertData.eventType}`),
      alertData,
      'critical'
    );
  }

  /**
   * Log event processing error with full context
   */
  async logEventError(
    eventType: string,
    error: any,
    eventData: any,
    severity: ErrorSeverity = 'medium'
  ): Promise<void> {
    try {
      const errorLogData: ErrorLogData = {
        eventType,
        eventData,
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name
        } : error,
        severity,
        timestamp: new Date(),
        chainId: this.chainId,
        txHash: eventData?.txHash,
        blockNumber: eventData?.blockNumber
      };

      logError(
        `ActivityListener.${eventType}`,
        error,
        errorLogData,
        severity
      );

      this.incrementErrorCounter(eventType);
    } catch (logErr) {
      console.error('Failed to log event error:', logErr);
    }
  }

  getErrorCounters(): Map<string, ErrorCounter> {
    return this.errorCounters;
  }
}
