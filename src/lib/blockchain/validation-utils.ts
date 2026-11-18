/**
 * Validation Utilities for Event Processing
 * 
 * This file contains validation helper functions used by the ActivityListener
 * to validate event data before processing.
 */

import { prisma } from '../../config/database';
import { ActivityType } from '@prisma/client';
import { logError } from '../../utils/error-logger';
import { ErrorCounter, ErrorLogData, ErrorSeverity } from './event-types';

/**
 * Validate event data by checking required fields and data types
 * @param event - The event object to validate
 * @param requiredFields - Array of field names that must be present
 * @throws Error if validation fails
 */
export function validateEventData(event: any, requiredFields: string[]): void {
  if (!event) {
    throw new Error('Event data is null or undefined');
  }

  // Check for required fields
  for (const field of requiredFields) {
    if (event[field] === undefined || event[field] === null) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validate transaction hash if present
  if (event.txHash && !isValidTxHash(event.txHash)) {
    throw new Error(`Invalid transaction hash: ${event.txHash}`);
  }

  // Validate block number if present
  if (event.blockNumber !== undefined && event.blockNumber !== null) {
    if (typeof event.blockNumber !== 'number' || event.blockNumber < 0) {
      throw new Error(`Invalid block number: ${event.blockNumber}`);
    }
  }

  // Validate Ethereum addresses if present
  const addressFields = ['contractAddress', 'launchpadAddress', 'owner', 'creator', 'to', 'from', 'recipient', 'account', 'sender', 'previousOwner', 'newOwner', 'oldTreasury', 'newTreasury'];
  for (const field of addressFields) {
    if (event[field] && !isValidAddress(event[field])) {
      throw new Error(`Invalid Ethereum address for field ${field}: ${event[field]}`);
    }
  }
}

/**
 * Validate if a string is a valid Ethereum transaction hash
 * @param txHash - The transaction hash to validate
 * @returns true if valid, false otherwise
 */
export function isValidTxHash(txHash: string): boolean {
  if (typeof txHash !== 'string') {
    return false;
  }
  // Transaction hash should be 66 characters (0x + 64 hex chars)
  return /^0x[a-fA-F0-9]{64}$/.test(txHash);
}

/**
 * Validate if a string is a valid Ethereum address
 * @param address - The address to validate
 * @returns true if valid, false otherwise
 */
export function isValidAddress(address: string): boolean {
  if (typeof address !== 'string') {
    return false;
  }
  // Address should be 42 characters (0x + 40 hex chars)
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Check if an activity has already been recorded (deduplication)
 * @param txHash - Transaction hash
 * @param eventType - Activity type
 * @param launchpadAddress - Launchpad contract address
 * @returns true if duplicate, false otherwise
 */
export async function isDuplicateActivity(
  txHash: string,
  eventType: ActivityType,
  launchpadAddress?: string
): Promise<boolean> {
  try {
    const whereClause: any = {
      txHash,
      type: eventType,
    };

    // Add launchpad address to query if provided
    if (launchpadAddress) {
      const launchpad = await prisma.launchpad.findUnique({
        where: { contractAddress: launchpadAddress }
      });
      if (launchpad) {
        whereClause.launchpadId = launchpad.id;
      }
    }

    const existing = await prisma.activity.findFirst({
      where: whereClause
    });

    return existing !== null;
  } catch (error) {
    console.error('Error checking for duplicate activity:', error);
    // On error, assume not duplicate to avoid blocking new activities
    return false;
  }
}

/**
 * Check if a transfer event has already been recorded (idempotency)
 * Requirements: 15.1
 * 
 * @param txHash - Transaction hash
 * @param logIndex - Log index within the transaction
 * @returns true if duplicate, false otherwise
 */
export async function isDuplicateTransfer(
  txHash: string,
  logIndex: number
): Promise<boolean> {
  try {
    const existing = await prisma.nFTTransfer.findUnique({
      where: {
        txHash_logIndex: {
          txHash,
          logIndex
        }
      }
    });

    return existing !== null;
  } catch (error) {
    console.error('Error checking for duplicate transfer:', error);
    // On error, assume not duplicate to avoid blocking new transfers
    return false;
  }
}

/**
 * Check if a mint event has already been recorded (idempotency)
 * Requirements: 15.2
 * 
 * @param txHash - Transaction hash
 * @param contractAddress - Contract address
 * @param tokenId - Token ID
 * @returns true if duplicate, false otherwise
 */
export async function isDuplicateMint(
  txHash: string,
  contractAddress: string,
  tokenId: string
): Promise<boolean> {
  try {
    // Check if NFT already exists with this mint transaction
    const existing = await prisma.nFT.findFirst({
      where: {
        contractAddress: contractAddress.toLowerCase(),
        tokenId,
        mintTransactionHash: txHash
      }
    });

    return existing !== null;
  } catch (error) {
    console.error('Error checking for duplicate mint:', error);
    // On error, assume not duplicate to avoid blocking new mints
    return false;
  }
}

/**
 * Check if a marketplace event has already been recorded (idempotency)
 * Requirements: 15.3
 * 
 * @param txHash - Transaction hash
 * @param logIndex - Log index within the transaction
 * @param bundleIndex - Bundle index (for multi-item sales)
 * @returns true if duplicate, false otherwise
 */
export async function isDuplicateMarketplaceEvent(
  txHash: string,
  logIndex: number,
  bundleIndex: number = 0
): Promise<boolean> {
  try {
    // Check marketplace sales
    const existingSale = await prisma.marketplaceSale.findUnique({
      where: {
        txHash_logIndex_bundleIndex: {
          txHash,
          logIndex,
          bundleIndex
        }
      }
    });

    if (existingSale) {
      return true;
    }

    // Check marketplace listings
    const existingListing = await prisma.marketplaceListing.findFirst({
      where: {
        listingTxHash: txHash
      }
    });

    if (existingListing) {
      return true;
    }

    // Check marketplace offers
    const existingOffer = await prisma.marketplaceOffer.findFirst({
      where: {
        offerTxHash: txHash
      }
    });

    return existingOffer !== null;
  } catch (error) {
    console.error('Error checking for duplicate marketplace event:', error);
    // On error, assume not duplicate to avoid blocking new events
    return false;
  }
}

/**
 * Increment error counter for a specific event type and trigger alert if threshold exceeded
 * @param errorCounters - Map of error counters
 * @param eventType - The type of event that encountered an error
 * @param errorThreshold - Threshold for triggering alerts
 * @param chainId - Chain ID for context
 * @param sendAdminAlert - Callback function to send admin alerts
 */
export function incrementErrorCounter(
  errorCounters: Map<string, ErrorCounter>,
  eventType: string,
  errorThreshold: number,
  chainId: number,
  sendAdminAlert: (alertData: any) => void
): void {
  const counter = errorCounters.get(eventType) || {
    eventType,
    count: 0,
    lastError: new Date(),
    threshold: errorThreshold
  };

  counter.count++;
  counter.lastError = new Date();

  errorCounters.set(eventType, counter);

  // Check if threshold exceeded
  if (counter.count >= counter.threshold) {
    sendAdminAlert({
      type: 'EVENT_HANDLER_FAILURE',
      eventType,
      errorCount: counter.count,
      lastError: counter.lastError,
      chainId
    });

    // Reset counter after alert
    counter.count = 0;
    errorCounters.set(eventType, counter);
  }
}

/**
 * Send alert to administrators about critical errors
 * @param alertData - Alert information
 */
export function sendAdminAlert(alertData: {
  type: string;
  eventType: string;
  errorCount: number;
  lastError: Date;
  chainId: number;
}): void {
  // Log critical alert
  console.error('🚨 ADMIN ALERT:', {
    ...alertData,
    message: `Event handler for ${alertData.eventType} has failed ${alertData.errorCount} times on chain ${alertData.chainId}`
  });

  // In production, this would send notifications via email, Slack, PagerDuty, etc.
  // For now, we use the centralized error logger with critical severity
  logError(
    `ActivityListener.AdminAlert`,
    new Error(`Event handler failure threshold exceeded for ${alertData.eventType}`),
    alertData,
    'critical'
  );
}

/**
 * Execute database operation with retry logic and exponential backoff
 * Requirements: 18.2, 18.5
 * 
 * Retries database operations up to maxRetries times with exponential backoff.
 * Identifies retryable vs non-retryable errors.
 * Logs failure after max retries and continues processing.
 * 
 * @param operation - The database operation to execute
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param operationName - Name of the operation for logging
 * @returns Result of the operation
 * @throws Error if max retries exceeded or non-retryable error
 */
export async function withRetryLogic<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  operationName: string = 'database operation'
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Identify retryable errors (Requirement 18.2)
      const isRetryable = 
        error?.code === 'P1001' || // Can't reach database
        error?.code === 'P1002' || // Database timeout
        error?.code === 'P2034' || // Deadlock
        error?.code === 'P2037' || // Too many connections
        error?.message?.includes('deadlock') ||
        error?.message?.includes('timeout') ||
        error?.message?.includes('too many clients') ||
        error?.message?.includes('Connection') ||
        error?.message?.includes('ECONNRESET');
      
      // Non-retryable errors (Requirement 18.2)
      const isNonRetryable =
        error?.code === 'P2002' || // Unique constraint violation
        error?.code === 'P2003' || // Foreign key constraint violation
        error?.code === 'P2025' || // Record not found
        error?.message?.includes('Unique constraint') ||
        error?.message?.includes('validation');
      
      if (isNonRetryable) {
        console.warn(`⚠️ Non-retryable error in ${operationName}: ${error.message}`);
        throw error;
      }
      
      if (isRetryable && attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s (Requirement 18.2)
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        console.warn(
          `⚠️ Retryable error in ${operationName} (attempt ${attempt}/${maxRetries}), ` +
          `retrying in ${delayMs}ms: ${error.message}`
        );
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      
      // Max retries exceeded (Requirement 18.5)
      if (attempt === maxRetries) {
        console.error(
          `❌ Max retries (${maxRetries}) exceeded for ${operationName}: ${error.message}`
        );
        
        // Log failure but don't throw - continue processing other events (Requirement 18.5)
        try {
          await prisma.errorLog.create({
            data: {
              errorType: 'RetryExhausted',
              severity: 'high',
              message: `Max retries exceeded for ${operationName}: ${error.message}`,
              stack: error.stack || '',
              component: 'RetryLogic',
              operation: operationName,
              metadata: {
                attempts: maxRetries,
                lastError: error instanceof Error ? {
                  name: error.name,
                  message: error.message,
                  code: (error as any).code
                } : error
              },
              resolved: false
            }
          });
        } catch (logError) {
          console.error('Failed to log retry exhaustion:', logError);
        }
        
        throw error;
      }
    }
  }
  
  throw lastError;
}

