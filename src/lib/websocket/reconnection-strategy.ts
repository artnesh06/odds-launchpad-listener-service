/**
 * WebSocket Reconnection Strategy
 * Implements exponential backoff with jitter for reconnection attempts
 */

const BASE_DELAY_MS = 1000; // 1 second
const MAX_DELAY_MS = 30000; // 30 seconds
const BACKOFF_MULTIPLIER = 2;

/**
 * Calculate backoff delay for reconnection attempt
 * Uses exponential backoff with optional jitter
 *
 * @param attemptNumber - The current attempt number (0-indexed)
 * @param useJitter - Whether to add random jitter to prevent thundering herd
 * @returns Delay in milliseconds
 */
export function calculateBackoff(attemptNumber: number, useJitter: boolean = true): number {
  // Handle negative attempt numbers
  const safeAttempt = Math.max(0, attemptNumber);

  // Calculate exponential delay: baseDelay * (multiplier ^ attempt)
  const exponentialDelay = BASE_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, safeAttempt);

  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, MAX_DELAY_MS);

  // Add jitter if requested (±25% randomness)
  if (useJitter) {
    const jitterFactor = 0.75 + Math.random() * 0.5; // 0.75 to 1.25
    return Math.floor(cappedDelay * jitterFactor);
  }

  return cappedDelay;
}

/**
 * Determine if reconnection should be attempted
 *
 * @param attemptNumber - Current attempt number
 * @param maxAttempts - Maximum number of attempts allowed
 * @returns True if should retry, false otherwise
 */
export function shouldRetry(attemptNumber: number, maxAttempts: number): boolean {
  return attemptNumber < maxAttempts;
}

/**
 * Reconnection state tracker
 */
export class ReconnectionTracker {
  private attemptCount: number = 0;
  private lastAttemptTime: number = 0;
  private readonly maxAttempts: number;

  constructor(maxAttempts: number = 5) {
    this.maxAttempts = maxAttempts;
  }

  /**
   * Record a reconnection attempt
   */
  recordAttempt(): void {
    this.attemptCount++;
    this.lastAttemptTime = Date.now();
  }

  /**
   * Reset the attempt counter (call on successful connection)
   */
  reset(): void {
    this.attemptCount = 0;
    this.lastAttemptTime = 0;
  }

  /**
   * Get the current attempt count
   */
  getAttemptCount(): number {
    return this.attemptCount;
  }

  /**
   * Check if should attempt reconnection
   */
  shouldAttemptReconnection(): boolean {
    return shouldRetry(this.attemptCount, this.maxAttempts);
  }

  /**
   * Get the delay for next reconnection attempt
   */
  getNextDelay(): number {
    return calculateBackoff(this.attemptCount);
  }

  /**
   * Get time since last attempt
   */
  getTimeSinceLastAttempt(): number {
    if (this.lastAttemptTime === 0) {
      return Infinity;
    }
    return Date.now() - this.lastAttemptTime;
  }
}
