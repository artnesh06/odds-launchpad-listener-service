/**
 * Task 8.2: Ensure polling continues for non-mint events
 * 
 * This test suite verifies that the existing polling mechanism continues to work
 * for all non-mint events and for all events on non-featured launchpads.
 * The WebSocket system should only handle mint events on featured launchpads;
 * everything else should continue using polling.
 * 
 * Requirements: 3.2, 3.3, 3.4, 3.5, 4.1
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ethers } from 'ethers';
import { prisma } from '../../../config/database';
import { NFTEventListener } from '../nft-event-listener';
import { MarketplaceEventListener } from '../marketplace-event-listener';
import { ActivityListener } from '../activity-listener';
import { Marketplace } from '@prisma/client';

describe('Task 8.2: Polling Continuation for Non-Mint Events', () => {
  // Test configuration
  const TEST_CHAIN_ID = 1;
  const TEST_RPC_URL = 'https://eth-mainnet.example.com';
  const TEST_FACTORY_ADDRESS = '0x1234567890123456789012345678901234567890';
  const TEST_NFT_CONTRACT = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const TEST_MARKETPLACE_CONTRACT = '0x9876543210987654321098765432109876543210';
  const TEST_LAUNCHPAD_ADDRESS = '0x1111111111111111111111111111111111111111';

  describe('Requirement 3.2: Transfer Events Use Polling', () => {
    let nftListener: NFTEventListener;

    beforeEach(() => {
      // Create NFT event listener with HTTP provider (polling)
      nftListener = new NFTEventListener({
        chainId: TEST_CHAIN_ID,
        rpcUrl: TEST_RPC_URL,
        contracts: [
          {
            address: TEST_NFT_CONTRACT,
            tokenType: 'ERC721',
            chainId: TEST_CHAIN_ID
          }
        ]
      });
    });

    afterEach(async () => {
      if (nftListener) {
        await nftListener.stop();
      }
    });

    it('should use HTTP provider for Transfer events (polling)', () => {
      // Verify that NFTEventListener uses HTTP provider, not WebSocket
      const listener = nftListener as any;
      const provider = listener.provider;

      // HTTP providers are JsonRpcProvider instances
      expect(provider).toBeInstanceOf(ethers.JsonRpcProvider);
      expect(provider).not.toBeInstanceOf(ethers.WebSocketProvider);

      // Verify polling interval is set (indicates polling mode)
      expect(provider.pollingInterval).toBeDefined();
      expect(provider.pollingInterval).toBeGreaterThan(0);
    });

    it('should listen to Transfer events via polling mechanism', async () => {
      // Start the listener
      await nftLi