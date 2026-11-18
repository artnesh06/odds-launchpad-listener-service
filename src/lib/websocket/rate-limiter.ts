/**
 * Rate Limiter
 * 
 * Implements rate limiting for WebSocket connections and messages to prevent abuse
 * and ensure system stability under high load.
 * 
 * Features:
 * - Connection rate limiting per IP address
 * - Message rate limiting per connection
 * - Backpressure mechanisms for overloaded connections
 * - Sliding window algorithm for accurate rate tracking
 */

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  // Connection rate limiting
  connectionWindowMs: number; // Time window for connection rate limiting
  maxConnectionsPerWindow: number; // Max connections per IP in window
  
  // Message rate limiting
  messageWindowMs: number; // Time window for message rate limiting
  maxMessagesPerWindow: number; // Max messages per connection in window
  
  // Backpressure
  backpressureThreshold: number; // Percentage (0-1) of limit to trigger backpressure
  backpressureDelayMs: number; // Delay to apply when backpressure is active
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number; // Milliseconds until next attempt allowed
}

/**
 * Backpressure status
 */
export interface BackpressureStatus {
  active: boolean;
  delayMs: number;
  reason: string;
}

/**
 * Rate limiter for connections (per IP)
 */
export class ConnectionRateLimiter {
  private connectionAttempts: Map<string, number[]> = new Map(); // IP -> [timestamp, timestamp, ...]
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if a connection from an IP is allowed
   */
  checkConnection(ip: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.connectionWindowMs;

    // Get or create attempt history for this IP
    let attempts = this.connectionAttempts.get(ip) || [];

    // Remove attempts outside the current window
    attempts = attempts.filter(timestamp => timestamp > windowStart);

    // Check if limit is exceeded
    const allowed = attempts.length < this.config.maxConnectionsPerWindow;
    
    // Calculate reset time (when oldest attempt expires)
    const oldestAttempt = attempts[0] || now;
    const resetAt = new Date(oldestAttempt + this.config.connectionWindowMs);

    // Calculate retry after if not allowed
    let retryAfter: number | undefined;
    if (!allowed && attempts.length > 0) {
      retryAfter = Math.max(0, oldestAttempt + this.config.connectionWindowMs - now);
    }

    // Record this attempt if allowed
    if (allowed) {
      attempts.push(now);
      this.connectionAttempts.set(ip, attempts);
    }

    // Calculate remaining after recording the attempt
    const remaining = Math.max(0, this.config.maxConnectionsPerWindow - attempts.length);

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter,
    };
  }

  /**
   * Get connection statistics for an IP
   */
  getConnectionStats(ip: string): {
    attempts: number;
    limit: number;
    windowMs: number;
  } {
    const now = Date.now();
    const windowStart = now - this.config.connectionWindowMs;
    const attempts = this.connectionAttempts.get(ip) || [];
    const recentAttempts = attempts.filter(timestamp => timestamp > windowStart);

    return {
      attempts: recentAttempts.length,
      limit: this.config.maxConnectionsPerWindow,
      windowMs: this.config.connectionWindowMs,
    };
  }

  /**
   * Clear connection history for an IP
   */
  clearConnectionHistory(ip: string): void {
    this.connectionAttempts.delete(ip);
  }

  /**
   * Clear all connection history (for cleanup)
   */
  clearAllHistory(): void {
    this.connectionAttempts.clear();
  }

  /**
   * Cleanup old entries (should be called periodically)
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.connectionWindowMs;

    for (const [ip, attempts] of this.connectionAttempts.entries()) {
      const recentAttempts = attempts.filter(timestamp => timestamp > windowStart);
      
      if (recentAttempts.length === 0) {
        this.connectionAttempts.delete(ip);
      } else {
        this.connectionAttempts.set(ip, recentAttempts);
      }
    }
  }
}

/**
 * Rate limiter for messages (per connection)
 */
export class MessageRateLimiter {
  private messageAttempts: Map<string, number[]> = new Map(); // socketId -> [timestamp, timestamp, ...]
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if a message from a connection is allowed
   */
  checkMessage(socketId: string): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.config.messageWindowMs;

    // Get or create attempt history for this connection
    let attempts = this.messageAttempts.get(socketId) || [];

    // Remove attempts outside the current window
    attempts = attempts.filter(timestamp => timestamp > windowStart);

    // Check if limit is exceeded
    const allowed = attempts.length < this.config.maxMessagesPerWindow;
    
    // Calculate reset time (when oldest attempt expires)
    const oldestAttempt = attempts[0] || now;
    const resetAt = new Date(oldestAttempt + this.config.messageWindowMs);

