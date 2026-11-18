/**
 * Property-Based Tests for Metadata Mapper
 * 
 * Tests universal properties that should hold for all valid inputs
 * using fast-check for property-based testing
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  mapNFTMetadata,
  extractAttributes,
  normalizeAttribute,
  mapContractMetadata,
  mergeNFTData,
} from '../alchemy-metadata-mapper';
import type { NFTMetadata, ContractMetadata } from '../../types/alchemy';

// ============================================================================
// Arbitraries (Generators for test data)
// ============================================================================

const ethereumAddressArb = fc.array(fc.integer({ min: 0, max: 15 }), { minLength: 40, maxLength: 40 })
  .map(arr => `0x${arr.map(n => n.toString(16)).join('')}`);

const tokenIdArb = fc.oneof(
  fc.integer({ min: 0, max: 1000000 }).map(String),
  fc.string({ minLength: 1, maxLength: 20 })
);

const tokenTypeArb = fc.constantFrom('ERC721', 'ERC1155', 'UNKNOWN');

const imageDataArb = fc.record({
  cachedUrl: fc.option(fc.constant('https://example.com/image.png'), { nil: undefined }),
  thumbnailUrl: fc.option(fc.constant('https://example.com/thumb.png'), { nil: undefined }),
  pngUrl: fc.option(fc.constant('https://example.com/image.png'), { nil: undefined }),
  contentType: fc.option(fc.constantFrom('image/png', 'image/jpeg'), { nil: undefined }),
  size: fc.option(fc.integer({ min: 0, max: 1000000 }), { nil: undefined }),
  originalUrl: fc.option(fc.constant('https://example.com/original.png'), { nil: undefined }),
});

const rawMetadataArb = fc.record({
  metadata: fc.option(fc.dictionary(fc.string(), fc.string()), { nil: undefined }),
  tokenUri: fc.option(fc.constant('https://example.com/token/1'), { nil: undefined }),
});

const attributeArb = fc.record({
  trait_type: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  traitType: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  value: fc.oneof(fc.string(), fc.integer(), fc.double()),
  display_type: fc.option(fc.constantFrom('number', 'date', 'boost_percentage'), { nil: undefined }),
}, { requiredKeys: [] });

const nftMetadataArb = fc.record({
  contract: fc.record({
    address: ethereumAddressArb,
    name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    symbol: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  }),
  tokenId: tokenIdArb,
  tokenType: fc.option(tokenTypeArb, { nil: undefined }),
  name: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
  description: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
  image: fc.option(imageDataArb, { nil: undefined }),
  raw: fc.option(rawMetadataArb, { nil: undefined }),
  tokenUri: fc.option(fc.constant('https://example.com/token/1'), { nil: undefined }),
});

const contractMetadataArb = fc.record({
  address: ethereumAddressArb,
  name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  symbol: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  totalSupply: fc.option(fc.integer({ min: 0, max: 100000 }).map(String), { nil: undefined }),
  tokenType: fc.option(tokenTypeArb, { nil: undefined }),
  openSeaMetadata: fc.option(fc.record({
    floorPrice: fc.option(fc.double({ min: 0, max: 100 }), { nil: undefined }),
    collectionName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    collectionSlug: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  }), { nil: undefined }),
});

// ============================================================================
// Property 5: Raw Metadata Preservation
// ============================================================================

describe('Property 5: Raw Metadata Preservation', () => {
  it('should preserve raw metadata when storing and retrieving', () => {
    fc.assert(
      fc.property(nftMetadataArb, fc.integer({ min: 1, max: 10 }), (alchemyData, chainId) => {
        const mapped = mapNFTMetadata(alchemyData, chainId);
        
        if (alchemyData.raw?.metadata) {
          expect(mapped.rawMetadata).toBeDefined();
          expect(mapped.rawMetadata).toEqual(alchemyData.raw.metadata);
        }
        
        if (alchemyData.raw?.tokenUri) {
          expect(mapped.rawTokenUri).toBe(alchemyData.raw.tokenUri);
        }
        
        return true;
      }),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 37: Alchemy Data Mapping
// ============================================================================

describe('Property 37: Alchemy Data Mapping', () => {
  it('should preserve all data fields when mapping to database', () => {
    fc.assert(
      fc.property(nftMetadataArb, fc.integer({ min: 1, max: 10 }), (alchemyData, chainId) => {
        const mapped = mapNFTMetadata(alchemyData, chainId);
        
        expect(mapped.chainId).toBe(chainId);
        expect(mapped.contractAddress).toBe(alchemyData.contract.address.toLowerCase());
        expect(mapped.tokenId).toBe(alchemyData.tokenId);
        
        if (alchemyData.name) {
          expect(mapped.name).toBe(alchemyData.name);
        }
        
        if (alchemyData.image?.cachedUrl) {
          expect(mapped.imageCachedUrl).toBe(alchemyData.image.cachedUrl);
        }
        
        return true;
      }),
      { numRuns: 20 }
    );
  });

  it('should normalize addresses to lowercase', () => {
    fc.assert(
      fc.property(
        ethereumAddressArb,
        tokenIdArb,
        fc.integer({ min: 1, max: 10 }),
        (address, tokenId, chainId) => {
          const alchemyData: NFTMetadata = {
            contract: { address: address.toUpperCase() },
            tokenId,
          };
          
          const mapped = mapNFTMetadata(alchemyData, chainId);
          expect(mapped.contractAddress).toBe(address.toLowerCase());
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 1: Complete NFT Data Storage
// ============================================================================

describe('Property 1: Complete NFT Data Storage', () => {
  it('should store all required fields for any indexed NFT', () => {
    fc.assert(
      fc.property(nftMetadataArb, fc.integer({ min: 1, max: 10 }), (alchemyData, chainId) => {
        const mapped = mapNFTMetadata(alchemyData, chainId);
        
        expect(mapped.chainId).toBeDefined();
        expect(mapped.contractAddress).toBeDefined();
        expect(mapped.tokenId).toBeDefined();
        expect(mapped.tokenType).toBeDefined();
        expect(mapped.timeLastUpdated).toBeInstanceOf(Date);
        expect(mapped.isSpam).toBeDefined();
        expect(mapped.isAirdrop).toBeDefined();
        expect(mapped.contractAddress).toMatch(/^0x[a-f0-9]{40}$/);
        
        return true;
      }),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 2: Complete Image Data Storage
// ============================================================================

describe('Property 2: Complete Image Data Storage', () => {
  it('should store all image fields when image metadata exists', () => {
    fc.assert(
      fc.property(
        ethereumAddressArb,
        tokenIdArb,
        imageDataArb,
        fc.integer({ min: 1, max: 10 }),
        (address, tokenId, imageData, chainId) => {
          const alchemyData: NFTMetadata = {
            contract: { address },
            tokenId,
            image: imageData,
          };
          
          const mapped = mapNFTMetadata(alchemyData, chainId);
          
          if (imageData.cachedUrl) {
            expect(mapped.imageCachedUrl).toBe(imageData.cachedUrl);
          }
          
          if (imageData.size !== undefined) {
            expect(mapped.imageSize).toBe(imageData.size);
          }
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 3: Complete Attribute Storage
// ============================================================================

describe('Property 3: Complete Attribute Storage', () => {
  it('should store each attribute with trait type and value', () => {
    fc.assert(
      fc.property(
        fc.array(attributeArb, { minLength: 1, maxLength: 10 }),
        (attributes) => {
          const validAttributes = attributes.filter(
            attr => attr.trait_type || attr.traitType
          );
          
          if (validAttributes.length === 0) return true;
          
          const rawMetadata = { attributes: validAttributes };
          const extracted = extractAttributes(rawMetadata);
          
          expect(extracted.length).toBeGreaterThan(0);
          
          for (const attr of extracted) {
            expect(attr.traitType).toBeDefined();
            expect(typeof attr.traitType).toBe('string');
            expect(attr.value).toBeDefined();
          }
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should handle both snake_case and camelCase', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string(),
        (traitType, value) => {
          const snakeCaseAttr = { trait_type: traitType, value };
          const camelCaseAttr = { traitType: traitType, value };
          
          const normalized1 = normalizeAttribute(snakeCaseAttr);
          const normalized2 = normalizeAttribute(camelCaseAttr);
          
          expect(normalized1.traitType).toBe(normalized2.traitType);
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 6: Complete Contract Data Storage
// ============================================================================

describe('Property 6: Complete Contract Data Storage', () => {
  it('should store all required contract fields', () => {
    fc.assert(
      fc.property(contractMetadataArb, fc.integer({ min: 1, max: 10 }), (alchemyData, chainId) => {
        const mapped = mapContractMetadata(alchemyData, chainId);
        
        expect(mapped.chainId).toBe(chainId);
        expect(mapped.address).toBe(alchemyData.address.toLowerCase());
        
        if (alchemyData.name) {
          expect(mapped.name).toBe(alchemyData.name);
        }
        
        return true;
      }),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 8: Complete OpenSea Metadata Storage
// ============================================================================

describe('Property 8: Complete OpenSea Metadata Storage', () => {
  it('should store all OpenSea fields when metadata exists', () => {
    fc.assert(
      fc.property(contractMetadataArb, fc.integer({ min: 1, max: 10 }), (alchemyData, chainId) => {
        const mapped = mapContractMetadata(alchemyData, chainId);
        
        // Floor price can be 0, so check for undefined/null specifically
        if (alchemyData.openSeaMetadata?.floorPrice !== undefined && alchemyData.openSeaMetadata?.floorPrice !== null) {
          expect(mapped.openSeaFloorPrice).toBe(alchemyData.openSeaMetadata.floorPrice);
        } else if (!alchemyData.openSeaMetadata || alchemyData.openSeaMetadata.floorPrice === undefined) {
          expect(mapped.openSeaFloorPrice).toBeNull();
        }
        
        if (alchemyData.openSeaMetadata?.collectionName) {
          expect(mapped.openSeaCollectionName).toBe(alchemyData.openSeaMetadata.collectionName);
        }
        
        return true;
      }),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 43: Attribute Normalization
// ============================================================================

describe('Property 43: Attribute Normalization', () => {
  it('should normalize trait types to consistent format', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
        fc.string(),
        (traitType, value) => {
          const attr = { trait_type: traitType, value };
          const normalized = normalizeAttribute(attr);
          
          expect(normalized.traitType).toBeDefined();
          expect(typeof normalized.traitType).toBe('string');
          // Normalized trait type should not have leading/trailing whitespace
          expect(normalized.traitType).toBe(normalized.traitType.trim());
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Property 46: Numeric Attribute Storage
// ============================================================================

describe('Property 46: Numeric Attribute Storage', () => {
  it('should store numeric values as numbers', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.double({ min: -1000, max: 1000 }),
        (traitType, numericValue) => {
          const attr = {
            trait_type: traitType,
            value: numericValue,
            display_type: 'number',
          };
          
          const normalized = normalizeAttribute(attr);
          
          expect(normalized.numericValue).toBeDefined();
          expect(typeof normalized.numericValue).toBe('number');
          
          return true;
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ============================================================================
// Merge NFT Data Property
// ============================================================================

describe('Merge NFT Data', () => {
  it('should preserve existing values when new values are null', () => {
    fc.assert(
      fc.property(
        nftMetadataArb,
        nftMetadataArb,
        fc.integer({ min: 1, max: 10 }),
        (existingData, newData, chainId) => {
          const existing = mapNFTMetadata(existingData, chainId);
          const newMapped = mapNFTMetadata(newData, chainId);
          
          const merged = mergeNFTData(existing, newMapped);
          
          expect(merged.chainId).toBeDefined();
          expect(merged.contractAddress).toBeDefined();
          expect(merged.tokenId).toBeDefined();
          
          return true;
        }
      ),
      { numRuns: 10 }
    );
  });
});
