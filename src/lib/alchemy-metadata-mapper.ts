/**
 * Alchemy Metadata Mapper
 * 
 * Maps Alchemy API responses to database schema
 * Handles attribute extraction, normalization, and image processing
 */

import { Prisma } from '@prisma/client';
import type {
  NFTMetadata,
  ContractMetadata,
  NFTAttributeSummary,
  NFTRarity,
} from '../types/alchemy';
import { ipfsToHttpOptimized, convertIpfsToHttp } from '../utils/ipfs-helpers';

// ============================================================================
// Type Definitions
// ============================================================================

export interface MappedNFTData {
  chainId: number;
  contractAddress: string;
  tokenId: string;
  tokenType: string;
  name: string | null;
  description: string | null;
  tokenUri: string | null;
  
  // Image data
  imageCachedUrl: string | null;
  imageThumbnailUrl: string | null;
  imagePngUrl: string | null;
  imageContentType: string | null;
  imageSize: number | null;
  imageOriginalUrl: string | null;
  
  // Raw metadata
  rawMetadata: Prisma.JsonValue | null;
  rawTokenUri: string | null;
  
  // Timestamps
  timeLastUpdated: Date;
  acquiredBlockTimestamp: Date | null;
  acquiredBlockNumber: number | null;
  
  // Mint info
  mintAddress: string | null;
  mintBlockNumber: number | null;
  mintTimestamp: Date | null;
  mintTransactionHash: string | null;
  
  // Spam detection
  isSpam: boolean;
  isAirdrop: boolean;
}

export interface MappedAttribute {
  traitType: string;
  value: string;
  displayType: string | null;
  numericValue: number | null;
  prevalence: number | null;
  count: number | null;
}

export interface MappedContractData {
  chainId: number;
  address: string;
  name: string | null;
  symbol: string | null;
  totalSupply: string | null;
  tokenType: string | null;
  contractDeployer: string | null;
  deployedBlockNumber: number | null;
  
  // OpenSea metadata
  openSeaFloorPrice: number | null;
  openSeaCollectionName: string | null;
  openSeaCollectionSlug: string | null;
  openSeaSafelistStatus: string | null;
  openSeaImageUrl: string | null;
  openSeaDescription: string | null;
  openSeaExternalUrl: string | null;
  openSeaTwitter: string | null;
  openSeaDiscord: string | null;
  openSeaBannerImageUrl: string | null;
  openSeaLastIngestedAt: Date | null;
}

export interface MappedRarityData {
  strategyId: string;
  strategyVersion: string;
  rank: number;
  score: number;
  maxRank: number;
  totalSupply: number;
  rarityScore: number;
  prevalence: number;
  percentile: number;
}

// ============================================================================
// NFT Metadata Mapping
// ============================================================================

/**
 * Map Alchemy NFT metadata to database schema
 * Handles fallback to raw.metadata.image when Alchemy hasn't cached the image yet
 */
export function mapNFTMetadata(
  alchemyData: NFTMetadata,
  chainId: number,
  isSpam: boolean = false,
  isAirdrop: boolean = false
): MappedNFTData {
  // Extract raw metadata for fallback
  const rawMetadata = alchemyData.raw?.metadata as any;
  
  // Get image URL with fallback: Alchemy cached > Alchemy original > raw metadata image
  // This handles cases where Alchemy hasn't cached the IPFS image yet (common for Open Edition)
  const rawImageUrl = rawMetadata?.image || null;
  const alchemyCachedUrl = alchemyData.image?.cachedUrl || null;
  const alchemyOriginalUrl = alchemyData.image?.originalUrl || null;
  
  // Use Alchemy cached URL if available, otherwise fallback to raw metadata image
  // and convert IPFS URLs to gateway URLs
  let finalImageUrl: string | null = null;
  if (alchemyCachedUrl) {
    finalImageUrl = alchemyCachedUrl;
  } else if (alchemyOriginalUrl) {
    finalImageUrl = convertIpfsToHttp(alchemyOriginalUrl);
  } else if (rawImageUrl) {
    finalImageUrl = convertIpfsToHttp(rawImageUrl);
  }
  
  // For imageOriginalUrl, prefer full IPFS/HTTP URLs over relative paths
  // If rawImageUrl is relative (starts with ./), try to get full URL from Alchemy
  let originalImageUrl = rawImageUrl;
  if (rawImageUrl && (rawImageUrl.startsWith('./') || rawImageUrl.startsWith('../'))) {
    // Relative path detected - prefer Alchemy's originalUrl if available
    originalImageUrl = alchemyOriginalUrl || rawImageUrl;
  }
  
  return {
    chainId,
    contractAddress: alchemyData.contract.address.toLowerCase(),
    tokenId: alchemyData.tokenId,
    tokenType: alchemyData.tokenType || alchemyData.contract.tokenType || 'UNKNOWN',
    name: alchemyData.name || null,
    description: alchemyData.description || null,
    tokenUri: alchemyData.tokenUri || alchemyData.raw?.tokenUri || null,
    
    // Image data - with fallback to raw metadata
    imageCachedUrl: finalImageUrl,
    imageThumbnailUrl: alchemyData.image?.thumbnailUrl || finalImageUrl,
    imagePngUrl: alchemyData.image?.pngUrl || null,
    imageContentType: alchemyData.image?.contentType || (finalImageUrl ? 'image/jpeg' : null),
    imageSize: alchemyData.image?.size !== undefined ? alchemyData.image.size : null,
    imageOriginalUrl: originalImageUrl || alchemyData.image?.originalUrl || null,
    
    // Raw metadata
    rawMetadata: alchemyData.raw?.metadata || null,
    rawTokenUri: alchemyData.raw?.tokenUri || null,
    
    // Timestamps
    timeLastUpdated: alchemyData.timeLastUpdated 
      ? new Date(alchemyData.timeLastUpdated) 
      : new Date(),
    acquiredBlockTimestamp: alchemyData.acquiredAt?.blockTimestamp
      ? new Date(alchemyData.acquiredAt.blockTimestamp)
      : null,
    acquiredBlockNumber: alchemyData.acquiredAt?.blockNumber || null,
    
    // Mint info
    mintAddress: alchemyData.mint?.mintAddress || null,
    mintBlockNumber: alchemyData.mint?.blockNumber || null,
    mintTimestamp: alchemyData.mint?.timestamp 
      ? new Date(alchemyData.mint.timestamp)
      : null,
    mintTransactionHash: alchemyData.mint?.transactionHash || null,
    
    // Spam detection
    isSpam,
    isAirdrop,
  };
}

