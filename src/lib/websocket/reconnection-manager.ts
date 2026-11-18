/**
 * Reconnection Manager
 * 
 * Manages reconnection logic with exponential backoff for WebSocket connections.
 * Tracks reconnection attempts and calculates appropriate delays.
 */

import { errorLogger, ErrorCategory, ErrorSeverity } from './error-logger';

/**
 * Reconnection configuration
 */
export interface ReconnectionConfig {
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Maximum number of reconnection attempts (0 = infinite) */
  maxAttempts: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
  /** Add random jitter to prevent thundering herd */
  jitter: boolean;
}

/**
 * Reconnection state
 */
export interface ReconnectionState {
  attempts: number;
  lastAttemptTime: Date | null;
  nextAttemptTime: Date | null;
  currentDelay: number;
  isReconnecting: boolean;
}

/**
 * Default reconnection configuration
 */
export const DEFAULT_RECONNECTION_CONFIG: ReconnectionConfig = {
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  maxAttempts: 10, // 10 attempts
  backoffMultiplier: 2, // Double each time
  jitter: true, // Add randomness
};

/**
 * Reconnection Manager class
 */
export class ReconnectionManager {
  private config: ReconnectionConfig;
  private state: ReconnectionState;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private onReconnectCallback: (() => Promise<void>) | null = null;

  constructor(config: Partial<ReconnectionConfig> = {}) {
    this.config = { ...DEFAULT_RECONNECTION_CONFIG, ...config };
    this.state = {
      attempts: 0,
      lastAttemptTime: null,
      nextAttemptTime: null,
      currentDelay: this.config.initialDelay,
      isReconnecting: false,
    };
  }

  /**
   * Set the reconnection callback
   */
  setReconnectCallback(callback: () => Promise<void>): void {
    this.onReconnectCallback = callback;
  }

  /**
   * Start reconnection process
   */
  async startReconnection(socketId?: string): Promise<void> {
    // Check if already reconnecting
    if (this.state.isReconnecting) {
      errorLogger.logConnectionError(
        'Reconnection already in progress',
        socketId
      );
      return;
    }

    // Check if max attempts reached
    if (
      this.config.maxAttempts > 0 &&
      this.state.attempts >= this.config.maxAttempts
    ) {
      errorLogger.logConnectionError(
        `Maximum reconnection attempts (${this.config.maxAttempts}) reached`,
        socketId
      );
      this.reset();
      return;
    }

    this.state.isReconnecting = true;
    this.state.attempts++;
    this.state.lastAttemptTime = new Date();

    // Calculate delay with exponential backoff
    const delay = this.calculateDelay();
    this.state.currentDelay = delay;
    this.state.nextAttemptTime = new Date(Date.now() + delay);

    errorLogger.logConnectionError(
      `Reconnection attempt ${this.state.attempts}/${this.config.maxAttempts || '∞'} scheduled in ${delay}ms`,
      socketId
    );

    // Schedule reconnection
    this.reconnectTimer = setTimeout(async () => {
      try {
        if (this.onReconnectCallback) {
          await this.onReconnectCallback();
          // If successful, reset state
          this.reset();
          errorLogger.logConnectionError(
            'Reconnection successful',
            socketId
          );
        }
      } catch (error) {
        errorLogger.logConnectionError(
          `Reconnection attempt ${this.state.attempts} failed`,
          socketId,
          undefined,
          error as Error
        );
        this.state.isReconnecting = false;
        // Try again
        await this.startReconnection(socketId);
      }
    }, delay);
  }

  /**
   * Calculate delay with exponential backoff
   */
  private calculateDelay(): number {
    // Base delay with exponential backoff
    let delay = Math.min(
      this.config.initialDelay * Math.pow(this.config.backoffMultiplier, this.state.attempts - 1),
      this.config.maxDelay
    );

    // Add jitter if enabled (±25% randomness)
    if (this.config.jitter) {
      const jitterRange = delay * 0.25;
      const jitter = Math.random() * jitterRange * 2 - jitterRange;
      delay = Math.max(0, delay + jitter);
    }

    return Math.floor(delay);
  }

  /**
   * Stop reconnection process
   */
  stopReconnection(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.state.isReconnecting = false;
    errorLogger.logConnectionError('Reconnection stopped');
  }

  /**
   * Reset reconnection state
   */
  reset(): void {
    this.stopReconnection();
    this.state = {
      attempts: 0,
      lastAttemptTime: null,
      nextAttemptTime: null,
      currentDelay: this.config.initialDelay,
      isReconnecting: false,
    };
  }

  /**
   * Get current reconnection state
   */
  getState(): ReconnectionState {
    return { ...this.state };
  }

  /**
   * Get reconnection configuration
   */
  getConfig(): ReconnectionConfig {
    return { ...this.config };
  }

  /**
   * Update reconnection configuration
   */
  updateConfig(config: Partial<ReconnectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if should attempt reconnection
   */
  shouldReconnect(): boolean {
    if (this.config.maxAttempts === 0) {
      return true; // Infinite attempts
    }
    return this.state.attempts < this.config.maxAttempts;
  }

  /**
   * Get time until next reconnection attempt
   */
  getTimeUntilNextAttempt(): number {
    if (!this.state.nextAttemptTime) {
      return 0;
    }
    return Math.max(0, this.state.nextAttemptTime.getTime() - Date.now());
  }

  /**
   * Manually trigger reconnection attempt
   */
  async reconnectNow(socketId?: string): Promise<void> {
    this.stopReconnection();
    this.state.isReconnecting = false;
    await this.startReconnection(socketId);
  }
}

/**
 * Create a reconnection manager with default config
 */
export function createReconnectionManager(
  config?: Partial<ReconnectionConfig>
): ReconnectionManager {
  return new ReconnectionManager(config);
}
