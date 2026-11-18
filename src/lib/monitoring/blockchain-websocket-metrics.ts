/**
 * Blockchain WebSocket Metrics Collector
 * 
 * This module provides metrics collection for monitoring WebSocket connections
 * and event processing for featured launchpads.
 * 
 * Metrics tracked:
 * - Active WebSocket connections count
 * - Mint events received via WebSocket
 * - Mint events received via polling
 * - WebSocket reconnection attempts
 * - WebSocket errors
 * 
 * Requirements: 8.4, 8.5
 */

/**
 * Metrics data structure
 */
export interface BlockchainWebSocketMetrics {
  activeWebSocketConnections: number;
  mintEventsWebSocket: number;
  mintEventsPolling: number;
  websocketReconnectionAttempts: number;
  websocketErrors: number;
  lastUpdated: Date;
}

/**
 * Metrics collector class
 */
class BlockchainWebSocketMetricsCollector {
  private metrics: BlockchainWebSocketMetrics;

  constructor() {
    this.metrics = {
      activeWebSocketConnections: 0,
      mintEventsWebSocket: 0,
      mintEventsPolling: 0,
      websocketReconnectionAttempts: 0,
      websocketErrors: 0,
      lastUpdated: new Date()
    };
  }

  /**
   * Set the number of active WebSocket connections
   * 
   * @param count - Number of active connections
   * 
   * Requirement 8.4: Expose metrics for active WebSocket connections count
   */
  setActiveConnections(count: number): void {
    this.metrics.activeWebSocketConnections = count;
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Increment the counter for mint events received via WebSocket
   * 
   * Requirement 8.5: Expose metrics for mint events received via WebSocket vs polling
   */
  incrementMintEventsWebSocket(): void {
    this.metrics.mintEventsWebSocket++;
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Increment the counter for mint events received via polling
   * 
   * Requirement 8.5: Expose metrics for mint events received via WebSocket vs polling
   */
  incrementMintEventsPolling(): void {
    this.metrics.mintEventsPolling++;
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Increment the counter for WebSocket reconnection attempts
   */
  incrementReconnectionAttempts(): void {
    this.metrics.websocketReconnectionAttempts++;
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Increment the counter for WebSocket errors
   */
  incrementWebSocketErrors(): void {
    this.metrics.websocketErrors++;
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Get current metrics snapshot
   * 
   * @returns Current metrics data
   */
  getMetrics(): BlockchainWebSocketMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset all metrics to zero
   * Useful for testing or periodic resets
   */
  reset(): void {
    this.metrics = {
      activeWebSocketConnections: 0,
      mintEventsWebSocket: 0,
      mintEventsPolling: 0,
      websocketReconnectionAttempts: 0,
      websocketErrors: 0,
      lastUpdated: new Date()
    };
  }

  /**
   * Get metrics in a formatted string for logging
   * 
   * @returns Formatted metrics string
   */
  getFormattedMetrics(): string {
    return `
Blockchain WebSocket Metrics:
  Active Connections: ${this.metrics.activeWebSocketConnections}
  Mint Events (WebSocket): ${this.metrics.mintEventsWebSocket}
  Mint Events (Polling): ${this.metrics.mintEventsPolling}
  Reconnection Attempts: ${this.metrics.websocketReconnectionAttempts}
  WebSocket Errors: ${this.metrics.websocketErrors}
  Last Updated: ${this.metrics.lastUpdated.toISOString()}
    `.trim();
  }
}

// Export singleton instance
export const blockchainWebSocketMetrics = new BlockchainWebSocketMetricsCollector();

