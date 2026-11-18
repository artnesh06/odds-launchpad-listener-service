import { describe, it, expect } from 'vitest';
import {
  getMarketplaceContractsForChain,
  getContractAddressesForMarketplace,
  getMarketplaceByAddress,
  isMarketplaceContract,
  getSupportedMarketplaces,
  getChainsForMarketplace,
  MARKETPLACE_CONTRACTS
} from '../marketplace-contracts';
import { Marketplace } from '@prisma/client';

describe('Marketplace Contract Registry', () => {
  describe('getMarketplaceContractsForChain', () => {
    it('should return contracts for Ethereum mainnet', () => {
      const contracts = getMarketplaceContractsForChain(1);
      
      expect(contracts.length).toBeGreaterThan(0);
      expect(contracts.some(c => c.marketplace === Marketplace.SEAPORT)).toBe(true);
      expect(contracts.some(c => c.marketplace === Marketplace.BLUR)).toBe(true);
      expect(contracts.some(c => c.marketplace === Marketplace.LOOKSRARE)).toBe(true);
    });

    it('should return contracts for Polygon', () => {
      const contracts = getMarketplaceContractsForChain(137);
      
      expect(contracts.length).toBeGreaterThan(0);
      expect(contracts.some(c => c.marketplace === Marketplace.SEAPORT)).toBe(true);
      expect(contracts.some(c => c.marketplace === Marketplace.MAGIC_EDEN)).toBe(true);
    });

    it('should return empty array for unsupported chain', () => {
      const contracts = getMarketplaceContractsForChain(99999);
      
      expect(contracts).toEqual([]);
    });
  });

  describe('getContractAddressesForMarketplace', () => {
    it('should return Seaport addresses across all chains', () => {
      const addresses = getContractAddressesForMarketplace(Marketplace.SEAPORT);
      
      expect(addresses.size).toBeGreaterThan(0);
      expect(addresses.has(1)).toBe(true); // Ethereum
      expect(addresses.has(137)).toBe(true); // Polygon
    });

    it('should return Blur addresses', () => {
      const addresses = getContractAddressesForMarketplace(Marketplace.BLUR);
      
      expect(addresses.size).toBeGreaterThan(0);
      expect(addresses.has(1)).toBe(true); // Ethereum
    });

    it('should normalize addresses to lowercase', () => {
      const addresses = getContractAddressesForMarketplace(Marketplace.SEAPORT);
      
      for (const [, chainAddresses] of addresses) {
        for (const address of chainAddresses) {
          expect(address).toBe(address.toLowerCase());
        }
      }
    });
  });

  describe('getMarketplaceByAddress', () => {
    it('should find Seaport 1.5 on Ethereum', () => {
      const config = getMarketplaceByAddress(1, '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC');
      
      expect(config).toBeDefined();
      expect(config?.marketplace).toBe(Marketplace.SEAPORT);
      expect(config?.version).toBe('1.5');
    });

    it('should be case-insensitive', () => {
      const config = getMarketplaceByAddress(1, '0x00000000000000adc04c56bf30ac9d3c0aaf14dc');
      
      expect(config).toBeDefined();
      expect(config?.marketplace).toBe(Marketplace.SEAPORT);
    });

    it('should return undefined for unknown address', () => {
      const config = getMarketplaceByAddress(1, '0x0000000000000000000000000000000000000000');
      
      expect(config).toBeUndefined();
    });

    it('should return undefined for wrong chain', () => {
      const config = getMarketplaceByAddress(99999, '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC');
      
      expect(config).toBeUndefined();
    });
  });

  describe('isMarketplaceContract', () => {
    it('should return true for known marketplace contract', () => {
      const result = isMarketplaceContract(1, '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC');
      
      expect(result).toBe(true);
    });

    it('should return false for unknown contract', () => {
      const result = isMarketplaceContract(1, '0x0000000000000000000000000000000000000000');
      
      expect(result).toBe(false);
    });

    it('should be case-insensitive', () => {
      const result = isMarketplaceContract(1, '0x00000000000000adc04c56bf30ac9d3c0aaf14dc');
      
      expect(result).toBe(true);
    });
  });

  describe('getSupportedMarketplaces', () => {
    it('should return all marketplaces for Ethereum', () => {
      const marketplaces = getSupportedMarketplaces(1);
      
      expect(marketplaces.length).toBeGreaterThan(0);
      expect(marketplaces).toContain(Marketplace.SEAPORT);
      expect(marketplaces).toContain(Marketplace.BLUR);
      expect(marketplaces).toContain(Marketplace.LOOKSRARE);
    });

    it('should return unique marketplaces only', () => {
      const marketplaces = getSupportedMarketplaces(1);
      const uniqueMarketplaces = new Set(marketplaces);
      
      expect(marketplaces.length).toBe(uniqueMarketplaces.size);
    });

    it('should return empty array for unsupported chain', () => {
      const marketplaces = getSupportedMarketplaces(99999);
      
      expect(marketplaces).toEqual([]);
    });
  });

  describe('getChainsForMarketplace', () => {
    it('should return all chains supporting Seaport', () => {
      const chains = getChainsForMarketplace(Marketplace.SEAPORT);
      
      expect(chains.length).toBeGreaterThan(0);
      expect(chains).toContain(1); // Ethereum
      expect(chains).toContain(137); // Polygon
      expect(chains).toContain(8453); // Base
    });

    it('should return chains supporting Blur', () => {
      const chains = getChainsForMarketplace(Marketplace.BLUR);
      
      expect(chains.length).toBeGreaterThan(0);
      expect(chains).toContain(1); // Ethereum
    });

    it('should return empty array for unsupported marketplace', () => {
      const chains = getChainsForMarketplace(Marketplace.UNKNOWN);
      
      expect(chains).toEqual([]);
    });
  });

  describe('Contract Configuration Validation', () => {
    it('should have valid structure for all configurations', () => {
      for (const chainConfig of MARKETPLACE_CONTRACTS) {
        expect(chainConfig).toHaveProperty('chainId');
        expect(chainConfig).toHaveProperty('chainName');
        expect(chainConfig).toHaveProperty('contracts');
        expect(Array.isArray(chainConfig.contracts)).toBe(true);
        
        for (const contract of chainConfig.contracts) {
          expect(contract).toHaveProperty('marketplace');
          expect(contract).toHaveProperty('version');
          expect(contract).toHaveProperty('address');
          expect(contract.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        }
      }
    });

    it('should have unique chain IDs', () => {
      const chainIds = MARKETPLACE_CONTRACTS.map(c => c.chainId);
      const uniqueChainIds = new Set(chainIds);
      
      expect(chainIds.length).toBe(uniqueChainIds.size);
    });

    it('should have valid Ethereum addresses', () => {
      for (const chainConfig of MARKETPLACE_CONTRACTS) {
        for (const contract of chainConfig.contracts) {
          expect(contract.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        }
      }
    });
  });
});
