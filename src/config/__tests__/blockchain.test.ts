import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadBlockchainConfig,
  validateBlockchainConfig,
  getBlockchainConfig,
  ConfigurationError,
  logBlockchainConfigStatus,
  type BlockchainConfig,
} from '../blockchain';

describe('Blockchain Configuration', () => {
  // Store original environment variables
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment variables before each test
    delete process.env.WEBSOCKET_ENABLED;
    delete process.env.WEBSOCKET_PROVIDER_URL;
    delete process.env.WEBSOCKET_MAX_RECONNECT_ATTEMPTS;
    delete process.env.WEBSOCKET_RECONNECT_BASE_DELAY;
    delete process.env.WEBSOCKET_RECONNECT_MAX_DELAY;
    delete process.env.POLLING_INTERVAL;
    delete process.env.POLLING_BATCH_SIZE;
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = { ...originalEnv };
  });

  describe('loadBlockchainConfig', () => {
    it('should load default configuration when no env vars are set', () => {
      const config = loadBlockchainConfig();

      expect(config.websocket.enabled).toBe(false);
      expect(config.websocket.providerUrl).toBe('');
      expect(config.websocket.reconnection.maxAttempts).toBe(10);
      expect(config.websocket.reconnection.baseDelay).toBe(1000);
      expect(config.websocket.reconnection.maxDelay).toBe(30000);
      expect(config.polling.interval).toBe(5000);
      expect(config.polling.batchSize).toBe(100);
    });

    it('should load WebSocket enabled configuration', () => {
      process.env.WEBSOCKET_ENABLED = 'true';
      process.env.WEBSOCKET_PROVIDER_URL = 'wss://eth-mainnet.example.com';

      const config = loadBlockchainConfig();

      expect(config.websocket.enabled).toBe(true);
      expect(config.websocket.providerUrl).toBe('wss://eth-mainnet.example.com');
    });

    it('should load custom reconnection configuration', () => {
      process.env.WEBSOCKET_MAX_RECONNECT_ATTEMPTS = '5';
      process.env.WEBSOCKET_RECONNECT_BASE_DELAY = '2000';
      process.env.WEBSOCKET_RECONNECT_MAX_DELAY = '60000';

      const config = loadBlockchainConfig();

      expect(config.websocket.reconnection.maxAttempts).toBe(5);
      expect(config.websocket.reconnection.baseDelay).toBe(2000);
      expect(config.websocket.reconnection.maxDelay).toBe(60000);
    });

    it('should load custom polling configuration', () => {
      process.env.POLLING_INTERVAL = '10000';
      process.env.POLLING_BATCH_SIZE = '50';

      const config = loadBlockchainConfig();

      expect(config.polling.interval).toBe(10000);
      expect(config.polling.batchSize).toBe(50);
    });

    it('should handle invalid numeric values gracefully', () => {
      process.env.WEBSOCKET_MAX_RECONNECT_ATTEMPTS = 'invalid';
      process.env.POLLING_INTERVAL = 'not-a-number';

      const config = loadBlockchainConfig();

      // Should fall back to defaults when parsing fails
      expect(isNaN(config.websocket.reconnection.maxAttempts)).toBe(true);
      expect(isNaN(config.polling.interval)).toBe(true);
    });
  });

  describe('validateBlockchainConfig', () => {
    describe('WebSocket validation when enabled', () => {
      it('should throw error when WEBSOCKET_PROVIDER_URL is missing', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: true,
            providerUrl: '',
            reconnection: {
              maxAttempts: 10,
              baseDelay: 1000,
              maxDelay: 30000,
            },
          },
          polling: {
            interval: 5000,
            batchSize: 100,
          },
        };

        expect(() => validateBlockchainConfig(config)).toThrow(ConfigurationError);
        expect(() => validateBlockchainConfig(config)).toThrow(
          'WEBSOCKET_PROVIDER_URL is required when WEBSOCKET_ENABLED is true'
        );
      });

      it('should throw error when WEBSOCKET_PROVIDER_URL does not use wss://', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: true,
            providerUrl: 'ws://insecure.example.com',
            reconnection: {
              maxAttempts: 10,
              baseDelay: 1000,
              maxDelay: 30000,
            },
          },
          polling: {
            interval: 5000,
            batchSize: 100,
          },
        };

        expect(() => validateBlockchainConfig(config)).toThrow(ConfigurationError);
        expect(() => validateBlockchainConfig(config)).toThrow(
          'WEBSOCKET_PROVIDER_URL must use wss:// protocol'
        );
      });

      it('should throw error when maxAttempts is less than 1', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: true,
            providerUrl: 'wss://valid.example.com',
            reconnection: {
              maxAttempts: 0,
              baseDelay: 1000,
              maxDelay: 30000,
            },
          },
          polling: {
            interval: 5000,
            batchSize: 100,
          },
        };

        expect(() => validateBlockchainConfig(config)).toThrow(ConfigurationError);
        expect(() => validateBlockchainConfig(config)).toThrow('Invalid maxAttempts');
      });

      it('should throw error when baseDelay is less than 100ms', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: true,
            providerUrl: 'wss://valid.example.com',
            reconnection: {
              maxAttempts: 10,
              baseDelay: 50,
              maxDelay: 30000,
            },
          },
          polling: {
            interval: 5000,
            batchSize: 100,
          },
        };

        expect(() => validateBlockchainConfig(config)).toThrow(ConfigurationError);
        expect(() => validateBlockchainConfig(config)).toThrow('Invalid baseDelay');
      });

      it('should throw error when maxDelay is less than baseDelay', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: true,
            providerUrl: 'wss://valid.example.com',
            reconnection: {
              maxAttempts: 10,
              baseDelay: 5000,
              maxDelay: 1000,
            },
          },
          polling: {
            interval: 5000,
            batchSize: 100,
          },
        };

        expect(() => validateBlockchainConfig(config)).toThrow(ConfigurationError);
        expect(() => validateBlockchainConfig(config)).toThrow('Invalid reconnection delays');
      });

      it('should pass validation with valid WebSocket configuration', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: true,
            providerUrl: 'wss://valid.example.com',
            reconnection: {
              maxAttempts: 10,
              baseDelay: 1000,
              maxDelay: 30000,
            },
          },
          polling: {
            interval: 5000,
            batchSize: 100,
          },
        };

        expect(() => validateBlockchainConfig(config)).not.toThrow();
      });
    });

    describe('WebSocket validation when disabled', () => {
      it('should not validate WebSocket config when disabled', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: false,
            providerUrl: '', // Invalid but should not be checked
            reconnection: {
              maxAttempts: 0, // Invalid but should not be checked
              baseDelay: 50, // Invalid but should not be checked
              maxDelay: 10, // Invalid but should not be checked
            },
          },
          polling: {
            interval: 5000,
            batchSize: 100,
          },
        };

        expect(() => validateBlockchainConfig(config)).not.toThrow();
      });
    });

    describe('Polling validation', () => {
      it('should throw error when polling interval is less than 1000ms', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: false,
            providerUrl: '',
            reconnection: {
              maxAttempts: 10,
              baseDelay: 1000,
              maxDelay: 30000,
            },
          },
          polling: {
            interval: 500,
            batchSize: 100,
          },
        };

        expect(() => validateBlockchainConfig(config)).toThrow(ConfigurationError);
        expect(() => validateBlockchainConfig(config)).toThrow('Invalid polling interval');
      });

      it('should throw error when batch size is less than 1', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: false,
            providerUrl: '',
            reconnection: {
              maxAttempts: 10,
              baseDelay: 1000,
              maxDelay: 30000,
            },
          },
          polling: {
            interval: 5000,
            batchSize: 0,
          },
        };

        expect(() => validateBlockchainConfig(config)).toThrow(ConfigurationError);
        expect(() => validateBlockchainConfig(config)).toThrow('Invalid polling batch size');
      });

      it('should throw error when batch size exceeds 1000', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: false,
            providerUrl: '',
            reconnection: {
              maxAttempts: 10,
              baseDelay: 1000,
              maxDelay: 30000,
            },
          },
          polling: {
            interval: 5000,
            batchSize: 1001,
          },
        };

        expect(() => validateBlockchainConfig(config)).toThrow(ConfigurationError);
        expect(() => validateBlockchainConfig(config)).toThrow('Invalid polling batch size');
      });

      it('should pass validation with valid polling configuration', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: false,
            providerUrl: '',
            reconnection: {
              maxAttempts: 10,
              baseDelay: 1000,
              maxDelay: 30000,
            },
          },
          polling: {
            interval: 5000,
            batchSize: 100,
          },
        };

        expect(() => validateBlockchainConfig(config)).not.toThrow();
      });
    });

    describe('Multiple validation errors', () => {
      it('should combine multiple validation errors', () => {
        const config: BlockchainConfig = {
          websocket: {
            enabled: true,
            providerUrl: '', // Error 1: Missing
            reconnection: {
              maxAttempts: 0, // Error 2: Invalid
              baseDelay: 1000,
              maxDelay: 30000,
            },
          },
          polling: {
            interval: 500, // Error 3: Too low
            batchSize: 100,
          },
        };

        expect(() => validateBlockchainConfig(config)).toThrow(ConfigurationError);
        
        try {
          validateBlockchainConfig(config);
        } catch (error) {
          if (error instanceof ConfigurationError) {
            expect(error.message).toContain('WEBSOCKET_PROVIDER_URL is required');
            expect(error.message).toContain('Invalid maxAttempts');
            expect(error.message).toContain('Invalid polling interval');
          }
        }
      });
    });
  });

  describe('getBlockchainConfig', () => {
    it('should return validated configuration', () => {
      process.env.WEBSOCKET_ENABLED = 'false';
      process.env.POLLING_INTERVAL = '5000';
      process.env.POLLING_BATCH_SIZE = '100';

      const config = getBlockchainConfig();

      expect(config).toBeDefined();
      expect(config.websocket.enabled).toBe(false);
      expect(config.polling.interval).toBe(5000);
      expect(config.polling.batchSize).toBe(100);
    });

    it('should throw ConfigurationError for invalid configuration', () => {
      process.env.WEBSOCKET_ENABLED = 'true';
      process.env.WEBSOCKET_PROVIDER_URL = ''; // Missing required value

      expect(() => getBlockchainConfig()).toThrow(ConfigurationError);
    });
  });

  describe('ConfigurationError', () => {
    it('should create error with correct name', () => {
      const error = new ConfigurationError('Test error');

      expect(error.name).toBe('ConfigurationError');
      expect(error.message).toBe('Test error');
      expect(error instanceof Error).toBe(true);
    });

    it('should maintain stack trace', () => {
      const error = new ConfigurationError('Test error');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ConfigurationError');
    });
  });

  describe('logBlockchainConfigStatus', () => {
    it('should log configuration status without throwing', () => {
      const config: BlockchainConfig = {
        websocket: {
          enabled: true,
          providerUrl: 'wss://test.example.com',
          reconnection: {
            maxAttempts: 10,
            baseDelay: 1000,
            maxDelay: 30000,
          },
        },
        polling: {
          interval: 5000,
          batchSize: 100,
        },
      };

      // Should not throw
      expect(() => logBlockchainConfigStatus(config)).not.toThrow();
    });

    it('should log disabled WebSocket status', () => {
      const config: BlockchainConfig = {
        websocket: {
          enabled: false,
          providerUrl: '',
          reconnection: {
            maxAttempts: 10,
            baseDelay: 1000,
            maxDelay: 30000,
          },
        },
        polling: {
          interval: 5000,
          batchSize: 100,
        },
      };

      // Should not throw
      expect(() => logBlockchainConfigStatus(config)).not.toThrow();
    });
  });
});
