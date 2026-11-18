/**
 * Error Logger
 * 
 * Comprehensive error logging system for WebSocket operations with:
 * - Error categorization (connection, message, room, resource)
 * - Context and timestamp tracking
 * - User-friendly error message generation
 */

/**
 * Error categories for WebSocket operations
 */
export enum ErrorCategory {
  CONNECTION = 'connection',
  MESSAGE = 'message',
  ROOM = 'room',
  RESOURCE = 'resource',
  AUTHENTICATION = 'authentication',
  VALIDATION = 'validation',
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  CRITICAL = 'critical',
}

/**
 * Error context for detailed logging
 */
export interface ErrorContext {
  category: ErrorCategory;
  severity: ErrorSeverity;
  timestamp: Date;
  socketId?: string;
  roomName?: string;
  eventType?: string;
  origin?: string;
  userAgent?: string;
  walletAddress?: string;
  additionalData?: Record<string, any>;
}

/**
 * Logged error with full context
 */
export interface LoggedError {
  message: string;
  error?: Error;
  context: ErrorContext;
  userFriendlyMessage: string;
  stack?: string;
}

/**
 * Error Logger class
 */
export class ErrorLogger {
  private errors: LoggedError[] = [];
  private maxErrorHistory: number = 1000;
  private logLevel: ErrorSeverity;

  constructor(logLevel: ErrorSeverity = ErrorSeverity.INFO) {
    this.logLevel = logLevel;
  }

  /**
   * Log an error with full context
   */
  logError(
    message: string,
    category: ErrorCategory,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    error?: Error,
    context?: Partial<ErrorContext>
  ): void {
    const fullContext: ErrorContext = {
      category,
      severity,
      timestamp: new Date(),
      ...context,
    };

    const userFriendlyMessage = this.generateUserFriendlyMessage(
      message,
      category,
      error
    );

    const loggedError: LoggedError = {
      message,
      error,
      context: fullContext,
      userFriendlyMessage,
      stack: error?.stack,
    };

    // Add to history (with size limit)
    this.errors.push(loggedError);
    if (this.errors.length > this.maxErrorHistory) {
      this.errors.shift();
    }

    // Output to console if severity is high enough
    if (this.shouldLog(severity)) {
      this.outputToConsole(loggedError);
    }
  }

  /**
   * Log a connection error
   */
  logConnectionError(
    message: string,
    socketId?: string,
    origin?: string,
    error?: Error
  ): void {
    this.logError(message, ErrorCategory.CONNECTION, ErrorSeverity.WARN, error, {
      socketId,
      origin,
    });
  }

  /**
   * Log a message error
   */
  logMessageError(
    message: string,
    socketId?: string,
    eventType?: string,
    error?: Error,
    additionalData?: Record<string, any>
  ): void {
    this.logError(message, ErrorCategory.MESSAGE, ErrorSeverity.ERROR, error, {
      socketId,
      eventType,
      additionalData,
    });
  }

  /**
   * Log a room error
   */
  logRoomError(
    message: string,
    roomName?: string,
    socketId?: string,
    error?: Error
  ): void {
    this.logError(message, ErrorCategory.ROOM, ErrorSeverity.WARN, error, {
      roomName,
      socketId,
    });
  }

  /**
   * Log a resource error
   */
  logResourceError(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.ERROR,
    error?: Error,
    additionalData?: Record<string, any>
  ): void {
    this.logError(message, ErrorCategory.RESOURCE, severity, error, {
      additionalData,
    });
  }

  /**
   * Log an authentication error
   */
  logAuthenticationError(
    message: string,
    socketId?: string,
    origin?: string,
    walletAddress?: string,
    error?: Error
  ): void {
    this.logError(
      message,
      ErrorCategory.AUTHENTICATION,
      ErrorSeverity.WARN,
      error,
      {
        socketId,
        origin,
        walletAddress,
      }
    );
  }