// ============================================================================
// Attribute Extraction and Normalization
// ============================================================================

/**
 * Extract attributes from raw metadata
 */
export function extractAttributes(rawMetadata: any): MappedAttribute[] {
  if (!rawMetadata) {
    return [];
  }

  // Handle different metadata formats
  const attributes = rawMetadata.attributes || rawMetadata.traits || [];
  
  if (!Array.isArray(attributes)) {
    return [];
  }

  return attributes
    .filter((attr: any) => attr && (attr.trait_type || attr.traitType))
    .map((attr: any) => normalizeAttribute(attr));
}

/**
 * Normalize a single attribute
 */
export function normalizeAttribute(attr: any): MappedAttribute {
  // Extract trait type (handle both snake_case and camelCase)
  const traitType = normalizeTraitType(
    attr.trait_type || attr.traitType || 'Unknown'
  );
  
  // Extract value
  const rawValue = attr.value !== undefined ? attr.value : '';
  const value = normalizeValue(rawValue);
  
  // Extract display type
  const displayType = attr.display_type || attr.displayType || null;
  
  // Extract numeric value if applicable
  const numericValue = extractNumericValue(rawValue, displayType);
  
  return {
    traitType,
    value,
    displayType,
    numericValue,
    prevalence: null, // Will be calculated later
    count: null, // Will be calculated later
  };
}

/**
 * Normalize trait type for consistent querying
 */
function normalizeTraitType(traitType: string): string {
  const normalized = traitType
    .trim()
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[_-]+/g, ' ') // Replace underscores and hyphens with spaces
    .split(' ')
    .filter(word => word.length > 0) // Remove empty strings
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  // If normalization results in empty string, return 'Unknown'
  return normalized.length > 0 ? normalized : 'Unknown';
}

/**
 * Normalize attribute value
 */
function normalizeValue(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  
  return String(value).trim();
}

/**
 * Extract numeric value from attribute
 */
function extractNumericValue(value: any, displayType: string | null): number | null {
  // If display type indicates numeric, try to parse
  const numericDisplayTypes = ['number', 'boost_number', 'boost_percentage'];
  
  if (displayType && numericDisplayTypes.includes(displayType)) {
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  }
  
  // Try to parse as number anyway
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }
  
  if (typeof value === 'string') {
    const num = parseFloat(value);
    // Only return if it's a valid number and the string was purely numeric
    if (!isNaN(num) && /^-?\d+\.?\d*$/.test(value.trim())) {
      return num;
    }
  }
  
  return null;
}

// ============================================================================
// Image Data Processing
// ============================================================================

/**
 * Process image data from Alchemy response
 */
export function processImageData(image: any): {
  imageCachedUrl: string | null;
  imageThumbnailUrl: string | null;
  imagePngUrl: string | null;
  imageContentType: string | null;
  imageSize: number | null;
  imageOriginalUrl: string | null;
} {
  if (!image) {
    return {
      imageCachedUrl: null,
      imageThumbnailUrl: null,
      imagePngUrl: null,
      imageContentType: null,
      imageSize: null,
      imageOriginalUrl: null,
    };
  }

  return {
    imageCachedUrl: image.cachedUrl || null,
    imageThumbnailUrl: image.thumbnailUrl || null,
    imagePngUrl: image.pngUrl || null,
    imageContentType: image.contentType || null,
    imageSize: image.size !== undefined ? image.size : null,
    imageOriginalUrl: image.originalUrl || null,
  };
}

