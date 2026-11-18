import { prisma, withRetry, isConnectionError } from '../../config/database';

export enum ErrorSeverity {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum ErrorType {
  RPC_ERROR = 'RPC_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  API_ERROR = 'API_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PROCESSING_ERROR = 'PROCESSING_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  TIMEOUT = 'TIMEOUT',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export interface ErrorContext {
  component: string;
  operation: string;
  chainId?: number;
  contractAddress?: string;
  tokenId?: string;
  txHash?: string;
  blockNumber?: number;
  metadata?: Record<string, any>;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: ErrorType[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    ErrorType.RATE_LIMIT,
    ErrorType.TIMEOUT,
    ErrorType.CONNECTION_ERROR,
    ErrorType.RPC_ERROR,
  ],
}

export interface ErrorLog {
  id: string;
  timestamp: Date;
  errorType: ErrorType;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context: ErrorContext;
  retryCount: number;
  resolved: boolean;
}

// In-memory error tracking
const errorStats = new Map<string, { count: number; lastOccurrence: Date }>();
const recentErrors: ErrorLog[] = [];
const MAX_RECENT_ERRORS = 100;

/**
 * Classify error type from error object
 */
export function classifyError(error: any): ErrorType {
  const errorMessage = error?.message?.toLowerCase() || '';
  const errorCode = error?.code;

  // RPC errors
  if (
    errorMessage.includes('rpc') ||
    errorMessage.includes('provider') ||
    errorCode === 'NETWORK_ERROR' ||
    errorCode === 'SERVER_ERROR'
  ) {
    return ErrorType.RPC_ERROR;
  }

  // Rate limit errors
  if (
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests') ||
    errorCode === 429
  ) {
    return ErrorType.RATE_LIMIT;
  }

  // Timeout errors
  if (
    errorMessage.includes('timeout') ||
    errorMessage.includes('timed out') ||
    errorCode === 'TIMEOUT'
  ) {
    return ErrorType.TIMEOUT;
  }

  // Connection errors
  if (
    errorMessage.includes('connection') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('enotfound') ||
    errorCode === 'ECONNREFUSED' ||
    errorCode === 'ENOTFOUND'
  ) {
    return ErrorType.CONNECTION_ERROR;
  }

  // Database errors
  if (
    errorMessage.includes('prisma') ||
    errorMessage.includes('database') ||
    errorMessage.includes('unique constraint')
  ) {
    return ErrorType.DATABASE_ERROR;
  }

  // API errors
  if (errorMessage.includes('api') || errorMessage.includes('alchemy')) {
    return ErrorType.API_ERROR;
  }

  // Validation errors
  if (errorMessage.includes('invalid') || errorMessage.includes('validation')) {
    return ErrorType.VALIDATION_ERROR;
  }

  return ErrorType.UNKNOWN;
}

/**
 * Determine error severity
 */
export function determineErrorSeverity(
  errorType: ErrorType,
  context: ErrorContext
): ErrorSeverity {
  // Critical errors
  if (
    errorType === ErrorType.DATABASE_ERROR ||
    (errorType === ErrorType.CONNECTION_ERROR && context.component === 'database')
  ) {
    return ErrorSeverity.CRITICAL;
  }

  // High severity errors
  if (
    errorType === ErrorType.RPC_ERROR ||
    errorType === ErrorType.CONNECTION_ERROR
  ) {
    return ErrorSeverity.HIGH;
  }

  // Medium severity errors
  if (
    errorType === ErrorType.API_ERROR ||
    errorType === ErrorType.PROCESSING_ERROR
  ) {
    return ErrorSeverity.MEDIUM;
  }

  // Low severity errors
  return ErrorSeverity.LOW;
}

/**
 * Log error with context
 */
export async function logError(
  error: Error,
  context: ErrorContext
): Promise<void> {
  const errorType = classifyError(error);
  const severity = determineErrorSeverity(errorType, context);

  const errorLog: ErrorLog = {
    id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date(),
    errorType,
    severity,
    message: error.message,
    stack: error.stack,
    context,
    retryCount: 0,
    resolved: false,
  };

  // Add to recent errors
  recentErrors.unshift(errorLog);
  if (recentErrors.length > MAX_RECENT_ERRORS) {
    recentErrors.pop();
  }

  // Update error stats
  const errorKey = `${errorType}-${context.component}-${context.operation}`;
  const stats = errorStats.get(errorKey) || { count: 0, lastOccurrence: new Date() };
  stats.count++;
  stats.lastOccurrence = new Date();
  errorStats.set(errorKey, stats);

  // Log to console with appropriate level
  const logMessage = `[${severity}] ${errorType} in ${context.component}.${context.operation}: ${error.message}`;
  
  if (severity === ErrorSeverity.CRITICAL || severity === ErrorSeverity.HIGH) {
    console.error(logMessage, { context, stack: error.stack });
  } else if (severity === ErrorSeverity.MEDIUM) {
    console.warn(logMessage, { context });
  } else {
    console.log(logMessage, { context });
  }

  // Send alert for critical errors
  if (severity === ErrorSeverity.CRITICAL) {
    await sendAlert(error, severity, context);
  }

  // Store in database for persistent logging
  try {
    await withRetry(() => prisma.errorLog.create({
      data: {
        errorType,
        severity,
        message: error.message,
        stack: error.stack,
        component: context.component,
        operation: context.operation,
        chainId: context.chainId,
        contractAddress: context.contractAddress,
        tokenId: context.tokenId,
        txHash: context.txHash,
        blockNumber: context.blockNumber,
        metadata: context.metadata as any,
      },
    }));
  } catch (dbError) {
    console.error('Failed to log error to database:', dbError);
  }
}

/**
 * Retry operation with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  context?: ErrorContext
): Promise<T> {
  let lastError: Error | undefined;
  let delay = config.initialDelay;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorType = classifyError(error);

      // Check if error is retryable
      if (!config.retryableErrors.includes(errorType)) {
        throw lastError;
      }

      // Don't retry if we've exhausted attempts
      if (attempt === config.maxRetries) {
        break;
      }

      // Log retry attempt
      if (context) {
        console.log(
          `Retry attempt ${attempt + 1}/${config.maxRetries} for ${context.component}.${context.operation} after ${delay}ms`
        );
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));

      // Increase delay with exponential backoff
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
    }
  }

  // All retries exhausted
  if (lastError && context) {
    await logError(lastError, context);
  }

  throw lastError || new Error('Operation failed after retries');
}

/**
 * Handle RPC errors
 */
export async function handleRPCError(
  error: any,
  context: ErrorContext
): Promise<void> {
  await logError(
    error instanceof Error ? error : new Error(String(error)),
    { ...context, component: 'RPC' }
  );

  // Additional RPC-specific handling
  const errorType = classifyError(error);
  
  if (errorType === ErrorType.RATE_LIMIT) {
    console.warn(`Rate limit hit for chain ${context.chainId}, backing off...`);
  } else if (errorType === ErrorType.CONNECTION_ERROR) {
    console.error(`RPC connection lost for chain ${context.chainId}`);
  }
}

/**
 * Handle database errors
 */
export async function handleDatabaseError(
  error: any,
  context: ErrorContext
): Promise<void> {
  await logError(
    error instanceof Error ? error : new Error(String(error)),
    { ...context, component: 'Database' }
  );

  // Additional database-specific handling
  const errorMessage = error?.message?.toLowerCase() || '';
  
  if (errorMessage.includes('unique constraint')) {
    console.warn('Duplicate entry detected, skipping...');
  } else if (errorMessage.includes('connection')) {
    console.error('Database connection lost');
  }
}

/**
 * Handle API errors
 */
export async function handleAPIError(
  error: any,
  context: ErrorContext
): Promise<void> {
  await logError(
    error instanceof Error ? error : new Error(String(error)),
    { ...context, component: 'API' }
  );

  // Additional API-specific handling
  const errorType = classifyError(error);
  
  if (errorType === ErrorType.RATE_LIMIT) {
    console.warn('API rate limit hit, implementing backoff...');
  }
}

/**
 * Send alert for critical errors
 */
export async function sendAlert(
  error: Error,
  severity: ErrorSeverity,
  context: ErrorContext
): Promise<void> {
  // Placeholder for alert implementation
  // Could integrate with services like PagerDuty, Slack, email, etc.
  console.error('🚨 CRITICAL ALERT 🚨', {
    severity,
    error: error.message,
    context,
    timestamp: new Date().toISOString(),
  });

  // TODO: Implement actual alerting mechanism
  // - Send to Slack webhook
  // - Send email notification
  // - Trigger PagerDuty incident
  // - Send SMS for critical issues
}

/**
 * Get error statistics
 */
export function getErrorStats(): Array<{
  errorKey: string;
  count: number;
  lastOccurrence: Date;
}> {
  return Array.from(errorStats.entries()).map(([errorKey, stats]) => ({
    errorKey,
    count: stats.count,
    lastOccurrence: stats.lastOccurrence,
  }));
}

/**
 * Get recent errors
 */
export function getRecentErrors(limit: number = 50): ErrorLog[] {
  return recentErrors.slice(0, limit);
}

/**
 * Clear error stats
 */
export function clearErrorStats(): void {
  errorStats.clear();
  recentErrors.length = 0;
}

/**
 * Get error rate (errors per minute)
 */
export function getErrorRate(): number {
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
  const recentErrorCount = recentErrors.filter(
    (e) => e.timestamp >= oneMinuteAgo
  ).length;
  return recentErrorCount;
}