/**
 * Execute database operations within a transaction with error handling
 * Requirements: 13.1, 13.2, 13.4
 * 
 * Wraps all database operations in prisma.$transaction() to ensure atomicity.
 * Catches transaction errors and logs with full context.
 * Ensures partial updates are rolled back on failure.
 * 
 * @param operation - The transaction operation to execute
 * @param operationName - Name of the operation for logging
 * @param eventData - Event data for error context
 * @param chainId - Chain ID for error context
 * @returns Result of the transaction
 * @throws Error if transaction fails
 */
export async function withTransaction<T>(
  operation: (tx: any) => Promise<T>,
  operationName: string,
  eventData?: any,
  chainId?: number
): Promise<T> {
  try {
    // Wrap all database operations in transaction (Requirement 13.1)
    return await prisma.$transaction(async (tx) => {
      return await operation(tx);
    });
  } catch (error: any) {
    // Catch transaction errors and log with full context (Requirement 13.4)
    console.error(`❌ Transaction failed for ${operationName}:`, error);
    
    // Log transaction rollback
    try {
      await prisma.errorLog.create({
        data: {
          errorType: error?.code ? `TransactionError_${error.code}` : 'TransactionError',
          severity: 'high',
          message: `Transaction rollback for ${operationName}: ${error.message || error}`,
          stack: error.stack || '',
          component: 'TransactionHandler',
          operation: operationName,
          chainId: chainId || null,
          contractAddress: eventData?.contractAddress || eventData?.launchpadAddress || null,
          tokenId: eventData?.tokenId || null,
          txHash: eventData?.txHash || null,
          blockNumber: eventData?.blockNumber || null,
          metadata: {
            eventData,
            errorDetails: error instanceof Error ? {
              name: error.name,
              message: error.message,
              code: (error as any).code
            } : error
          },
          resolved: false
        }
      });
    } catch (logError) {
      console.error('Failed to log transaction error:', logError);
    }
    
    // Re-throw to allow caller to handle (Requirement 13.2)
    throw error;
  }
}