    // Calculate retry after if not allowed
    let retryAfter: number | undefined;
    if (!allowed && attempts.length > 0) {
      retryAfter = Math.max(0, oldestAttempt + this.config.messageWindowMs - now);
    }

    // Record this attempt if allowed
    if (allowed) {
      attempts.push(now);
      this.messageAttempts.set(socketId, attempts);
    }

    // Calculate remaining after recording the attempt
    const remaining = Math.max(0, this.config.maxMessagesPerWindow - attempts.length);

    return {
      allowed,
      remaining,
      resetAt,
      retryAfter,
    };
  }

  /**
   * Check if backpressure should be applied
   */
  checkBackpressure(socketId: string): BackpressureStatus {
    const now = Date.now();
    const windowStart = now - this.config.messageWindowMs;
    const attempts = this.messageAttempts.get(socketId) || [];
    const recentAttempts = attempts.filter(timestamp => timestamp > windowStart);

    const usageRatio = recentAttempts.length / this.config.maxMessagesPerWindow;
    const active = usageRatio >= this.config.backpressureThreshold;

    return {
      active,
      delayMs: active ? this.config.backpressureDelayMs : 0,
      reason: active
        ? `Message rate at ${(usageRatio * 100).toFixed(1)}% of limit`
        : 'Normal operation',
    };
  }

  /**
   * Get message statistics for a connection
   */
  getMessageStats(socketId: string): {
    messages: number;
    limit: number;
    windowMs: number;
    usagePercent: number;
  } {
    const now = Date.now();
    const windowStart = now - this.config.messageWindowMs;
    const attempts = this.messageAttempts.get(socketId) || [];
    const recentAttempts = attempts.filter(timestamp => timestamp > windowStart);

    return {
      messages: recentAttempts.length,
      limit: this.config.maxMessagesPerWindow,
      windowMs: this.config.messageWindowMs,
      usagePercent: (recentAttempts.length / this.config.maxMessagesPerWindow) * 100,
    };
  }

  /**
   * Clear message history for a connection
   */
  clearMessageHistory(socketId: string): void {
    this.messageAttempts.delete(socketId);
  }

  /**
   * Clear all message history (for cleanup)
   */
  clearAllHistory(): void {
    this.messageAttempts.clear();
  }

  /**
   * Cleanup old entries (should be called periodically)
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.messageWindowMs;

    for (const [socketId, attempts] of this.messageAttempts.entries()) {
      const recentAttempts = attempts.filter(timestamp => timestamp > windowStart);
      
      if (recentAttempts.length === 0) {
        this.messageAttempts.delete(socketId);
      } else {
        this.messageAttempts.set(socketId, recentAttempts);
      }
    }
  }
}

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  // Connection rate limiting: 10 connections per minute per IP
  connectionWindowMs: 60000, // 1 minute
  maxConnectionsPerWindow: 10,
  
  // Message rate limiting: 100 messages per minute per connection
  messageWindowMs: 60000, // 1 minute
  maxMessagesPerWindow: 100,
  
  // Backpressure: activate at 80% of limit, delay 100ms
  backpressureThreshold: 0.8,
  backpressureDelayMs: 100,
};

/**
 * Load rate limit configuration from environment variables
 */
export function loadRateLimitConfig(): RateLimitConfig {
  return {
    connectionWindowMs: parseInt(
      process.env.WEBSOCKET_CONNECTION_RATE_WINDOW_MS || String(DEFAULT_RATE_LIMIT_CONFIG.connectionWindowMs),
      10
    ),
    maxConnectionsPerWindow: parseInt(
      process.env.WEBSOCKET_MAX_CONNECTIONS_PER_WINDOW || String(DEFAULT_RATE_LIMIT_CONFIG.maxConnectionsPerWindow),
      10
    ),
    messageWindowMs: parseInt(
      process.env.WEBSOCKET_MESSAGE_RATE_WINDOW_MS || String(DEFAULT_RATE_LIMIT_CONFIG.messageWindowMs),
      10
    ),
    maxMessagesPerWindow: parseInt(
      process.env.WEBSOCKET_MAX_MESSAGES_PER_WINDOW || String(DEFAULT_RATE_LIMIT_CONFIG.maxMessagesPerWindow),
      10
    ),
    backpressureThreshold: parseFloat(
      process.env.WEBSOCKET_BACKPRESSURE_THRESHOLD || String(DEFAULT_RATE_LIMIT_CONFIG.backpressureThreshold)
    ),
    backpressureDelayMs: parseInt(
      process.env.WEBSOCKET_BACKPRESSURE_DELAY_MS || String(DEFAULT_RATE_LIMIT_CONFIG.backpressureDelayMs),
      10
    ),
  };
}
