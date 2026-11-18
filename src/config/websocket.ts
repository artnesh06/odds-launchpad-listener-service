/**
 * WebSocket Server Configuration
 * 
 * Configures Socket.IO server for real-time blockchain event broadcasting
 */

import { RateLimitConfig } from '../lib/websocket/rate-limiter';

export interface WebSocketConfig {
  port: number;
  corsOrigin: string | string[];
  maxConnections: number;
  messageSizeLimit: number;
  pingInterval: number;
  pingTimeout: number;
  reconnectAttempts: number;
  authEnabled: boolean;
  metricsEnabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  rateLimitEnabled: boolean;
  rateLimit: RateLimitConfig;
}

/**
 * Load WebSocket configuration from environment variables
 */
export function loadWebSocketConfig(): WebSocketConfig {
  const config: WebSocketConfig = {
    // WebSocket server port (separate from health check port)
    port: parseInt(process.env.WEBSOCKET_PORT || '3002', 10),
    
    // CORS origin whitelist
    corsOrigin: process.env.WEBSOCKET_CORS_ORIGIN
      ? process.env.WEBSOCKET_CORS_ORIGIN.split(',').map(o => o.trim())
      : [
          'http://localhost:3000', 
          'http://localhost:3004', 
          'https://nft-launchpad-odds-fe.vercel.app',
          'https://nft-launchpad-odds-fe-sooty.vercel.app',
          'https://testnet.oddslaunchpad.com'
        ],
    
    // Connection limits
    maxConnections: parseInt(process.env.WEBSOCKET_MAX_CONNECTIONS || '1000', 10),
    
    // Message size limit (1MB default)
    messageSizeLimit: parseInt(process.env.WEBSOCKET_MESSAGE_SIZE_LIMIT || '1048576', 10),
    
    // Ping/pong configuration for connection health
    pingInterval: parseInt(process.env.WEBSOCKET_PING_INTERVAL || '30000', 10),
    pingTimeout: parseInt(process.env.WEBSOCKET_PING_TIMEOUT || '5000', 10),
    
    // Reconnection attempts
    reconnectAttempts: parseInt(process.env.WEBSOCKET_RECONNECT_ATTEMPTS || '5', 10),
    
    // Authentication
    authEnabled: process.env.WEBSOCKET_AUTH_ENABLED === 'true',
    
    // Monitoring
    metricsEnabled: process.env.WEBSOCKET_METRICS_ENABLED !== 'false',
    logLevel: (process.env.WEBSOCKET_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
    
    // Rate limiting
    rateLimitEnabled: process.env.WEBSOCKET_RATE_LIMIT_ENABLED !== 'false', // Enabled by default
    rateLimit: {
      connectionWindowMs: parseInt(process.env.WEBSOCKET_CONNECTION_RATE_WINDOW_MS || '60000', 10),
      maxConnectionsPerWindow: parseInt(process.env.WEBSOCKET_MAX_CONNECTIONS_PER_WINDOW || '10', 10),
      messageWindowMs: parseInt(process.env.WEBSOCKET_MESSAGE_RATE_WINDOW_MS || '60000', 10),
      maxMessagesPerWindow: parseInt(process.env.WEBSOCKET_MAX_MESSAGES_PER_WINDOW || '100', 10),
      backpressureThreshold: parseFloat(process.env.WEBSOCKET_BACKPRESSURE_THRESHOLD || '0.8'),
      backpressureDelayMs: parseInt(process.env.WEBSOCKET_BACKPRESSURE_DELAY_MS || '100', 10),
    },
  };

  return config;
}

/**
 * Validate WebSocket configuration
 */
export function validateWebSocketConfig(config: WebSocketConfig): void {
  if (config.port < 1024 || config.port > 65535) {
    throw new Error(`Invalid WebSocket port: ${config.port}. Must be between 1024 and 65535`);
  }

  if (config.maxConnections < 1) {
    throw new Error(`Invalid max connections: ${config.maxConnections}. Must be at least 1`);
  }

  if (config.messageSizeLimit < 1024) {
    throw new Error(`Invalid message size limit: ${config.messageSizeLimit}. Must be at least 1024 bytes`);
  }

  if (config.pingInterval < 1000) {
    throw new Error(`Invalid ping interval: ${config.pingInterval}. Must be at least 1000ms`);
  }

  if (config.pingTimeout < 1000) {
    throw new Error(`Invalid ping timeout: ${config.pingTimeout}. Must be at least 1000ms`);
  }
}

/**
 * Get WebSocket configuration with validation
 */
export function getWebSocketConfig(): WebSocketConfig {
  const config = loadWebSocketConfig();
  validateWebSocketConfig(config);
  return config;
}
