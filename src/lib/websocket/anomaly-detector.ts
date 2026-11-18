/**
 * Anomaly Detector
 * 
 * Detects anomalies in WebSocket operations including:
 * - Memory leaks
 * - Connection spikes
 * - Unusual message patterns
 * - Resource exhaustion
 * 
 * Implements warning emission and corrective actions.
 */

import { errorLogger, ErrorSeverity } from './error-logger';

/**
 * Anomaly types that can be detected
 */
export enum AnomalyType {
  MEMORY_LEAK = 'memory_leak',
  CONNECTION_SPIKE = 'connection_spike',
  HIGH_ERROR_RATE = 'high_error_rate',
  MESSAGE_FLOOD = 'message_flood',
  RESOURCE_EXHAUSTION = 'resource_exhaustion',
  STALE_CONNECTIONS = 'stale_connections',
}

/**
 * Anomaly severity levels
 */
export enum AnomalySeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Detected anomaly with context
 */
export interface DetectedAnomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  timestamp: Date;
  message: string;
  metrics: Record<string, any>;
  suggestedActions: string[];
}

/**
 * Anomaly detection thresholds
 */
export interface AnomalyThresholds {
  // Memory thresholds
  memoryWarningThreshold: number; // Percentage (e.g., 80)
  memoryCriticalThreshold: number; // Percentage (e.g., 90)
  memoryGrowthRate: number; // MB per minute
  
  // Connection thresholds
  connectionSpikeThreshold: number; // Connections per minute
  maxConnectionsWarning: number; // Percentage of max (e.g., 80)
  
  // Error rate thresholds
  errorRateWarning: number; // Errors per minute
  errorRateCritical: number; // Errors per minute
  
  // Message thresholds
  messageFloodThreshold: number; // Messages per second per connection
  
  // Stale connection threshold
  staleConnectionTimeout: number; // Minutes of inactivity
}

/**
 * Corrective action types
 */
export enum CorrectiveAction {
  CLEANUP_STALE_CONNECTIONS = 'cleanup_stale_connections',
  FORCE_GARBAGE_COLLECTION = 'force_garbage_collection',
  THROTTLE_CONNECTIONS = 'throttle_connections',
  THROTTLE_MESSAGES = 'throttle_messages',
  CLOSE_IDLE_CONNECTIONS = 'close_idle_connections',
  CLEAR_MESSAGE_HISTORY = 'clear_message_history',
  EMIT_WARNING = 'emit_warning',
}

/**
 * Anomaly Detector class
 */
export class AnomalyDetector {
  private thresholds: AnomalyThresholds;
  private detectedAnomalies: DetectedAnomaly[] = [];
  private maxAnomalyHistory: number = 100;
  
  // Memory tracking
  private memoryHistory: Array<{ timestamp: Date; usage: number }> = [];
  private maxMemoryHistorySize: number = 60; // Keep 60 samples
  
  // Connection tracking
  private connectionHistory: Array<{ timestamp: Date; count: number }> = [];
  private maxConnectionHistorySize: number = 60; // Keep 60 samples
  
  // Error tracking
  private errorHistory: Array<{ timestamp: Date; count: number }> = [];
  private maxErrorHistorySize: number = 60; // Keep 60 samples
  
  // Last check timestamp
  private lastCheckTime: Date | null = null;

  constructor(thresholds?: Partial<AnomalyThresholds>) {
    this.thresholds = {
      // Default thresholds
      memoryWarningThreshold: 80, // 80% of heap limit
      memoryCriticalThreshold: 90, // 90% of heap limit
      memoryGrowthRate: 50, // 50MB per minute
      connectionSpikeThreshold: 100, // 100 connections per minute
      maxConnectionsWarning: 80, // 80% of max connections
      errorRateWarning: 10, // 10 errors per minute
      errorRateCritical: 50, // 50 errors per minute
      messageFloodThreshold: 100, // 100 messages per second per connection
      staleConnectionTimeout: 30, // 30 minutes of inactivity
      ...thresholds,
    };
  }