/**
 * Log event processing error with full context
 * Requirements: 14.1, 14.2, 14.3, 14.4
 * 
 * Logs errors to error_logs table with complete context including:
 * - errorType, severity, message, stack, component, operation
 * - chainId, contractAddress, tokenId, txHash, blockNumber when available
 * - resolved=false for all new error logs
 * 
 * @param eventType - The type of event that encountered an error
 * @param error - The error that occurred
 * @param eventData - The event data being processed
 * @param severity - Error severity level
 * @param chainId - Chain ID for context
 * @param errorCounters - Map of error counters
 * @param errorThreshold - Threshold for triggering alerts
 * @param sendAdminAlertFn - Callback function to send admin alerts
 */
export async function logEventError(
  eventType: string,
  error: any,
  eventData: any,
  severity: ErrorSeverity = 'medium',
  chainId: number,
  errorCounters: Map<string, ErrorCounter>,
  errorThreshold: number,
  sendAdminAlertFn: (alertData: any) => void
): Promise<void> {
  try {
    // Determine error type (Requirement 14.2)
    let errorType = 'UnknownError';
    if (error instanceof Error) {
      errorType = error.name || error.constructor.name;
    } else if (error?.code) {
      errorType = `DatabaseError_${error.code}`;
    } else if (typeof error === 'string') {
      errorType = 'StringError';
    }

    // Extract error message (Requirement 14.2)
    const errorMessage = error instanceof Error 
      ? error.message 
      : (typeof error === 'string' ? error : JSON.stringify(error));

    // Extract stack trace (Requirement 14.2)
    const errorStack = error instanceof Error 
      ? error.stack || '' 
      : '';

    // Extract context fields (Requirement 14.3)
    const contractAddress = eventData?.contractAddress || 
                           eventData?.launchpadAddress || 
                           eventData?.factoryAddress || 
                           null;
    const tokenId = eventData?.tokenId || null;
    const txHash = eventData?.txHash || null;
    const blockNumber = eventData?.blockNumber || null;

    // Determine component name (Requirement 14.2)
    const component = `EventHandler.${eventType}`;

    // Determine operation name (Requirement 14.2)
    const operation = eventType;

    // Log to error_logs table (Requirement 14.1)
    try {
      await prisma.errorLog.create({
        data: {
          errorType,           // Requirement 14.2
          severity,            // Requirement 14.2
          message: errorMessage, // Requirement 14.2
          stack: errorStack,   // Requirement 14.2
          component,           // Requirement 14.2
          operation,           // Requirement 14.2
          chainId,             // Requirement 14.3
          contractAddress,     // Requirement 14.3
          tokenId,             // Requirement 14.3
          txHash,              // Requirement 14.3
          blockNumber,         // Requirement 14.3
          metadata: {
            eventData,
            errorDetails: error instanceof Error ? {
              name: error.name,
              message: error.message,
              stack: error.stack
            } : error
          },
          resolved: false      // Requirement 14.4
        }
      });

      console.error(`❌ Error logged to database: ${errorType} - ${errorMessage}`);
    } catch (dbError) {
      // If database logging fails, fall back to console logging
      console.error('❌ Failed to log error to database:', dbError);
      console.error('Original error:', {
        errorType,
        severity,
        message: errorMessage,
        stack: errorStack,
        component,
        operation,
        chainId,
        contractAddress,
        tokenId,
        txHash,
        blockNumber
      });
    }

    // Also use centralized error logger for backwards compatibility
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
      chainId,
      txHash: eventData?.txHash,
      blockNumber: eventData?.blockNumber
    };

    logError(
      component,
      error,
      errorLogData,
      severity
    );

    // Increment error counter for this event type
    incrementErrorCounter(errorCounters, eventType, errorThreshold, chainId, sendAdminAlertFn);

  } catch (logErr) {
    console.error('Failed to log event error:', logErr);
  }
}
