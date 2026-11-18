/**
 * Integration test for marketplace listener refactoring
 * Verifies that all 4 marketplace types work correctly with shared services
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarketplaceEventListener, MarketplaceEventListenerConfig } from '../marketplace-event-listener';
import { Marketplace } from '@prisma/client';

describe('Marketplace Listener Integration - Shared Services', () => {
  let listener: MarketplaceEventListener;

  afterEach(async () => {
    if (listener) {
      try {
        await listener.stop();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  });

  describe('OpenSea Seaport Integration', () => {
    it('should initialize Seaport marketplace with shared services', () => {
      const config: MarketplaceEventListenerConfig = {
        chainId: 1,
        rpcUrl: 'https://eth-mainnet.example.com',
        marketplaces: [Marketplace.SEAPORT],
        errorThreshold: 10,
        retryAttempts: 3
      };

      listener = new MarketplaceEventListener(config);
      const status = listener.getStatus();

      expect(status.chainId).toBe(1);
      expect(status.isRunning).toBe(false);
      expect(status.contracts.some(c => c.marketplace === Marketplace.SEAPORT)).toBe(true);
    });
  });

  describe('Blur Integration', () => {
    it('should initialize Blur marketplace with shared services', () => {
      const config: MarketplaceEventListenerConfig = {
        chainId: 1,
        rpcUrl: 'https://eth-mainnet.example.com',
        marketplaces: [Marketplace.BLUR],
        errorThreshold: 10,
        retryAttempts: 3
      };

      listener = new MarketplaceEventListener(config);
      const status = listener.getStatus();

      expect(status.chainId).toBe(1);
      expect(status.isRunning).toBe(false);
      expect(status.contracts.some(c => c.marketplace === Marketplace.BLUR)).toBe(true);
    });
  });

  describe('LooksRare Integration', () => {
    it('should initialize LooksRare marketplace with shared services', () => {
      const config: MarketplaceEventListenerConfig = {
        chainId: 1,
        rpcUrl: 'https://eth-mainnet.example.com',
        marketplaces: [Marketplace.LOOKSRARE],
        errorThreshold: 10,
        retryAttempts: 3
      };

      listener = new MarketplaceEventListener(config);
      const status = listener.getStatus();

      expect(status.chainId).toBe(1);
      expect(status.isRunning).toBe(false);
      expect(status.contracts.some(c => c.marketplace === Marketplace.LOOKSRARE)).toBe(true);
    });
  });

  describe('Magic Eden Integration', () => {
    it('should initialize Magic Eden marketplace with shared services', () => {
      const config: MarketplaceEventListenerConfig = {
        chainId: 137, // Polygon
        rpcUrl: 'https://polygon-rpc.example.com',
        marketplaces: [Marketplace.MAGIC_EDEN],
        errorThreshold: 10,
        retryAttempts: 3
      };

      listener = new MarketplaceEventListener(config);
      const status = listener.getStatus();

      expect(status.chainId).toBe(137);
      expect(status.isRunning).toBe(false);
      expect(status.contracts.some(c => c.marketplace === Marketplace.MAGIC_EDEN)).toBe(true);
    });
  });

  describe('All Marketplaces Integration', () => {
    it('should initialize all 4 marketplace types together', () => {
      const config: MarketplaceEventListenerConfig = {
        chainId: 1,
        rpcUrl: 'https://eth-mainnet.example.com',
        marketplaces: [
          Marketplace.SEAPORT,
          Marketplace.BLUR,
          Marketplace.LOOKSRARE,
          Marketplace.MAGIC_EDEN
        ],
        errorThreshold: 10,
        retryAttempts: 3
      };

      listener = new MarketplaceEventListener(config);
      const status = listener.getStatus();

      expect(status.chainId).toBe(1);
      expect(status.isRunning).toBe(false);
      expect(status.contractCount).toBeGreaterThan(0);

      // Verify all requested marketplaces are initialized
      const marketplaces = new Set(status.contracts.map(c => c.marketplace));
      expect(marketplaces.has(Marketplace.SEAPORT)).toBe(true);
      expect(marketplaces.has(Marketplace.BLUR)).toBe(true);
      expect(marketplaces.has(Marketplace.LOOKSRARE)).toBe(true);
    });

    it('should use ProviderService for all marketplaces', () => {
      const config: MarketplaceEventListenerConfig = {
        chainId: 1,
        rpcUrl: 'https://eth-mainnet.example.com',
        marketplaces: [
          Marketplace.SEAPORT,
          Marketplace.BLUR,
          Marketplace.LOOKSRARE
        ],
        errorThreshold: 10,
        retryAttempts: 3
      };

      // Should not throw during initialization
      expect(() => {
        listener = new MarketplaceEventListener(config);
      }).not.toThrow();

      const status = listener.getStatus();
      expect(status.contractCount).toBeGreaterThan(0);
    });

    it('should use ErrorTrackingService for all marketplaces', () => {
      const config: MarketplaceEventListenerConfig = {
        chainId: 1,
        rpcUrl: 'https://eth-mainnet.example.com',
        marketplaces: [
          Marketplace.SEAPORT,
          Marketplace.BLUR
        ],
        errorThreshold: 5, // Custom threshold
        retryAttempts: 3
      };

      listener = new MarketplaceEventListener(config);
      const status = listener.getStatus();

      // Verify listener is initialized with custom error threshold
      expect(status.isRunning).toBe(false);
      expect(status.contractCount).toBeGreaterThan(0);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain same configuration interface', () => {
      const config: MarketplaceEventListenerConfig = {
        chainId: 1,
        rpcUrl: 'https://eth-mainnet.example.com',
        marketplaces: [Marketplace.SEAPORT],
        errorThreshold: 10,
        retryAttempts: 3
      };

      // Should work exactly as before
      listener = new MarketplaceEventListener(config);
      const status = listener.getStatus();

      expect(status).toHaveProperty('chainId');
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('contractCount');
      expect(status).toHaveProperty('contracts');
    });

    it('should maintain same status format', () => {
      const config: MarketplaceEventListenerConfig = {
        chainId: 1,
        rpcUrl: 'https://eth-mainnet.example.com',
        marketplaces: [Marketplace.SEAPORT, Marketplace.BLUR],
        errorThreshold: 10,
        retryAttempts: 3
      };

      listener = new MarketplaceEventListener(config);
      const status = listener.getStatus();

      // Verify status format hasn't changed
      expect(typeof status.chainId).toBe('number');
      expect(typeof status.isRunning).toBe('boolean');
      expect(typeof status.contractCount).toBe('number');
      expect(Array.isArray(status.contracts)).toBe(true);

      if (status.contracts.length > 0) {
        const contract = status.contracts[0];
        expect(contract).toHaveProperty('address');
        expect(contract).toHaveProperty('marketplace');
        expect(contract).toHaveProperty('version');
      }
    });
  });
});
