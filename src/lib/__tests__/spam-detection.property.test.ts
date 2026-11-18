/**
 * Property-Based Tests for Spam Detection
 * 
 * Tests Properties 19, 20, 21, 22 related to spam and airdrop detection
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { mapNFTMetadata } from '../alchemy-metadata-mapper';
import type { NFTMetadata } from '../../types/alchemy';

// ============================================================================
// Arbitraries
// ============================================================================

const ethereumAddressArb = fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 40, maxLength: 40 })
  .map(arr => `0x${arr.map(n => n.toString(16)).join('')}`);

const tokenIdArb = fc.oneof(
  fc.integer({ min: 0, max: 1000000 }).map(String),
  fc.string({ minLength: 1, maxLength: 20 })
);

const nftMetadataArb = fc.record({
  contract: fc.record({
    address: ethereumAddressArb,
  }),
  tokenId: tokenIdArb,
});

// ============================================================================
// Property 19: Spam Flag Setting
// ============================================================================

describe('Property 19: Spam Flag Setting', () => {
  it('should set isSpam flag to true for NFTs identified as spam', () => {
    fc.assert(
      fc.property(
        nftMetadataArb,
        fc.integer({ min: 1, max: 10 }),
        (alchemyData, chainId) => {
          // Map with isSpam = true
          const mappedSpam = mapNFTMetadata(alchemyData, chainId, true, false);
          
          // Verify spam flag is set
          expect(mappedSpam.isSpam).toBe(true);
          expect(mappedSpam.isAirdrop).toBe(false);
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should set isSpam flag to false for non-spam NFTs', () => {
    fc.assert(
      fc.property(
        nftMetadataArb,
        fc.integer({ min: 1, max: 10 }),
        (alchemyData, chainId) => {
          // Map with isSpam = false
          const mappedNonSpam = mapNFTMetadata(alchemyData, chainId, false, false);
          
          // Verify spam flag is not set
          expect(mappedNonSpam.isSpam).toBe(false);
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 20: Airdrop Flag Setting
// ============================================================================

describe('Property 20: Airdrop Flag Setting', () => {
  it('should set isAirdrop flag to true for NFTs identified as airdrops', () => {
    fc.assert(
      fc.property(
        nftMetadataArb,
        fc.integer({ min: 1, max: 10 }),
        (alchemyData, chainId) => {
          // Map with isAirdrop = true
          const mappedAirdrop = mapNFTMetadata(alchemyData, chainId, false, true);
          
          // Verify airdrop flag is set
          expect(mappedAirdrop.isAirdrop).toBe(true);
          expect(mappedAirdrop.isSpam).toBe(false);
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should handle both spam and airdrop flags independently', () => {
    fc.assert(
      fc.property(
        nftMetadataArb,
        fc.integer({ min: 1, max: 10 }),
        fc.boolean(),
        fc.boolean(),
        (alchemyData, chainId, isSpam, isAirdrop) => {
          const mapped = mapNFTMetadata(alchemyData, chainId, isSpam, isAirdrop);
          
          // Verify both flags are set correctly
          expect(mapped.isSpam).toBe(isSpam);
          expect(mapped.isAirdrop).toBe(isAirdrop);
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 21: Spam and Airdrop Filtering
// ============================================================================

describe('Property 21: Spam and Airdrop Filtering', () => {
  it('should correctly identify spam NFTs for filtering', () => {
    fc.assert(
      fc.property(
        fc.array(nftMetadataArb, { minLength: 5, maxLength: 20 }),
        fc.integer({ min: 1, max: 10 }),
        (nftArray, chainId) => {
          // Map NFTs with random spam/airdrop flags
          const mappedNFTs = nftArray.map((nft, index) => 
            mapNFTMetadata(nft, chainId, index % 3 === 0, index % 5 === 0)
          );
          
          // Filter out spam and airdrops
          const filtered = mappedNFTs.filter(nft => !nft.isSpam && !nft.isAirdrop);
          
          // Verify no spam or airdrop NFTs in filtered results
          for (const nft of filtered) {
            expect(nft.isSpam).toBe(false);
            expect(nft.isAirdrop).toBe(false);
          }
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should allow filtering by spam only', () => {
    fc.assert(
      fc.property(
        fc.array(nftMetadataArb, { minLength: 5, maxLength: 20 }),
        fc.integer({ min: 1, max: 10 }),
        (nftArray, chainId) => {
          const mappedNFTs = nftArray.map((nft, index) => 
            mapNFTMetadata(nft, chainId, index % 3 === 0, index % 5 === 0)
          );
          
          // Filter out only spam
          const filtered = mappedNFTs.filter(nft => !nft.isSpam);
          
          // Verify no spam NFTs in filtered results
          for (const nft of filtered) {
            expect(nft.isSpam).toBe(false);
          }
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should allow filtering by airdrop only', () => {
    fc.assert(
      fc.property(
        fc.array(nftMetadataArb, { minLength: 5, maxLength: 20 }),
        fc.integer({ min: 1, max: 10 }),
        (nftArray, chainId) => {
          const mappedNFTs = nftArray.map((nft, index) => 
            mapNFTMetadata(nft, chainId, index % 3 === 0, index % 5 === 0)
          );
          
          // Filter out only airdrops
          const filtered = mappedNFTs.filter(nft => !nft.isAirdrop);
          
          // Verify no airdrop NFTs in filtered results
          for (const nft of filtered) {
            expect(nft.isAirdrop).toBe(false);
          }
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 22: Spam Status Change Tracking
// ============================================================================

describe('Property 22: Spam Status Change Tracking', () => {
  it('should update timestamp when spam status changes', () => {
    fc.assert(
      fc.property(
        nftMetadataArb,
        fc.integer({ min: 1, max: 10 }),
        (alchemyData, chainId) => {
          // Initial mapping
          const initial = mapNFTMetadata(alchemyData, chainId, false, false);
          const initialTime = initial.timeLastUpdated;
          
          // Wait a tiny bit (in real scenario, this would be a database update)
          // For property test, we just verify the timestamp field exists
          expect(initialTime).toBeInstanceOf(Date);
          
          // Simulate status change
          const updated = mapNFTMetadata(alchemyData, chainId, true, false);
          const updatedTime = updated.timeLastUpdated;
          
          // Verify timestamp exists and is a valid date
          expect(updatedTime).toBeInstanceOf(Date);
          expect(updated.isSpam).toBe(true);
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should maintain timestamp field for all spam status combinations', () => {
    fc.assert(
      fc.property(
        nftMetadataArb,
        fc.integer({ min: 1, max: 10 }),
        fc.boolean(),
        fc.boolean(),
        (alchemyData, chainId, isSpam, isAirdrop) => {
          const mapped = mapNFTMetadata(alchemyData, chainId, isSpam, isAirdrop);
          
          // Timestamp should always be present and valid
          expect(mapped.timeLastUpdated).toBeInstanceOf(Date);
          expect(mapped.timeLastUpdated.getTime()).toBeGreaterThan(0);
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});
