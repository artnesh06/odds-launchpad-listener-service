/**
 * Alchemy Rarity Calculator Integration
 * 
 * Integrates with Alchemy's rarity computation endpoints
 * Handles rarity data storage and attribute prevalence calculation
 */

import { AlchemyNFTService } from './alchemy-nft-service';
import type { NFTRarity, NFTAttributeSummary } from '../types/alchemy';

// ============================================================================
// Type Definitions
// ============================================================================

export interface RarityCalculationResult {
  nftId: string;
  contractAddress: string;
  tokenId: string;
  strategyId: string;
  strategyVersion: string;
  rank: number;
  score: number;
  maxRank: number;
  totalSupply: number;
  rarityScore: number;
  prevalence: number;
  percentile: number;
  calculatedAt: Date;
}

export interface AttributePrevalenceData {
  traitType: string;
  value: string;
  count: number;
  prevalence: number;
  totalSupply: number;
}

export interface CollectionAttributeSummary {
  contractAddress: string;
  totalSupply: number;
  attributes: Map<string, AttributePrevalenceData[]>;
  calculatedAt: Date;
}

export interface RarityRankInfo {
  rank: number;
  maxRank: number;
  percentile: number;
  tier: RarityTier;
}

export enum RarityTier {
  COMMON = 'COMMON',
  UNCOMMON = 'UNCOMMON',
  RARE = 'RARE',
  EPIC = 'EPIC',
  LEGENDARY = 'LEGENDARY',
}

// ============================================================================
// Rarity Calculator Class
// ============================================================================

export class AlchemyRarityCalculator {
  private alchemyService: AlchemyNFTService;
  private attributeSummaryCache: Map<string, {
    summary: CollectionAttributeSummary;
    timestamp: number;
  }>;
  private cacheTTL: number;

  constructor(
    alchemyService: AlchemyNFTService,
    cacheTTL: number = 3600000 // 1 hour default
  ) {
    this.alchemyService = alchemyService;
    this.attributeSummaryCache = new Map();
    this.cacheTTL = cacheTTL;
  }

  // ==========================================================================
  // Rarity Computation Methods
  // ==========================================================================

  /**
   * Compute rarity for a specific NFT
   */
  async computeNFTRarity(
    contractAddress: string,
    tokenId: string
  ): Promise<RarityCalculationResult | null> {
    const normalizedAddress = contractAddress.toLowerCase();

    try {
      const alchemyData = await this.alchemyService.computeRarity(
        normalizedAddress,
        tokenId
      );

      return this.parseRarityData(
        alchemyData,
        normalizedAddress,
        tokenId
      );
    } catch (error) {
      console.error(
        `Error computing rarity for ${contractAddress}:${tokenId}:`,
        error
      );
      return null;
    }
  }

  /**
   * Get attribute summary for a collection
   */
  async getAttributeSummary(
    contractAddress: string,
    useCache: boolean = true
  ): Promise<CollectionAttributeSummary | null> {
    const normalizedAddress = contractAddress.toLowerCase();

    // Check cache first
    if (useCache) {
      const cached = this.getCachedAttributeSummary(normalizedAddress);
      if (cached) {
        return cached;
      }
    }

    try {
      const alchemyData = await this.alchemyService.summarizeNFTAttributes(
        normalizedAddress
      );

      const summary = this.parseAttributeSummary(alchemyData);
      
      // Cache the result
      this.cacheAttributeSummary(normalizedAddress, summary);

      return summary;
    } catch (error) {
      console.error(
        `Error fetching attribute summary for ${contractAddress}:`,
        error
      );
      return null;
    }
  }

  /**
   * Batch compute rarity for multiple NFTs
   */
  async batchComputeRarity(
    nfts: Array<{ contractAddress: string; tokenId: string }>
  ): Promise<RarityCalculationResult[]> {
    const results: RarityCalculationResult[] = [];

    // Process in parallel with concurrency limit
    const concurrencyLimit = 3;
    for (let i = 0; i < nfts.length; i += concurrencyLimit) {
      const batch = nfts.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(async (nft) => {
          const result = await this.computeNFTRarity(
            nft.contractAddress,
            nft.tokenId
          );
          return result;
        })
      );
      
      // Filter out null results
      results.push(...batchResults.filter((r): r is RarityCalculationResult => r !== null));
    }