// ============================================================================
// Contract Metadata Mapping
// ============================================================================

/**
 * Map Alchemy contract metadata to database schema
 */
export function mapContractMetadata(
  alchemyData: ContractMetadata,
  chainId: number
): MappedContractData {
  const openSea = alchemyData.openSeaMetadata;
  
  return {
    chainId,
    address: alchemyData.address.toLowerCase(),
    name: alchemyData.name || null,
    symbol: alchemyData.symbol || null,
    totalSupply: alchemyData.totalSupply || null,
    tokenType: alchemyData.tokenType || null,
    contractDeployer: alchemyData.contractDeployer?.toLowerCase() || null,
    deployedBlockNumber: alchemyData.deployedBlockNumber || null,
    
    // OpenSea metadata
    openSeaFloorPrice: openSea?.floorPrice !== undefined ? openSea.floorPrice : null,
    openSeaCollectionName: openSea?.collectionName || null,
    openSeaCollectionSlug: openSea?.collectionSlug || null,
    openSeaSafelistStatus: openSea?.safelistRequestStatus || null,
    openSeaImageUrl: openSea?.imageUrl || null,
    openSeaDescription: openSea?.description || null,
    openSeaExternalUrl: openSea?.externalUrl || null,
    openSeaTwitter: openSea?.twitterUsername || null,
    openSeaDiscord: openSea?.discordUrl || null,
    openSeaBannerImageUrl: openSea?.bannerImageUrl || null,
    openSeaLastIngestedAt: openSea?.lastIngestedAt 
      ? new Date(openSea.lastIngestedAt)
      : null,
  };
}

// ============================================================================
// Rarity Data Mapping
// ============================================================================

/**
 * Map Alchemy rarity data to database schema
 */
export function mapRarityData(alchemyData: NFTRarity): MappedRarityData {
  // Calculate percentile: (rank / maxRank) * 100
  const percentile = (alchemyData.rank / alchemyData.maxRank) * 100;
  
  return {
    strategyId: alchemyData.strategyId,
    strategyVersion: alchemyData.strategyVersion,
    rank: alchemyData.rank,
    score: alchemyData.score,
    maxRank: alchemyData.maxRank,
    totalSupply: alchemyData.totalSupply,
    rarityScore: alchemyData.rarityScore,
    prevalence: alchemyData.prevalence,
    percentile,
  };
}

/**
 * Map attribute summary to prevalence data
 */
export function mapAttributeSummary(
  summary: NFTAttributeSummary
): Map<string, Map<string, { count: number; prevalence: number }>> {
  const result = new Map<string, Map<string, { count: number; prevalence: number }>>();
  
  for (const [traitType, values] of Object.entries(summary.summary)) {
    const normalizedTraitType = normalizeTraitType(traitType);
    const valueMap = new Map<string, { count: number; prevalence: number }>();
    
    for (const valueData of values) {
      const normalizedValue = normalizeValue(valueData.value);
      valueMap.set(normalizedValue, {
        count: valueData.count,
        prevalence: valueData.prevalence,
      });
    }
    
    result.set(normalizedTraitType, valueMap);
  }
  
  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate Ethereum address
 */
export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Normalize Ethereum address to lowercase
 */
export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

/**
 * Check if metadata has required fields
 */
export function hasRequiredMetadata(metadata: any): boolean {
  return !!(
    metadata &&
    metadata.contract?.address &&
    metadata.tokenId !== undefined
  );
}

/**
 * Merge existing NFT data with new Alchemy data
 * Preserves existing data when new data is null/undefined
 */
export function mergeNFTData(
  existing: Partial<MappedNFTData>,
  newData: MappedNFTData
): MappedNFTData {
  return {
    ...newData,
    // Preserve existing values if new values are null
    name: newData.name || existing.name || null,
    description: newData.description || existing.description || null,
    tokenUri: newData.tokenUri || existing.tokenUri || null,
    imageCachedUrl: newData.imageCachedUrl || existing.imageCachedUrl || null,
    imageThumbnailUrl: newData.imageThumbnailUrl || existing.imageThumbnailUrl || null,
    imagePngUrl: newData.imagePngUrl || existing.imagePngUrl || null,
    imageContentType: newData.imageContentType || existing.imageContentType || null,
    imageSize: newData.imageSize !== null ? newData.imageSize : (existing.imageSize ?? null),
    imageOriginalUrl: newData.imageOriginalUrl || existing.imageOriginalUrl || null,
    rawMetadata: newData.rawMetadata || existing.rawMetadata || null,
    rawTokenUri: newData.rawTokenUri || existing.rawTokenUri || null,
  };
}
