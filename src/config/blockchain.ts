/**
 * Blockchain Configuration
 * 
 * Configures blockchain event monitoring with WebSocket and polling mechanisms.
 * This configuration supports a hybrid approach:
 * - WebSocket connections for real-time mint events on featured launchpads
 * - Polling mechanism for all other events and non-featured launchpads
 */

export interface ReconnectionConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
}

export interface WebSocketListenerConfig {
  enabled: boolean;
  // Note: WebSocket provider URLs are retrieved from database per chain
  // See websocket-config.ts getChainWebSocketUrl() for implementation
  reconnection: ReconnectionConfig;
}

export interface PollingConfig {
  interval: number;
  batchSize: number;
}

export interface BlockchainConfig {
  websocket: WebSocketListenerConfig;
  polling: PollingConfig;
}

/**
 * Load blockchain configuration from environment variables
 */
export function loadBlockchainConfig(): BlockchainConfig {
  const config: BlockchainConfig = {
    websocket: {
      // Global feature flag to enable/disable WebSocket listening
      enabled: process.env.WEBSOCKET_ENABLED === 'true',
      
      // Note: WebSocket provider URLs are retrieved from database per chain
      // Each chain can have its own WebSocket RPC URL stored in the database
      // See websocket-config.ts getChainWebSocketUrl() for implementation
      
      // Reconnection configuration with exponential backoff
      reconnection: {
        // Maximum number of reconnection attempts before alerting
        maxAttempts: parseInt(process.env.WEBSOCKET_MAX_RECONNECT_ATTEMPTS || '10', 10),
        
        // Base delay for exponential backoff (in milliseconds)
        baseDelay: parseInt(process.env.WEBSOCKET_RECONNECT_BASE_DELAY || '1000', 10),
        
        // Maximum delay between reconnection attempts (in milliseconds)
        maxDelay: parseInt(process.env.WEBSOCKET_RECONNECT_MAX_DELAY || '30000', 10),
      },
    },
    polling: {
      // Polling interval for non-WebSocket events (in milliseconds)
      interval: parseInt(process.env.POLLING_INTERVAL || '5000', 10),
      
      // Batch size for polling queries
      batchSize: parseInt(process.env.POLLING_BATCH_SIZE || '100', 10),
    },
  };

  return config;
}

/**
 * Validate blockchain configuration
 * Throws ConfigurationError if validation fails
 */
export function validateBlockchainConfig(config: BlockchainConfig): void {
  const errors: string[] = [];

  // Validate WebSocket configuration if enabled
  if (config.websocket.enabled) {
    // Note: WebSocket provider URLs are validated per chain when retrieved from database
    // See websocket-config.ts getChainWebSocketUrl() for URL validation
    
    // Validate reconnection configuration
    if (config.websocket.reconnection.maxAttempts < 1) {
      errors.push(`Invalid maxAttempts: ${config.websocket.reconnection.maxAttempts}. Must be at least 1`);
    }

    if (config.websocket.reconnection.baseDelay < 100) {
      errors.push(`Invalid baseDelay: ${config.websocket.reconnection.baseDelay}ms. Must be at least 100ms`);
    }

    if (config.websocket.reconnection.maxDelay < config.websocket.reconnection.baseDelay) {
      errors.push(
        `Invalid reconnection delays: maxDelay (${config.websocket.reconnection.maxDelay}ms) ` +
        `must be greater than or equal to baseDelay (${config.websocket.reconnection.baseDelay}ms)`
      );
    }
  }

  // Validate polling configuration
  if (config.polling.interval < 1000) {
    errors.push(`Invalid polling interval: ${config.polling.interval}ms. Must be at least 1000ms to avoid excessive load`);
  }

  if (config.polling.batchSize < 1) {
    errors.push(`Invalid polling batch size: ${config.polling.batchSize}. Must be at least 1`);
  }

  if (config.polling.batchSize > 1000) {
    errors.push(`Invalid polling batch size: ${config.polling.batchSize}. Must not exceed 1000 to avoid memory issues`);
  }

  // Throw error if any validation failed
  if (errors.length > 0) {
    throw new ConfigurationError(errors.join('; '));
  }
}

/**
 * Get blockchain configuration with validation
 * @returns Validated blockchain configuration
 * @throws ConfigurationError if validation fails
 */
export function getBlockchainConfig(): BlockchainConfig {
  const config = loadBlockchainConfig();
  validateBlockchainConfig(config);
  return config;
}

/**
 * Configuration Error class for blockchain configuration issues
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
    
    // Maintains proper stack trace for where error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConfigurationError);
    }
  }
}

/**
 * Log blockchain configuration status
 * Should be called during application initialization
 */
export function logBlockchainConfigStatus(config: BlockchainConfig): void {
  console.log('🔧 Blockchain Configuration:');
  console.log(`  WebSocket Listening: ${config.websocket.enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
  
  if (config.websocket.enabled) {
    console.log(`  WebSocket Provider URLs: Retrieved from database per chain`);
    console.log(`  Reconnection: max ${config.websocket.reconnection.maxAttempts} attempts, ` +
                `${config.websocket.reconnection.baseDelay}ms-${config.websocket.reconnection.maxDelay}ms backoff`);
  }
  
  console.log(`  Polling Interval: ${config.polling.interval}ms`);
  console.log(`  Polling Batch Size: ${config.polling.batchSize}`);
}

// Export singleton configuration instance
export const blockchainConfig = getBlockchainConfig();
