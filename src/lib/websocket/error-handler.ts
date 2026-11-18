/**
 * WebSocket Error Handler
 * Provides error logging and user-friendly error message generation
 */

export type ErrorType = 'CONNECTION' | 'MESSAGE' | 'ROOM' | 'RESOURCE';

export interface ErrorContext {
  socketId?: string;
  room?: string;
  ip?: string;
  userId?: string;
  [key: string]: any;
}

/**
 * Log error with context and timestamp
 */
export function logError(errorType: ErrorType, error: Error | null | undefined, context: ErrorContext): void {
  if (!error) {
    console.error(`[${new Date().toISOString()}] [WS-ERROR] [${errorType}] Error object is null or undefined`, context);
    return;
  }

  const timestamp = new Date().toISOString();
  const contextStr = Object.keys(context).length > 0 ? JSON.stringify(context) : 'No context';

  console.error(
    `[${timestamp}] [WS-ERROR] [${errorType}] ${error.message}`,
    '\nContext:', contextStr,
    '\nStack:', error.stack
  );
}

/**
 * Generate user-friendly error message from technical error
 */
export function getUserFriendlyMessage(error: Error): string {
  const errorCode = (error as any).code;

  switch (errorCode) {
    case 'ECONNREFUSED':
      return 'Unable to connect to the server. Please check your connection and try again.';

    case 'ETIMEDOUT':
      return 'Connection timed out. Please check your internet connection and try again.';

    case 'ENOTFOUND':
      return 'Server not found. Please check the server address and try again.';

    case 'EADDRINUSE':
      return 'Server port is already in use. Please contact support.';

    case 'EPIPE':
    case 'ECONNRESET':
      return 'Connection was interrupted. Please try reconnecting.';

    case 'UNAUTHORIZED':
      return 'Authentication failed. Please check your credentials.';

    case 'FORBIDDEN':
      return 'Access denied. You do not have permission to access this resource.';

    case 'RATE_LIMIT_EXCEEDED':
      return 'Too many requests. Please wait a moment and try again.';

    default:
      return 'An unexpected error occurred. Please try again later.';
  }
}

/**
 * Categorize error by type
 */
export function categorizeError(error: Error): ErrorType {
  const errorCode = (error as any).code;
  const message = error.message.toLowerCase();

  if (errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT' || errorCode === 'ECONNRESET') {
    return 'CONNECTION';
  }

  if (message.includes('room') || message.includes('subscription')) {
    return 'ROOM';
  }

  if (message.includes('message') || message.includes('parse') || message.includes('invalid')) {
    return 'MESSAGE';
  }

  if (errorCode === 'EADDRINUSE' || message.includes('memory') || message.includes('resource')) {
    return 'RESOURCE';
  }

  return 'CONNECTION'; // Default
}