  /**
   * Check for anomalies in the system
   */
  checkForAnomalies(metrics: {
    memoryUsage: number;
    connectionCount: number;
    maxConnections: number;
    errorCount: number;
    messageRate: number;
    connections: Array<{ socketId: string; lastActivity: Date }>;
  }): DetectedAnomaly[] {
    const now = new Date();
    const anomalies: DetectedAnomaly[] = [];

    // Update tracking history
    this.updateMemoryHistory(metrics.memoryUsage, now);
    this.updateConnectionHistory(metrics.connectionCount, now);
    this.updateErrorHistory(metrics.errorCount, now);

    // Check for memory anomalies
    const memoryAnomalies = this.checkMemoryAnomalies(
      metrics.memoryUsage,
      metrics.maxConnections
    );
    anomalies.push(...memoryAnomalies);

    // Check for connection anomalies
    const connectionAnomalies = this.checkConnectionAnomalies(
      metrics.connectionCount,
      metrics.maxConnections
    );
    anomalies.push(...connectionAnomalies);

    // Check for error rate anomalies
    const errorAnomalies = this.checkErrorRateAnomalies();
    anomalies.push(...errorAnomalies);

    // Check for stale connections
    const staleConnectionAnomalies = this.checkStaleConnections(metrics.connections);
    anomalies.push(...staleConnectionAnomalies);

    // Store detected anomalies
    for (const anomaly of anomalies) {
      this.detectedAnomalies.push(anomaly);
      
      // Log anomaly
      this.logAnomaly(anomaly);
    }

    // Trim anomaly history
    if (this.detectedAnomalies.length > this.maxAnomalyHistory) {
      this.detectedAnomalies = this.detectedAnomalies.slice(-this.maxAnomalyHistory);
    }

    this.lastCheckTime = now;

    return anomalies;
  }

  /**
   * Check for memory-related anomalies
   */
  private checkMemoryAnomalies(
    currentMemory: number,
    maxConnections: number
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];
    const heapLimit = this.getHeapLimit();
    const memoryPercentage = (currentMemory / heapLimit) * 100;

    // Check memory threshold
    if (memoryPercentage >= this.thresholds.memoryCriticalThreshold) {
      anomalies.push({
        type: AnomalyType.MEMORY_LEAK,
        severity: AnomalySeverity.CRITICAL,
        timestamp: new Date(),
        message: `Critical memory usage: ${memoryPercentage.toFixed(1)}% of heap limit`,
        metrics: {
          currentMemory,
          heapLimit,
          percentage: memoryPercentage,
        },
        suggestedActions: [
          CorrectiveAction.FORCE_GARBAGE_COLLECTION,
          CorrectiveAction.CLOSE_IDLE_CONNECTIONS,
          CorrectiveAction.CLEAR_MESSAGE_HISTORY,
        ],
      });
    } else if (memoryPercentage >= this.thresholds.memoryWarningThreshold) {
      anomalies.push({
        type: AnomalyType.MEMORY_LEAK,
        severity: AnomalySeverity.HIGH,
        timestamp: new Date(),
        message: `High memory usage: ${memoryPercentage.toFixed(1)}% of heap limit`,
        metrics: {
          currentMemory,
          heapLimit,
          percentage: memoryPercentage,
        },
        suggestedActions: [
          CorrectiveAction.CLEANUP_STALE_CONNECTIONS,
          CorrectiveAction.CLEAR_MESSAGE_HISTORY,
        ],
      });
    }

    // Check memory growth rate
    const growthRate = this.calculateMemoryGrowthRate();
    if (growthRate > this.thresholds.memoryGrowthRate) {
      anomalies.push({
        type: AnomalyType.MEMORY_LEAK,
        severity: AnomalySeverity.MEDIUM,
        timestamp: new Date(),
        message: `Rapid memory growth detected: ${growthRate.toFixed(1)} MB/min`,
        metrics: {
          growthRate,
          threshold: this.thresholds.memoryGrowthRate,
        },
        suggestedActions: [
          CorrectiveAction.CLEANUP_STALE_CONNECTIONS,
          CorrectiveAction.EMIT_WARNING,
        ],
      });
    }