  /**
   * Log a validation error
   */
  logValidationError(
    message: string,
    socketId?: string,
    eventType?: string,
    error?: Error,
    additionalData?: Record<string, any>
  ): void {
    this.logError(message, ErrorCategory.VALIDATION, ErrorSeverity.WARN, error, {
      socketId,
      eventType,
      additionalData,
    });
  }

  /**
   * Generate user-friendly error message
   */
  private generateUserFriendlyMessage(
    message: string,
    category: ErrorCategory,
    error?: Error
  ): string {
    switch (category) {
      case ErrorCategory.CONNECTION:
        if (message.includes('limit reached')) {
          return 'Server is at capacity. Please try again in a few moments.';
        }
        if (message.includes('origin') || message.includes('Unauthorized')) {
          return 'Connection not allowed from this location.';
        }
        if (message.includes('timeout')) {
          return 'Connection timed out. Please check your internet connection.';
        }
        return 'Unable to establish connection. Please refresh and try again.';

      case ErrorCategory.MESSAGE:
        if (message.includes('invalid') || message.includes('malformed')) {
          return 'Invalid message format. Please refresh the page.';
        }
        if (message.includes('rate limit')) {
          return 'Too many requests. Please slow down.';
        }
        return 'Error processing message. Please try again.';

      case ErrorCategory.ROOM:
        if (message.includes('not found')) {
          return 'The requested channel is not available.';
        }
        if (message.includes('permission')) {
          return 'You do not have access to this channel.';
        }
        return 'Unable to join channel. Please try again.';

      case ErrorCategory.RESOURCE:
        if (message.includes('memory')) {
          return 'Server is experiencing high load. Please try again shortly.';
        }
        if (message.includes('port') || message.includes('address in use')) {
          return 'Server configuration error. Please contact support.';
        }
        return 'Server resource error. Please try again later.';

      case ErrorCategory.AUTHENTICATION:
        if (message.includes('token') || message.includes('signature')) {
          return 'Authentication failed. Please reconnect your wallet.';
        }
        return 'Authentication error. Please try again.';

      case ErrorCategory.VALIDATION:
        if (message.includes('schema')) {
          return 'Invalid data format. Please refresh the page.';
        }
        if (message.includes('size') || message.includes('too large')) {
          return 'Message too large. Please try with less data.';
        }
        return 'Data validation failed. Please try again.';

      default:
        return 'An unexpected error occurred. Please refresh and try again.';
    }
  }

  /**
   * Check if error should be logged based on severity
   */
  private shouldLog(severity: ErrorSeverity): boolean {
    const levels = [
      ErrorSeverity.DEBUG,
      ErrorSeverity.INFO,
      ErrorSeverity.WARN,
      ErrorSeverity.ERROR,
      ErrorSeverity.CRITICAL,
    ];

    const configLevel = levels.indexOf(this.logLevel);
    const messageSeverity = levels.indexOf(severity);

    return messageSeverity >= configLevel;
  }

  /**
   * Output error to console with formatting
   */
  private outputToConsole(loggedError: LoggedError): void {
    const { message, error, context, userFriendlyMessage } = loggedError;
    const timestamp = context.timestamp.toISOString();
    const severity = context.severity.toUpperCase().padEnd(8);
    const category = context.category.toUpperCase().padEnd(14);

    // Build context string
    const contextParts: string[] = [];
    if (context.socketId) contextParts.push(`socket=${context.socketId}`);
    if (context.roomName) contextParts.push(`room=${context.roomName}`);
    if (context.eventType) contextParts.push(`event=${context.eventType}`);
    if (context.origin) contextParts.push(`origin=${context.origin}`);
    if (context.walletAddress)
      contextParts.push(`wallet=${context.walletAddress.substring(0, 10)}...`);

    const contextStr = contextParts.length > 0 ? ` [${contextParts.join(', ')}]` : '';

    // Log based on severity
    const logMessage = `[${timestamp}] [${severity}] [${category}]${contextStr} ${message}`;

    switch (context.severity) {
      case ErrorSeverity.DEBUG:
        console.debug(logMessage);
        break;
      case ErrorSeverity.INFO:
        console.info(logMessage);
        break;
      case ErrorSeverity.WARN:
        console.warn(logMessage);
        break;
      case ErrorSeverity.ERROR:
      case ErrorSeverity.CRITICAL:
        console.error(logMessage);
        if (error) {
          console.error('Error details:', error);
        }
        if (context.additionalData) {
          console.error('Additional data:', context.additionalData);
        }
        break;
    }

    // Log user-friendly message for errors
    if (
      context.severity === ErrorSeverity.ERROR ||
      context.severity === ErrorSeverity.CRITICAL
    ) {
      console.error(`User message: ${userFriendlyMessage}`);
    }
  }