    return results;
  }

  // ==========================================================================
  // Rarity Data Parsing
  // ==========================================================================

  /**
   * Parse Alchemy rarity data into structured format
   */
  private parseRarityData(
    alchemyData: NFTRarity,
    contractAddress: string,
    tokenId: string
  ): RarityCalculationResult {
    const percentile = this.calculatePercentile(
      alchemyData.rank,
      alchemyData.maxRank
    );

    return {
      nftId: '', // Will be set when storing to database
      contractAddress: contractAddress.toLowerCase(),
      tokenId,
      strategyId: alchemyData.strategyId,
      strategyVersion: alchemyData.strategyVersion,
      rank: alchemyData.rank,
      score: alchemyData.score,
      maxRank: alchemyData.maxRank,
      totalSupply: alchemyData.totalSupply,
      rarityScore: alchemyData.rarityScore,
      prevalence: alchemyData.prevalence,
      percentile,
      calculatedAt: new Date(),
    };
  }

  /**
   * Parse attribute summary from Alchemy
   */
  private parseAttributeSummary(
    alchemyData: NFTAttributeSummary
  ): CollectionAttributeSummary {
    const attributes = new Map<string, AttributePrevalenceData[]>();

    for (const [traitType, values] of Object.entries(alchemyData.summary)) {
      const prevalenceData = values.map(v => ({
        traitType,
        value: v.value,
        count: v.count,
        prevalence: v.prevalence,
        totalSupply: alchemyData.totalSupply,
      }));
      
      attributes.set(traitType, prevalenceData);
    }

    return {
      contractAddress: alchemyData.contractAddress.toLowerCase(),
      totalSupply: alchemyData.totalSupply,
      attributes,
      calculatedAt: new Date(),
    };
  }

  // ==========================================================================
  // Rarity Analysis Methods
  // ==========================================================================

  /**
   * Calculate percentile from rank
   */
  calculatePercentile(rank: number, maxRank: number): number {
    if (maxRank === 0) {
      return 0;
    }
    return (rank / maxRank) * 100;
  }

  /**
   * Get rarity tier based on percentile
   */
  getRarityTier(percentile: number): RarityTier {
    if (percentile <= 1) {
      return RarityTier.LEGENDARY;
    } else if (percentile <= 5) {
      return RarityTier.EPIC;
    } else if (percentile <= 20) {
      return RarityTier.RARE;
    } else if (percentile <= 50) {
      return RarityTier.UNCOMMON;
    } else {
      return RarityTier.COMMON;
    }
  }

  /**
   * Get rarity rank info with tier
   */
  getRarityRankInfo(rank: number, maxRank: number): RarityRankInfo {
    const percentile = this.calculatePercentile(rank, maxRank);
    const tier = this.getRarityTier(percentile);

    return {
      rank,
      maxRank,
      percentile,
      tier,
    };
  }

  /**
   * Get attribute prevalence for specific trait
   */
  getAttributePrevalence(
    summary: CollectionAttributeSummary,
    traitType: string,
    value: string
  ): AttributePrevalenceData | null {
    const traitData = summary.attributes.get(traitType);
    if (!traitData) {
      return null;
    }

    return traitData.find(d => d.value === value) || null;
  }

  /**
   * Calculate custom rarity score based on attribute prevalence
   */
  calculateCustomRarityScore(
    attributes: Array<{ traitType: string; value: string }>,
    summary: CollectionAttributeSummary
  ): number {
    let totalScore = 0;
    let attributeCount = 0;

    for (const attr of attributes) {
      const prevalence = this.getAttributePrevalence(
        summary,
        attr.traitType,
        attr.value
      );

      if (prevalence) {
        // Rarity score is inverse of prevalence
        // More rare = lower prevalence = higher score
        const score = 1 / (prevalence.prevalence / 100);
        totalScore += score;
        attributeCount++;
      }
    }

    return attributeCount > 0 ? totalScore / attributeCount : 0;
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Get cached attribute summary
   */
  private getCachedAttributeSummary(
    contractAddress: string
  ): CollectionAttributeSummary | null {
    const cached = this.attributeSummaryCache.get(contractAddress);
    if (!cached) {
      return null;
    }

    // Check if cache is still valid
    const now = Date.now();
    if (now - cached.timestamp > this.cacheTTL) {
      this.attributeSummaryCache.delete(contractAddress);
      return null;
    }

    return cached.summary;
  }

  /**
   * Cache attribute summary
   */
  private cacheAttributeSummary(
    contractAddress: string,
    summary: CollectionAttributeSummary
  ): void {
    this.attributeSummaryCache.set(contractAddress, {
      summary,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.attributeSummaryCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    cacheSize: number;
    cacheTTL: number;
  } {
    return {
      cacheSize: this.attributeSummaryCache.size,
      cacheTTL: this.cacheTTL,
    };
  }

  /**
   * Set cache TTL
   */
  setCacheTTL(ttl: number): void {
    this.cacheTTL = ttl;
  }
}

// ============================================================================
// Rarity Data Storage Logic
// ============================================================================

/**
 * Prepare rarity data for database storage
 */
export function prepareRarityDataForStorage(
  nftId: string,
  rarityData: RarityCalculationResult
): {
  nftId: string;
  strategyId: string;
  strategyVersion: string;
  rank: number;
  score: number;
  maxRank: number;
  totalSupply: number;
  rarityScore: number;
  prevalence: number;
  percentile: number;
  calculatedAt: Date;
} {
  return {
    nftId,
    strategyId: rarityData.strategyId,
    strategyVersion: rarityData.strategyVersion,
    rank: rarityData.rank,
    score: rarityData.score,
    maxRank: rarityData.maxRank,
    totalSupply: rarityData.totalSupply,
    rarityScore: rarityData.rarityScore,
    prevalence: rarityData.prevalence,
    percentile: rarityData.percentile,
    calculatedAt: rarityData.calculatedAt,
  };
}

/**
 * Prepare attribute prevalence data for storage
 */
export function prepareAttributePrevalenceForStorage(
  prevalenceData: AttributePrevalenceData
): {
  traitType: string;
  value: string;
  prevalence: number;
  count: number;
} {
  return {
    traitType: prevalenceData.traitType,
    value: prevalenceData.value,
    prevalence: prevalenceData.prevalence,
    count: prevalenceData.count,
  };
}

/**
 * Format rarity rank for display
 */
export function formatRarityRank(rank: number, maxRank: number): string {
  return `#${rank} / ${maxRank}`;
}

/**
 * Format percentile for display
 */
export function formatPercentile(percentile: number): string {
  return `Top ${percentile.toFixed(2)}%`;
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an Alchemy Rarity Calculator instance
 */
export function createAlchemyRarityCalculator(
  alchemyService: AlchemyNFTService,
  cacheTTL?: number
): AlchemyRarityCalculator {
  return new AlchemyRarityCalculator(alchemyService, cacheTTL);
}

// ============================================================================
// Default Export
// ============================================================================

export default AlchemyRarityCalculator;
