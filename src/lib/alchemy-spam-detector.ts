/**
 * Alchemy Spam Detection Integration
 * 
 * Integrates with Alchemy's spam detection endpoints
 * Handles spam and airdrop flag setting logic
 */

import { AlchemyNFTService } from './alchemy-nft-service';

// ============================================================================
// Type Definitions
// ============================================================================

export interface SpamDetectionResult {
  isSpam: boolean;
  isAirdrop: boolean;
  checkedAt: Date;
}

export interface BulkSpamCheckResult {
  contractAddress: string;
  isSpam: boolean;
  error?: string;
}

export interface SpamDetectionOptions {
  checkAirdrop?: boolean;
  cacheResults?: boolean;
  cacheTTL?: number; // in milliseconds
}

// ============================================================================
// Spam Detector Class
// ============================================================================

export class AlchemySpamDetector {
  private alchemyService: AlchemyNFTService;
  private spamCache: Map<string, { isSpam: boolean; timestamp: number }>;
  private airdropCache: Map<string, { isAirdrop: boolean; timestamp: number }>;
  private cacheTTL: number;

  constructor(
    alchemyService: AlchemyNFTService,
    cacheTTL: number = 3600000 // 1 hour default
  ) {
    this.alchemyService = alchemyService;
    this.spamCache = new Map();
    this.airdropCache = new Map();
    this.cacheTTL = cacheTTL;
  }

  // ==========================================================================
  // Spam Detection Methods
  // ==========================================================================

  /**
   * Check if a contract is marked as spam
   */
  async isSpamContract(
    contractAddress: string,
    useCache: boolean = true
  ): Promise<boolean> {
    const normalizedAddress = contractAddress.toLowerCase();

    // Check cache first
    if (useCache) {
      const cached = this.getCachedSpamStatus(normalizedAddress);
      if (cached !== null) {
        return cached;
      }
    }

    try {
      const result = await this.alchemyService.isSpamContract(normalizedAddress);
      const isSpam = result.isSpamContract;

      // Cache the result
      this.cacheSpamStatus(normalizedAddress, isSpam);

      return isSpam;
    } catch (error) {
      console.error(`Error checking spam status for ${contractAddress}:`, error);
      // Return false on error to avoid blocking
      return false;
    }
  }