    return anomalies;
  }

  /**
   * Check for connection-related anomalies
   */
  private checkConnectionAnomalies(
    currentConnections: number,
    maxConnections: number
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];
    const connectionPercentage = (currentConnections / maxConnections) * 100;

    // Check connection limit
    if (connectionPercentage >= 95) {
      anomalies.push({
        type: AnomalyType.RESOURCE_EXHAUSTION,
        severity: AnomalySeverity.CRITICAL,
        timestamp: new Date(),
        message: `Connection limit nearly reached: ${currentConnections}/${maxConnections}`,
        metrics: {
          currentConnections,
          maxConnections,
          percentage: connectionPercentage,
        },
        suggestedActions: [
          CorrectiveAction.THROTTLE_CONNECTIONS,
          CorrectiveAction.CLOSE_IDLE_CONNECTIONS,
        ],
      });
    } else if (connectionPercentage >= this.thresholds.maxConnectionsWarning) {
      anomalies.push({
        type: AnomalyType.RESOURCE_EXHAUSTION,
        severity: AnomalySeverity.HIGH,
        timestamp: new Date(),
        message: `High connection count: ${currentConnections}/${maxConnections}`,
        metrics: {
          currentConnections,
          maxConnections,
          percentage: connectionPercentage,
        },
        suggestedActions: [
          CorrectiveAction.CLEANUP_STALE_CONNECTIONS,
          CorrectiveAction.EMIT_WARNING,
        ],
      });
    }

    // Check connection spike
    const connectionRate = this.calculateConnectionRate();
    if (connectionRate > this.thresholds.connectionSpikeThreshold) {
      anomalies.push({
        type: AnomalyType.CONNECTION_SPIKE,
        severity: AnomalySeverity.MEDIUM,
        timestamp: new Date(),
        message: `Connection spike detected: ${connectionRate.toFixed(0)} connections/min`,
        metrics: {
          connectionRate,
          threshold: this.thresholds.connectionSpikeThreshold,
        },
        suggestedActions: [
          CorrectiveAction.THROTTLE_CONNECTIONS,
          CorrectiveAction.EMIT_WARNING,
        ],
      });
    }

    return anomalies;
  }

  /**
   * Check for error rate anomalies
   */
  private checkErrorRateAnomalies(): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];
    const errorRate = this.calculateErrorRate();

    if (errorRate >= this.thresholds.errorRateCritical) {
      anomalies.push({
        type: AnomalyType.HIGH_ERROR_RATE,
        severity: AnomalySeverity.CRITICAL,
        timestamp: new Date(),
        message: `Critical error rate: ${errorRate.toFixed(1)} errors/min`,
        metrics: {
          errorRate,
          threshold: this.thresholds.errorRateCritical,
        },
        suggestedActions: [
          CorrectiveAction.EMIT_WARNING,
          CorrectiveAction.THROTTLE_MESSAGES,
        ],
      });
    } else if (errorRate >= this.thresholds.errorRateWarning) {
      anomalies.push({
        type: AnomalyType.HIGH_ERROR_RATE,
        severity: AnomalySeverity.MEDIUM,
        timestamp: new Date(),
        message: `High error rate: ${errorRate.toFixed(1)} errors/min`,
        metrics: {
          errorRate,
          threshold: this.thresholds.errorRateWarning,
        },
        suggestedActions: [CorrectiveAction.EMIT_WARNING],
      });
    }

    return anomalies;
  }

  /**
   * Check for stale connections
   */
  private checkStaleConnections(
    connections: Array<{ socketId: string; lastActivity: Date }>
  ): DetectedAnomaly[] {
    const anomalies: DetectedAnomaly[] = [];
    const now = new Date();
    const staleThresholdMs = this.thresholds.staleConnectionTimeout * 60 * 1000;

    const staleConnections = connections.filter((conn) => {
      const inactiveTime = now.getTime() - conn.lastActivity.getTime();
      return inactiveTime > staleThresholdMs;
    });

    if (staleConnections.length > 0) {
      const severity =
        staleConnections.length > 10
          ? AnomalySeverity.MEDIUM
          : AnomalySeverity.LOW;

      anomalies.push({
        type: AnomalyType.STALE_CONNECTIONS,
        severity,
        timestamp: now,
        message: `${staleConnections.length} stale connections detected`,
        metrics: {
          staleCount: staleConnections.length,
          totalConnections: connections.length,
          staleSocketIds: staleConnections.map((c) => c.socketId),
        },
        suggestedActions: [CorrectiveAction.CLEANUP_STALE_CONNECTIONS],
      });
    }

    return anomalies;
  }

  /**
   * Update memory history
   */
  private updateMemoryHistory(memoryUsage: number, timestamp: Date): void {
    this.memoryHistory.push({ timestamp, usage: memoryUsage });

    // Trim history
    if (this.memoryHistory.length > this.maxMemoryHistorySize) {
      this.memoryHistory.shift();
    }
  }

  /**
   * Update connection history
   */
  private updateConnectionHistory(connectionCount: number, timestamp: Date): void {
    this.connectionHistory.push({ timestamp, count: connectionCount });

    // Trim history
    if (this.connectionHistory.length > this.maxConnectionHistorySize) {
      this.connectionHistory.shift();
    }
  }

  /**
   * Update error history
   */
  private updateErrorHistory(errorCount: number, timestamp: Date): void {
    this.errorHistory.push({ timestamp, count: errorCount });

    // Trim history
    if (this.errorHistory.length > this.maxErrorHistorySize) {
      this.errorHistory.shift();
    }
  }

  /**
   * Calculate memory growth rate (MB per minute)
   */
  private calculateMemoryGrowthRate(): number {
    if (this.memoryHistory.length < 2) {
      return 0;
    }

    const recent = this.memoryHistory.slice(-10); // Last 10 samples
    if (recent.length < 2) {
      return 0;
    }

    const first = recent[0];
    const last = recent[recent.length - 1];

    const memoryDiff = (last.usage - first.usage) / (1024 * 1024); // Convert to MB
    const timeDiff = (last.timestamp.getTime() - first.timestamp.getTime()) / (1000 * 60); // Convert to minutes

    return timeDiff > 0 ? memoryDiff / timeDiff : 0;
  }

  /**
   * Calculate connection rate (connections per minute)
   */
  private calculateConnectionRate(): number {
    if (this.connectionHistory.length < 2) {
      return 0;
    }

    const recent = this.connectionHistory.slice(-10); // Last 10 samples
    if (recent.length < 2) {
      return 0;
    }

    const first = recent[0];
    const last = recent[recent.length - 1];

    const connectionDiff = last.count - first.count;
    const timeDiff = (last.timestamp.getTime() - first.timestamp.getTime()) / (1000 * 60); // Convert to minutes

    return timeDiff > 0 ? connectionDiff / timeDiff : 0;
  }

  /**
   * Calculate error rate (errors per minute)
   */
  private calculateErrorRate(): number {
    if (this.errorHistory.length < 2) {
      return 0;
    }

    const recent = this.errorHistory.slice(-10); // Last 10 samples
    if (recent.length < 2) {
      return 0;
    }

    const first = recent[0];
    const last = recent[recent.length - 1];

    const errorDiff = last.count - first.count;
    const timeDiff = (last.timestamp.getTime() - first.timestamp.getTime()) / (1000 * 60); // Convert to minutes

    return timeDiff > 0 ? errorDiff / timeDiff : 0;
  }

  /**
   * Get heap limit
   */
  private getHeapLimit(): number {
    const heapStats = process.memoryUsage();
    // Use heap limit if available (Node.js v12+), otherwise estimate
    return (heapStats as any).heapLimit || heapStats.heapTotal * 2;
  }

  /**
   * Log anomaly
   */
  private logAnomaly(anomaly: DetectedAnomaly): void {
    const severityMap = {
      [AnomalySeverity.LOW]: ErrorSeverity.INFO,
      [AnomalySeverity.MEDIUM]: ErrorSeverity.WARN,
      [AnomalySeverity.HIGH]: ErrorSeverity.ERROR,
      [AnomalySeverity.CRITICAL]: ErrorSeverity.CRITICAL,
    };

    errorLogger.logResourceError(
      `Anomaly detected: ${anomaly.message}`,
      severityMap[anomaly.severity],
      undefined,
      {
        type: anomaly.type,
        severity: anomaly.severity,
        metrics: anomaly.metrics,
        suggestedActions: anomaly.suggestedActions,
      }
    );
  }

  /**
   * Get detected anomalies
   */
  getDetectedAnomalies(
    type?: AnomalyType,
    severity?: AnomalySeverity,
    limit?: number
  ): DetectedAnomaly[] {
    let filtered = this.detectedAnomalies;

    if (type) {
      filtered = filtered.filter((a) => a.type === type);
    }

    if (severity) {
      filtered = filtered.filter((a) => a.severity === severity);
    }

    if (limit) {
      filtered = filtered.slice(-limit);
    }

    return filtered;
  }

  /**
   * Get anomaly statistics
   */
  getAnomalyStats(): {
    total: number;
    byType: Record<AnomalyType, number>;
    bySeverity: Record<AnomalySeverity, number>;
  } {
    const byType: Record<AnomalyType, number> = {
      [AnomalyType.MEMORY_LEAK]: 0,
      [AnomalyType.CONNECTION_SPIKE]: 0,
      [AnomalyType.HIGH_ERROR_RATE]: 0,
      [AnomalyType.MESSAGE_FLOOD]: 0,
      [AnomalyType.RESOURCE_EXHAUSTION]: 0,
      [AnomalyType.STALE_CONNECTIONS]: 0,
    };

    const bySeverity: Record<AnomalySeverity, number> = {
      [AnomalySeverity.LOW]: 0,
      [AnomalySeverity.MEDIUM]: 0,
      [AnomalySeverity.HIGH]: 0,
      [AnomalySeverity.CRITICAL]: 0,
    };

    for (const anomaly of this.detectedAnomalies) {
      byType[anomaly.type]++;
      bySeverity[anomaly.severity]++;
    }

    return {
      total: this.detectedAnomalies.length,
      byType,
      bySeverity,
    };
  }

  /**
   * Clear anomaly history
   */
  clearHistory(): void {
    this.detectedAnomalies = [];
    this.memoryHistory = [];
    this.connectionHistory = [];
    this.errorHistory = [];
  }

  /**
   * Update thresholds
   */
  updateThresholds(thresholds: Partial<AnomalyThresholds>): void {
    this.thresholds = {
      ...this.thresholds,
      ...thresholds,
    };
  }

  /**
   * Get current thresholds
   */
  getThresholds(): AnomalyThresholds {
    return { ...this.thresholds };
  }
}