  /**
   * Get error history
   */
  getErrorHistory(
    category?: ErrorCategory,
    severity?: ErrorSeverity,
    limit?: number
  ): LoggedError[] {
    let filtered = this.errors;

    if (category) {
      filtered = filtered.filter((e) => e.context.category === category);
    }

    if (severity) {
      filtered = filtered.filter((e) => e.context.severity === severity);
    }

    if (limit) {
      filtered = filtered.slice(-limit);
    }

    return filtered;
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    total: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
  } {
    const byCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.CONNECTION]: 0,
      [ErrorCategory.MESSAGE]: 0,
      [ErrorCategory.ROOM]: 0,
      [ErrorCategory.RESOURCE]: 0,
      [ErrorCategory.AUTHENTICATION]: 0,
      [ErrorCategory.VALIDATION]: 0,
    };

    const bySeverity: Record<ErrorSeverity, number> = {
      [ErrorSeverity.DEBUG]: 0,
      [ErrorSeverity.INFO]: 0,
      [ErrorSeverity.WARN]: 0,
      [ErrorSeverity.ERROR]: 0,
      [ErrorSeverity.CRITICAL]: 0,
    };

    for (const error of this.errors) {
      byCategory[error.context.category]++;
      bySeverity[error.context.severity]++;
    }

    return {
      total: this.errors.length,
      byCategory,
      bySeverity,
    };
  }

  /**
   * Clear error history
   */
  clearHistory(): void {
    this.errors = [];
  }

  /**
   * Set log level
   */
  setLogLevel(level: ErrorSeverity): void {
    this.logLevel = level;
  }
}

// Export singleton instance (lazy initialization to avoid issues in tests)
let _errorLogger: ErrorLogger | null = null;

export const errorLogger = {
  logError: (...args: Parameters<ErrorLogger['logError']>) => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.logError(...args);
  },
  logConnectionError: (...args: Parameters<ErrorLogger['logConnectionError']>) => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.logConnectionError(...args);
  },
  logMessageError: (...args: Parameters<ErrorLogger['logMessageError']>) => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.logMessageError(...args);
  },
  logRoomError: (...args: Parameters<ErrorLogger['logRoomError']>) => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.logRoomError(...args);
  },
  logResourceError: (...args: Parameters<ErrorLogger['logResourceError']>) => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.logResourceError(...args);
  },
  logAuthenticationError: (...args: Parameters<ErrorLogger['logAuthenticationError']>) => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.logAuthenticationError(...args);
  },
  logValidationError: (...args: Parameters<ErrorLogger['logValidationError']>) => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.logValidationError(...args);
  },
  getErrorHistory: (...args: Parameters<ErrorLogger['getErrorHistory']>) => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.getErrorHistory(...args);
  },
  getErrorStats: () => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.getErrorStats();
  },
  clearHistory: () => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.clearHistory();
  },
  setLogLevel: (level: ErrorSeverity) => {
    if (!_errorLogger) _errorLogger = new ErrorLogger(ErrorSeverity.INFO);
    return _errorLogger.setLogLevel(level);
  },
};