  /**
   * Check if an NFT is marked as an airdrop
   */
  async isAirdropNFT(
    contractAddress: string,
    tokenId: string,
    useCache: boolean = true
  ): Promise<boolean> {
    const normalizedAddress = contractAddress.toLowerCase();
    const cacheKey = `${normalizedAddress}:${tokenId}`;

    // Check cache first
    if (useCache) {
      const cached = this.getCachedAirdropStatus(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    try {
      const result = await this.alchemyService.isAirdropNFT(
        normalizedAddress,
        tokenId
      );
      const isAirdrop = result.isAirdrop;

      // Cache the result
      this.cacheAirdropStatus(cacheKey, isAirdrop);

      return isAirdrop;
    } catch (error) {
      console.error(
        `Error checking airdrop status for ${contractAddress}:${tokenId}:`,
        error
      );
      // Return false on error to avoid blocking
      return false;
    }
  }

  /**
   * Check both spam and airdrop status for an NFT
   */
  async checkNFTSpamStatus(
    contractAddress: string,
    tokenId: string,
    options: SpamDetectionOptions = {}
  ): Promise<SpamDetectionResult> {
    const {
      checkAirdrop = true,
      cacheResults = true,
    } = options;

    const isSpam = await this.isSpamContract(contractAddress, cacheResults);
    
    let isAirdrop = false;
    if (checkAirdrop) {
      isAirdrop = await this.isAirdropNFT(contractAddress, tokenId, cacheResults);
    }

    return {
      isSpam,
      isAirdrop,
      checkedAt: new Date(),
    };
  }

  /**
   * Bulk check spam status for multiple contracts
   */
  async bulkCheckSpamContracts(
    contractAddresses: string[]
  ): Promise<BulkSpamCheckResult[]> {
    const results: BulkSpamCheckResult[] = [];

    // Process in parallel with concurrency limit
    const concurrencyLimit = 5;
    for (let i = 0; i < contractAddresses.length; i += concurrencyLimit) {
      const batch = contractAddresses.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(async (address) => {
          try {
            const isSpam = await this.isSpamContract(address);
            return {
              contractAddress: address.toLowerCase(),
              isSpam,
            };
          } catch (error) {
            return {
              contractAddress: address.toLowerCase(),
              isSpam: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            };
          }
        })
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Get all spam contracts from Alchemy
   */
  async getAllSpamContracts(): Promise<string[]> {
    try {
      const result = await this.alchemyService.getSpamContracts();
      return result.spamContracts.map(addr => addr.toLowerCase());
    } catch (error) {
      console.error('Error fetching spam contracts:', error);
      return [];
    }
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Get cached spam status
   */
  private getCachedSpamStatus(contractAddress: string): boolean | null {
    const cached = this.spamCache.get(contractAddress);
    if (!cached) {
      return null;
    }

    // Check if cache is still valid
    const now = Date.now();
    if (now - cached.timestamp > this.cacheTTL) {
      this.spamCache.delete(contractAddress);
      return null;
    }

    return cached.isSpam;
  }

  /**
   * Cache spam status
   */
  private cacheSpamStatus(contractAddress: string, isSpam: boolean): void {
    this.spamCache.set(contractAddress, {
      isSpam,
      timestamp: Date.now(),
    });
  }

  /**
   * Get cached airdrop status
   */
  private getCachedAirdropStatus(cacheKey: string): boolean | null {
    const cached = this.airdropCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    // Check if cache is still valid
    const now = Date.now();
    if (now - cached.timestamp > this.cacheTTL) {
      this.airdropCache.delete(cacheKey);
      return null;
    }

    return cached.isAirdrop;
  }

  /**
   * Cache airdrop status
   */
  private cacheAirdropStatus(cacheKey: string, isAirdrop: boolean): void {
    this.airdropCache.set(cacheKey, {
      isAirdrop,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.spamCache.clear();
    this.airdropCache.clear();
  }

  /**
   * Clear spam cache
   */
  clearSpamCache(): void {
    this.spamCache.clear();
  }

  /**
   * Clear airdrop cache
   */
  clearAirdropCache(): void {
    this.airdropCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    spamCacheSize: number;
    airdropCacheSize: number;
    cacheTTL: number;
  } {
    return {
      spamCacheSize: this.spamCache.size,
      airdropCacheSize: this.airdropCache.size,
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
// Spam Flag Setting Logic
// ============================================================================

/**
 * Determine spam flags for an NFT based on various signals
 */
export function determineSpamFlags(
  isSpamContract: boolean,
  isAirdropNFT: boolean,
  additionalSignals?: {
    hasMetadata?: boolean;
    hasImage?: boolean;
    hasAttributes?: boolean;
    ownerCount?: number;
    transferCount?: number;
  }
): { isSpam: boolean; isAirdrop: boolean; confidence: number } {
  let isSpam = isSpamContract;
  let isAirdrop = isAirdropNFT;
  let confidence = 1.0;

  // If Alchemy marks it as spam, trust that
  if (isSpamContract) {
    return { isSpam: true, isAirdrop, confidence: 1.0 };
  }

  // Additional heuristics if provided
  if (additionalSignals) {
    const {
      hasMetadata = true,
      hasImage = true,
      hasAttributes = true,
      ownerCount = 0,
      transferCount = 0,
    } = additionalSignals;

    // Heuristic: NFTs with no metadata, image, or attributes might be spam
    if (!hasMetadata && !hasImage && !hasAttributes) {
      isSpam = true;
      confidence = 0.7;
    }

    // Heuristic: NFTs with very high owner count but low transfer count might be airdrops
    if (ownerCount > 1000 && transferCount < ownerCount * 1.5) {
      isAirdrop = true;
      confidence = Math.min(confidence, 0.8);
    }
  }

  return { isSpam, isAirdrop, confidence };
}

/**
 * Create spam detection result with timestamp
 */
export function createSpamDetectionResult(
  isSpam: boolean,
  isAirdrop: boolean
): SpamDetectionResult {
  return {
    isSpam,
    isAirdrop,
    checkedAt: new Date(),
  };
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an Alchemy Spam Detector instance
 */
export function createAlchemySpamDetector(
  alchemyService: AlchemyNFTService,
  cacheTTL?: number
): AlchemySpamDetector {
  return new AlchemySpamDetector(alchemyService, cacheTTL);
}

// ============================================================================
// Default Export
// ============================================================================

export default AlchemySpamDetector;
