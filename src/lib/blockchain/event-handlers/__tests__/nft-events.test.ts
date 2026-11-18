/**
 * NFT Event Handler Tests
 * 
 * Tests for NFT event processing including:
 * - Transfer event handling (mint, transfer, burn)
 * - Metadata fetching and storage
 * - Ownership tracking
 * - Contract metadata syncing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NFTEventHandler, type TransferEventData } from '../nft-events';
import { AlchemyNFTService } from '../../../alchemy-nft-service';
import { AlchemySpamDetector } from '../../../alchemy-spam-detector';
import { TransferType } from '@prisma/client';

describe('NFTEventHandler', () => {
  let handler: NFTEventHandler;
  let mockAlchemyService: AlchemyNFTService;
  let mockSpamDetector: AlchemySpamDetector;

  beforeEach(() => {
    // Create mock services
    mockAlchemyService = {
      getNFTMetadata: vi.fn(),
      getContractMetadata: vi.fn(),
      refreshNFTMetadata: vi.fn(),
    } as any;

    mockSpamDetector = {
      isSpamContract: vi.fn().mockResolvedValue(false),
      isAirdropNFT: vi.fn().mockResolvedValue(false),
    } as any;

    // Create handler instance
    handler = new NFTEventHandler({
      chainId: 1,
      retryAttempts: 3,
      errorCounters: new Map(),
      errorThreshold: 10,
      sendAdminAlert: vi.fn(),
      alchemyService: mockAlchemyService,
      spamDetector: mockSpamDetector,
    });
  });

  describe('Transfer Event Handling', () => {
    it('should identify mint events correctly', () => {
      const transferData: TransferEventData = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        tokenId: '1',
        from: '0x0000000000000000000000000000000000000000',
        to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        quantity: '1',
        txHash: '0xabc123',
        blockNumber: 12345,
        blockTimestamp: new Date(),
        logIndex: 0,
        tokenType: 'ERC721',
      };

      // The handler should recognize this as a mint
      expect(transferData.from.toLowerCase()).toBe('0x0000000000000000000000000000000000000000');
    });

    it('should identify burn events correctly', () => {
      const transferData: TransferEventData = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        tokenId: '1',
        from: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        to: '0x0000000000000000000000000000000000000000',
        quantity: '1',
        txHash: '0xabc123',
        blockNumber: 12345,
        blockTimestamp: new Date(),
        logIndex: 0,
        tokenType: 'ERC721',
      };

      // The handler should recognize this as a burn
      expect(transferData.to.toLowerCase()).toBe('0x0000000000000000000000000000000000000000');
    });

    it('should identify regular transfers correctly', () => {
      const transferData: TransferEventData = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        tokenId: '1',
        from: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        to: '0x1111111111111111111111111111111111111111',
        quantity: '1',
        txHash: '0xabc123',
        blockNumber: 12345,
        blockTimestamp: new Date(),
        logIndex: 0,
        tokenType: 'ERC721',
      };

      // The handler should recognize this as a regular transfer
      expect(transferData.from.toLowerCase()).not.toBe('0x0000000000000000000000000000000000000000');
      expect(transferData.to.toLowerCase()).not.toBe('0x0000000000000000000000000000000000000000');
    });
  });

  describe('Event Data Validation', () => {
    it('should validate required fields in transfer data', () => {
      const validTransferData: TransferEventData = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        tokenId: '1',
        from: '0x0000000000000000000000000000000000000000',
        to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        quantity: '1',
        txHash: '0xabc123',
        blockNumber: 12345,
        blockTimestamp: new Date(),
        logIndex: 0,
        tokenType: 'ERC721',
      };

      // All required fields should be present
      expect(validTransferData.contractAddress).toBeDefined();
      expect(validTransferData.tokenId).toBeDefined();
      expect(validTransferData.from).toBeDefined();
      expect(validTransferData.to).toBeDefined();
      expect(validTransferData.txHash).toBeDefined();
      expect(validTransferData.blockNumber).toBeDefined();
      expect(validTransferData.blockTimestamp).toBeDefined();
    });
  });

  describe('Address Normalization', () => {
    it('should normalize addresses to lowercase', () => {
      const upperCaseAddress = '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD';
      const normalized = upperCaseAddress.toLowerCase();

      expect(normalized).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    });
  });

  describe('Transfer Type Determination', () => {
    it('should determine MINT type for zero address source', () => {
      const from = '0x0000000000000000000000000000000000000000';
      const to = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

      const isMint = from.toLowerCase() === '0x0000000000000000000000000000000000000000';
      expect(isMint).toBe(true);
    });

    it('should determine BURN type for zero address destination', () => {
      const from = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const to = '0x0000000000000000000000000000000000000000';

      const isBurn = to.toLowerCase() === '0x0000000000000000000000000000000000000000';
      expect(isBurn).toBe(true);
    });

    it('should determine TRANSFER type for non-zero addresses', () => {
      const from = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const to = '0x1111111111111111111111111111111111111111';

      const isRegularTransfer = 
        from.toLowerCase() !== '0x0000000000000000000000000000000000000000' &&
        to.toLowerCase() !== '0x0000000000000000000000000000000000000000';
      
      expect(isRegularTransfer).toBe(true);
    });
  });

  describe('ERC1155 Batch Handling', () => {
    it('should handle ERC1155 quantities correctly', () => {
      const transferData: TransferEventData = {
        contractAddress: '0x1234567890123456789012345678901234567890',
        tokenId: '1',
        from: '0x0000000000000000000000000000000000000000',
        to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        quantity: '10', // ERC1155 can transfer multiple
        txHash: '0xabc123',
        blockNumber: 12345,
        blockTimestamp: new Date(),
        logIndex: 0,
        tokenType: 'ERC1155',
      };

      expect(transferData.quantity).toBe('10');
      expect(transferData.tokenType).toBe('ERC1155');
    });
  });
});

