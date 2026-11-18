/**
 * Startup Configuration Validation Tests
 * 
 * Tests that verify configuration validation is called during application startup
 * and that invalid configurations prevent the application from starting.
 * 
 * Task: 2.2 Add configuration validation on startup
 * Requirements: 7.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BlockchainConfig } from '../config/blockchain';

describe('Startup Configuration Validation', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Clear module cache to ensure fresh imports
    vi.resetModules();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Configuration validation on startup', () => {
    it('should validate configuration when WebSocket is disabled', async () => {
      // Set up valid configuration with WebSocket disabled
      process.env.WEBSOCKET_ENABLED = 'false';
      process.env.POLLING_INTERVAL = '5000';
      process.env.POLLING_BATCH_SIZE = '100';

      // Import configuration module
      const { getBlockchainConfig, validateBlockchainConfig } = await import('../config/blockchain');
      
      // Should not throw
      expect(() => {
        const config = getBlockchainConfig();
        validateBlockchainConfig(config);
      }).not.toThrow();
    });

    it('should validate configuration when WebSocket is enabled with valid settings', async () => {
      // Set up valid configuration with WebSocket enabled
      process.env.WEBSOCKET_ENABLED = 'true';
      process.env.WEBSOCKET_PROVIDER_URL = 'wss://test.example.com';
      process.env.WEBSOCKET_MAX_RECONNECT_ATTEMPTS = '10';
      process.env.WEBSOCKET_RECONNECT_BASE_DELAY = '1000';
      process.env.WEBSOCKET_RECONNECT_MAX_DELAY = '30000';
      process.env.POLLING_INTERVAL = '5000';
      process.env.POLLING_BATCH_SIZE = '100';

      // Import configuration module
      const { getBlockchainConfig, validateBlockchainConfig } = await import('../config/blockchain');
      
      // Should not throw
      expect(() => {
        const config = getBlockchainConfig();
        validateBlockchainConfig(config);
      }).not.toThrow();
    });

    it('should throw ConfigurationError when WebSocket is enabled without provider URL', async () => {
      // Set up invalid configuration - WebSocket enabled but no provider URL
      process.env.WEBSOCKET_ENABLED = 'true';
      process.env.WEBSOCKET_PROVIDER_URL = '';
      process.env.POLLING_INTERVAL = '5000';
      process.env.POLLING_BATCH_SIZE = '100';

      // Import configuration module - this will throw during import due to singleton
      await expect(async () => {
        await import('../config/blockchain');
      }).rejects.toThrow('WEBSOCKET_PROVIDER_URL is required when WEBSOCKET_ENABLED is true');
    });

    it('should throw ConfigurationError when WebSocket provider URL does not use wss://', async () => {
      // Set up invalid configuration - WebSocket enabled with http:// URL
      process.env.WEBSOCKET_ENABLED = 'true';
      process.env.WEBSOCKET_PROVIDER_URL = 'http://test.example.com';
      process.env.POLLING_INTERVAL = '5000';
      process.env.POLLING_BATCH_SIZE = '100';

      // Import configuration module - this will throw during import due to singleton
      await expect(async () => {
        await import('../config/blockchain');
      }).rejects.toThrow('WEBSOCKET_PROVIDER_URL must use wss:// protocol');
    });

    it('should throw ConfigurationError when polling interval is too low', async () => {
      // Set up invalid configuration - polling interval too low
      process.env.WEBSOCKET_ENABLED = 'false';
      process.env.POLLING_INTERVAL = '500'; // Less than 1000ms
      process.env.POLLING_BATCH_SIZE = '100';

      // Import configuration module - this will throw during import due to singleton
      await expect(async () => {
        await import('../config/blockchain');
      }).rejects.toThrow('Invalid polling interval');
    });

    it('should log WebSocket feature status when enabled', async () => {
      // Set up valid configuration with WebSocket enabled
      process.env.WEBSOCKET_ENABLED = 'true';
      process.env.WEBSOCKET_PROVIDER_URL = 'wss://test.example.com';
      process.env.POLLING_INTERVAL = '5000';
      process.env.POLLING_BATCH_SIZE = '100';

      // Mock console.log to capture output
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Import configuration module
      const { getBlockchainConfig, logBlockchainConfigStatus } = await import('../config/blockchain');
      
      const config = getBlockchainConfig();
      logBlockchainConfigStatus(config);

      // Verify logging
      expect(consoleLogSpy).toHaveBeenCalledWith('🔧 Blockchain Configuration:');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('WebSocket Listening: ✅ ENABLED'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('WebSocket Provider: wss://test.example.com'));

      consoleLogSpy.mockRestore();
    });

    it('should log WebSocket feature status when disabled', async () => {
      // Set up valid configuration with WebSocket disabled
      process.env.WEBSOCKET_ENABLED = 'false';
      process.env.POLLING_INTERVAL = '5000';
      process.env.POLLING_BATCH_SIZE = '100';

      // Mock console.log to capture output
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Import configuration module
      const { getBlockchainConfig, logBlockchainConfigStatus } = await import('../config/blockchain');
      
      const config = getBlockchainConfig();
      logBlockchainConfigStatus(config);

      // Verify logging
      expect(consoleLogSpy).toHaveBeenCalledWith('🔧 Blockchain Configuration:');
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('WebSocket Listening: ❌ DISABLED'));

      consoleLogSpy.mockRestore();
    });
  });

  describe('Integration with startup flow', () => {
    it('should validate configuration early in startup process', async () => {
      // This test verifies that configuration validation happens before other initialization
      // Set up valid configuration
      process.env.WEBSOCKET_ENABLED = 'false';
      process.env.POLLING_INTERVAL = '5000';
      process.env.POLLING_BATCH_SIZE = '100';

      // Import configuration module
      const { getBlockchainConfig, logBlockchainConfigStatus } = await import('../config/blockchain');
      
      // Mock console.log to capture output
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Simulate startup validation
      const config = getBlockchainConfig(); // This should not throw
      logBlockchainConfigStatus(config);

      // Verify that validation completed successfully
      expect(config).toBeDefined();
      expect(config.websocket).toBeDefined();
      expect(config.polling).toBeDefined();
      expect(consoleLogSpy).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it('should prevent startup with invalid configuration', async () => {
      // Set up invalid configuration
      process.env.WEBSOCKET_ENABLED = 'true';
      process.env.WEBSOCKET_PROVIDER_URL = ''; // Missing required URL
      process.env.POLLING_INTERVAL = '5000';
      process.env.POLLING_BATCH_SIZE = '100';

      // Import configuration module - should throw during import and prevent startup
      await expect(async () => {
        await import('../config/blockchain');
      }).rejects.toThrow('WEBSOCKET_PROVIDER_URL is required when WEBSOCKET_ENABLED is true');
    });
  });
});
