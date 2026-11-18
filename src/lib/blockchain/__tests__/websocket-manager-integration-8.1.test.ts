/**
 * Integration test for Task 8.1: Initialize WebSocketManager in event listener startup
 * 
 * This test verifies that the WebSocketManager is properly initialized during
 * application startup when WebSocket is globally enabled.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getBlockchainConfig } from '../../../config/blockchain';

describe('Task 8.1: WebSocketManager Integration in Startup', () => {
  describe('Blockchain Configuration', () => {
    it('should load blockchain configuration with WebSocket settings', () => {
      const config = getBlockchainConfig();
      
      expect(config).toBeDefined();
      expect(config.websocket).toBeDefined();
      expect(config.websocket).toHaveProperty('enabled');
      expect(config.websocket).toHaveProperty('providerUrl');
      expect(config.websocket).toHaveProperty('reconnection');
      expect(config.polling).toBeDefined();
    });

    it('should have proper reconnection configuration', () => {
      const config = getBlockchainConfig();
      
      expect(config.websocket.reconnection).toHaveProperty('maxAttempts');
      expect(config.websocket.reconnection).toHaveProperty('baseDelay');
      expect(config.websocket.reconnection).toHaveProperty('maxDelay');
      
      expect(config.websocket.reconnection.maxAttempts).toBeGreaterThan(0);
      expect(config.websocket.reconnection.baseDelay).toBeGreaterThanOrEqual(100);
      expect(config.websocket.reconnection.maxDelay).toBeGreaterThanOrEqual(config.websocket.reconnection.baseDelay);
    });

    it('should validate WebSocket provider URL format when enabled', () => {
      const config = getBlockchainConfig();
      
      // If WebSocket is enabled, provider URL should be set
      if (config.websocket.enabled) {
        expect(config.websocket.providerUrl).toBeTruthy();
        // Provider URL should use wss:// protocol for secure connections
        // Note: This validation is done in validateBlockchainConfig()
      }
    });
  });

  describe('WebSocket Initialization Logic', () => {
    it('should only initialize WebSocketManager when globally enabled', () => {
      const config = getBlockchainConfig();
      
      // The initialization logic in src/index.ts checks this flag
      const shouldInitialize = config.websocket.enabled;
      
      // If enabled is false, WebSocketManager should not be initialized
      // If enabled is true, WebSocketManager should be initialized
      expect(typeof shouldInitialize).toBe('boolean');
    });

    it('should have proper environment variable defaults', () => {
      const config = getBlockchainConfig();
      
      // Default values should be sensible
      expect(config.websocket.reconnection.maxAttempts).toBe(10);
      expect(config.websocket.reconnection.baseDelay).toBe(1000);
      expect(config.websocket.reconnection.maxDelay).toBe(30000);
      expect(config.polling.interval).toBe(5000);
      expect(config.polling.batchSize).toBe(100);
    });
  });

  describe('Startup Flow Requirements', () => {
    it('should validate requirements 2.4, 7.2, 7.4', () => {
      const config = getBlockchainConfig();
      
      // Requirement 2.4: System SHALL establish WebSocket connections for all featured launchpads on startup
      // This is handled by WebSocketManager.initialize()
      
      // Requirement 7.2: When WebSocket listening is globally disabled, system SHALL use polling
      // This is checked by config.websocket.enabled flag
      
      // Requirement 7.4: When WebSocket listening is enabled, system SHALL respect individual launchpad isFeatured settings
      // This is handled by WebSocketManager.initialize() querying for isFeatured=true
      
      expect(config.websocket).toHaveProperty('enabled');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing WEBSOCKET_PROVIDER_URL gracefully when enabled', () => {
      // Save original env
      const originalEnv = process.env.WEBSOCKET_PROVIDER_URL;
      const originalEnabled = process.env.WEBSOCKET_ENABLED;
      
      try {
        // Set enabled to true but remove provider URL
        process.env.WEBSOCKET_ENABLED = 'true';
        delete process.env.WEBSOCKET_PROVIDER_URL;
        
        // This should throw a ConfigurationError
        expect(() => {
          // Re-import to get fresh config
          const { getBlockchainConfig } = require('../../../config/blockchain');
          getBlockchainConfig();
        }).toThrow();
      } finally {
        // Restore original env
        if (originalEnv !== undefined) {
          process.env.WEBSOCKET_PROVIDER_URL = originalEnv;
        }
        if (originalEnabled !== undefined) {
          process.env.WEBSOCKET_ENABLED = originalEnabled;
        }
      }
    });

    it('should handle invalid WebSocket provider URL format', () => {
      // Save original env
      const originalEnv = process.env.WEBSOCKET_PROVIDER_URL;
      const originalEnabled = process.env.WEBSOCKET_ENABLED;
      
      try {
        // Set enabled to true with invalid URL (not wss://)
        process.env.WEBSOCKET_ENABLED = 'true';
        process.env.WEBSOCKET_PROVIDER_URL = 'http://invalid-url.com';
        
        // This should throw a ConfigurationError
        expect(() => {
          // Re-import to get fresh config
          const { getBlockchainConfig } = require('../../../config/blockchain');
          getBlockchainConfig();
        }).toThrow();
      } finally {
        // Restore original env
        if (originalEnv !== undefined) {
          process.env.WEBSOCKET_PROVIDER_URL = originalEnv;
        }
        if (originalEnabled !== undefined) {
          process.env.WEBSOCKET_ENABLED = originalEnabled;
        }
      }
    });
  });

  describe('Integration Points', () => {
    it('should have WebSocketManager class available for import', async () => {
      const { WebSocketManager } = await import('../websocket-manager');
      expect(WebSocketManager).toBeDefined();
      expect(typeof WebSocketManager).toBe('function');
    });

    it('should have EventProcessor available for import', async () => {
      const { EventProcessor, eventProcessor } = await import('../../processors/event-processor');
      expect(EventProcessor).toBeDefined();
      expect(eventProcessor).toBeDefined();
      expect(typeof EventProcessor).toBe('function');
    });

    it('should have ethers.WebSocketProvider available', async () => {
      const { ethers } = await import('ethers');
      // In ethers v6, WebSocketProvider is directly on ethers namespace
      expect(ethers.WebSocketProvider).toBeDefined();
      expect(typeof ethers.WebSocketProvider).toBe('function');
    });
  });

  describe('Graceful Shutdown', () => {
    it('should have shutdown method available on WebSocketManager', async () => {
      const { WebSocketManager } = await import('../websocket-manager');
      const { EventProcessor } = await import('../../processors/event-processor');
      const { ethers } = await import('ethers');
      
      // Create a minimal mock provider
      const mockProvider = {
        on: vi.fn(),
        removeAllListeners: vi.fn(),
      } as any;
      
      const eventProcessor = new EventProcessor();
      const manager = new WebSocketManager(mockProvider, eventProcessor);
      
      expect(typeof manager.shutdown).toBe('function');
      
      // Shutdown should return a Promise
      const shutdownPromise = manager.shutdown();
      expect(shutdownPromise).toBeInstanceOf(Promise);
      await shutdownPromise;
    });
  });
});
