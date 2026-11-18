import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MarketplaceEventListener, MarketplaceEventListenerConfig } from '../marketplace-event-listener';
import { Marketplace } from '@prisma/client';

describe('MarketplaceEventListener', () => {
  let listener: MarketplaceEventListener;
  let config: MarketplaceEventListenerConfig;

  beforeEach(() => {
    // Mock configuration for testing
    config = {
      chainId: 1,
      rpcUrl: 'https://eth-mainnet.example.com',
      marketplaces: [Marketplace.SEAPORT, Marketplace.BLUR],
      errorThreshold: 5,
      retryAttempts: 3
    };
  });

  afterEach(async () => {
    if (listener) {
      try {
        await listener.stop();
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  });

  describe('Initialization', () => {
    it('should initialize with correct configuration', () => {
      listener = new MarketplaceEventListener(config);
      const status = listener.getStatus();

      expect(status.chainId).toBe(1);
      expect(status.isRunning).toBe(false);
      expect(status.contractCount).toBeGreaterThan(0);
    });

    it('should only initialize contracts for requested marketplaces', () => {
      listener = new MarketplaceEventListener(config);
      const status = listener.getStatus();

      // Should only have Seaport and Blur contracts
      const marketplaces = status.contracts.map(c => c.marketplace);
      expect(marketplaces).toContain(Marketplace.SEAPORT);
      expect(marketplaces).toContain(Marketplace.BLUR);
      expect(marketplaces).not.toContain(Marketplace.LOOKSRARE);
      expect(marketplaces).not.toContain(Marketplace.MAGIC_EDEN);
    });

    it('should initialize with all marketplaces when requested', () => {
      const allMarketplacesConfig: MarketplaceEventListenerConfig = {
        chainId: 1,
        rpcUrl: 'https://eth-mainnet.example.com',
        marketplaces: [
          Marketplace.SEAPORT,
          Marketplace.BLUR,
          Marketplace.LOOKSRARE,
          Marketplace.X2Y2,
          Marketplace.RARIBLE
        ],
        errorThreshold: 5,
        retryAttempts: 3
      };

      listener = new MarketplaceEventListener(allMarketplacesConfig);
      const status = listener.getStatus();

      expect(status.contractCount).toBeGreaterThan(0);
      const marketplaces = new Set(status.contracts.map(c => c.marketplace));
      expect(marketplaces.size).toBeGreaterThan(1);
    });
  });

  describe('Status', () => {
    beforeEach(() => {
      listener = new MarketplaceEventListener(config);
    });

    it('should return correct status', () => {
      const status = listener.getStatus();

      expect(status).toHaveProperty('chainId');
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('contractCount');
      expect(status).toHaveProperty('contracts');
      expect(Array.isArray(status.contracts)).toBe(true);
    });

    it('should include contract details in status', () => {
      const status = listener.getStatus();

      if (status.contracts.length > 0) {
        const contract = status.contracts[0];
        expect(contract).toHaveProperty('address');
        expect(contract).toHaveProperty('marketplace');
        expect(contract).toHaveProperty('version');
      }
    });
  });

  describe('Multi-chain Support', () => {
    it('should support Polygon chain', () => {
      const polygonConfig: MarketplaceEventListenerConfig = {
        chainId: 137,
        rpcUrl: 'https://polygon-rpc.example.com',
        marketplaces: [Marketplace.SEAPORT, Marketplace.MAGIC_EDEN],
        errorThreshold: 5,
        retryAttempts: 3
      };

      listener = new MarketplaceEventListener(polygonConfig);
      const status = listener.getStatus();

      expect(status.chainId).toBe(137);
      expect(status.contractCount).toBeGreaterThan(0);
    });

    it('should support Base chain', () => {
      const baseConfig: MarketplaceEventListenerConfig = {
        chainId: 8453,
        rpcUrl: 'https://base-rpc.example.com',
        marketplaces: [Marketplace.SEAPORT, Marketplace.MAGIC_EDEN],
        errorThreshold: 5,
        retryAttempts: 3
      };

      listener = new MarketplaceEventListener(baseConfig);
      const status = listener.getStatus();

      expect(status.chainId).toBe(8453);
      expect(status.contractCount).toBeGreaterThan(0);
    });
  });
});
