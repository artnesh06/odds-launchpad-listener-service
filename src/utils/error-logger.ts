/**
 * Centralized error logging utility
 * This can be extended to send errors to monitoring services like Sentry, DataDog, etc.
 */

export interface ErrorLogEntry {
  context: string;
  error: string;
  stack?: string;
  data?: any;
  timestamp: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

class ErrorLogger {
  private logs: ErrorLogEntry[] = [];
  private maxLogs: number = 1000; // Keep last 1000 errors in memory

  /**
   * Log an error with context
   */
  log(
    context: string,
    error: any,
    data?: any,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): void {
    const entry: ErrorLogEntry = {
      context,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      data,
      timestamp: new Date().toISOString(),
      severity
    };

    // Add to in-memory log
    this.logs.push(entry);
    
    // Keep only last maxLogs entries
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Console log with appropriate level
    const logMessage = `[${entry.severity.toUpperCase()}] [${context}] ${entry.error}`;
    
    switch (severity) {
      case 'critical':
      case 'high':
        console.error(logMessage, { stack: entry.stack, data: entry.data });
        break;
      case 'medium':
        console.warn(logMessage, { data: entry.data });
        break;
      case 'low':
        console.log(logMessage, { data: entry.data });
        break;
    }

    // Send to monitoring service in production
    if (process.env.NODE_ENV === 'production') {
      this.sendToMonitoring(entry);
    }
  }

  /**
   * Send error to external monitoring service
   */
  private sendToMonitoring(entry: ErrorLogEntry): void {
    // TODO: Implement integration with monitoring service
    // Examples:
    // - Sentry: Sentry.captureException(error, { contexts: { custom: entry } })
    // - DataDog: datadogLogs.logger.error(entry.error, entry)
    // - Custom API: fetch('/api/errors', { method: 'POST', body: JSON.stringify(entry) })
    
    // For now, just log that we would send it
    if (entry.severity === 'critical' || entry.severity === 'high') {
      console.log(`📡 Would send to monitoring service:`, entry);
    }
  }

  /**
   * Get recent error logs
   */
  getRecentLogs(count: number = 100): ErrorLogEntry[] {
    return this.logs.slice(-count);
  }

  /**
   * Get logs by context
   */
  getLogsByContext(context: string): ErrorLogEntry[] {
    return this.logs.filter(log => log.context === context);
  }

  /**
   * Get logs by severity
   */
  getLogsBySeverity(severity: 'low' | 'medium' | 'high' | 'critical'): ErrorLogEntry[] {
    return this.logs.filter(log => log.severity === severity);
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Get error statistics
   */
  getStats(): {
    total: number;
    bySeverity: Record<string, number>;
    byContext: Record<string, number>;
  } {
    const stats = {
      total: this.logs.length,
      bySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      },
      byContext: {} as Record<string, number>
    };

    this.logs.forEach(log => {
      stats.bySeverity[log.severity]++;
      stats.byContext[log.context] = (stats.byContext[log.context] || 0) + 1;
    });

    return stats;
  }
}

// Singleton instance
const errorLogger = new ErrorLogger();

export default errorLogger;

// Convenience functions
export const logError = (
  context: string,
  error: any,
  data?: any,
  severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
) => {
  errorLogger.log(context, error, data, severity);
};

export const getErrorLogs = (count?: number) => {
  return errorLogger.getRecentLogs(count);
};

export const getErrorStats = () => {
  return errorLogger.getStats();
};
