import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NFTEventListener, NFTEventListenerConfig, NFTContractConfig } from '../nft-event-listener';

describe('NFTEventListener', () => {
  let listener: NFTEventListener;
  let config: NFTEventListenerConfig;

  beforeEach(() => {
    // Mock configuration for testing
    const contracts: NFTContractConfig[] = [
      {
        address: '0x1234567890123456789012345678901234567890',
        tokenType: 'ERC721',
        chainId: 1
      },
      {
        address: '0x0987654321098765432109876543210987654321',
        tokenType: 'ERC1155',
        chainId: 1
      }
    ];

    config = {
      chainId: 1,
      rpcUrl: 'https://eth-mainnet.example.com',
      contracts,
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
      listener = new NFTEventListener(config);
      const status = listener.getStatus();

      expect(status.chainId).toBe(1);
      expect(status.isRunning).toBe(false);
      expect(status.contractCount).toBe(2);
      expect(status.contracts).toHaveLength(2);
    });

    it('should normalize contract addresses to lowercase', () => {
      listener = new NFTEventListener(config);
      const status = listener.getStatus();

      expect(status.contracts).toContain('0x1234567890123456789012345678901234567890'.toLowerCase());
      expect(status.contracts).toContain('0x0987654321098765432109876543210987654321'.toLowerCase());
    });
  });

  describe('Contract Management', () => {
    beforeEach(() => {
      listener = new NFTEventListener(config);
    });

    it('should add a new contract', async () => {
      const newContract: NFTContractConfig = {
        address: '0xABCDEF1234567890ABCDEF1234567890ABCDEF12',
        tokenType: 'ERC721',
        chainId: 1
      };

      await listener.addContract(newContract);
      const status = listener.getStatus();

      expect(status.contractCount).toBe(3);
      expect(status.contracts).toContain(newContract.address.toLowerCase());
    });

    it('should not add duplicate contract', async () => {
      const duplicateContract: NFTContractConfig = {
        address: '0x1234567890123456789012345678901234567890',
        tokenType: 'ERC721',
        chainId: 1
      };

      await listener.addContract(duplicateContract);
      const status = listener.getStatus();

      // Should still be 2 contracts
      expect(status.contractCount).toBe(2);
    });

    it('should remove a contract', async () => {
      await listener.removeContract('0x1234567890123456789012345678901234567890');
      const status = listener.getStatus();

      expect(status.contractCount).toBe(1);
      expect(status.contracts).not.toContain('0x1234567890123456789012345678901234567890'.toLowerCase());
    });

    it('should handle removing non-existent contract', async () => {
      await listener.removeContract('0xNONEXISTENT1234567890123456789012345678');
      const status = listener.getStatus();

      // Should still have 2 contracts
      expect(status.contractCount).toBe(2);
    });
  });

  describe('Status', () => {
    it('should return correct status when not running', () => {
      listener = new NFTEventListener(config);
      const status = listener.getStatus();

      expect(status.isRunning).toBe(false);
      expect(status.chainId).toBe(1);
      expect(status.contractCount).toBe(2);
    });
  });
});
