import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface CacheConfig {
  nftMetadataTTL: number; // in seconds
  contractMetadataTTL: number; // in seconds
  floorPriceTTL: number; // in seconds
  analyticsTTL: number; // in seconds
}

const DEFAULT_CONFIG: CacheConfig = {
  nftMetadataTTL: 3600, // 1 hour
  contractMetadataTTL: 7200, // 2 hours
  floorPriceTTL: 300, // 5 minutes
  analyticsTTL: 600, // 10 minutes
};

// In-memory cache
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class MemoryCache {
  private cache: Map<string, CacheEntry<any>> = new Map();

  set<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl * 1000, // Convert to milliseconds
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton cache instance
const memoryCache = new MemoryCache();

// Run cleanup every 5 minutes
setInterval(() => {
  memoryCache.cleanup();
}, 5 * 60 * 1000);

/**
 * Get NFT metadata from cache or database
 */
export async function getCachedNFTMetadata(
  contractAddress: string,
  tokenId: string,
  chainId: number,
  config: CacheConfig = DEFAULT_CONFIG
): Promise<any | null> {
  const cacheKey = `nft:${chainId}:${contractAddress}:${tokenId}`;

  // Check memory cache first
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch from database
  const nft = await prisma.nFT.findUnique({
    where: {
      contractAddress_tokenId_chainId: {
        contractAddress,
        tokenId,
        chainId,
      },
    },
    include: {
      attributes: true,
      ownership: {
        where: {
          isCurrent: true,
        },
      },
      rarity: true,
    },
  });

  if (!nft) {
    return null;
  }

  // Check if data is stale
  const age = Date.now() - nft.timeLastUpdated.getTime();
  if (age > config.nftMetadataTTL * 1000) {
    // Data is stale, return null to trigger refresh
    return null;
  }

  // Cache the result
  memoryCache.set(cacheKey, nft, config.nftMetadataTTL);

  return nft;
}

/**
 * Get contract metadata from cache or database
 */
export async function getCachedContractMetadata(
  contractAddress: string,
  chainId: number,
  config: CacheConfig = DEFAULT_CONFIG
): Promise<any | null> {
  const cacheKey = `contract:${chainId}:${contractAddress}`;

  // Check memory cache first
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch from database
  const contract = await prisma.nFTContract.findUnique({
    where: {
      address_chainId: {
        address: contractAddress,
        chainId,
      },
    },
    include: {
      analytics: true,
      floorPrices: {
        orderBy: {
          retrievedAt: 'desc',
        },
        take: 1,
      },
    },
  });

  if (!contract) {
    return null;
  }

  // Check if data is stale
  const age = Date.now() - contract.updatedAt.getTime();
  if (age > config.contractMetadataTTL * 1000) {
    // Data is stale, return null to trigger refresh
    return null;
  }

  // Cache the result
  memoryCache.set(cacheKey, contract, config.contractMetadataTTL);

  return contract;
}

/**
 * Get floor price from cache or database
 */
export async function getCachedFloorPrice(
  contractAddress: string,
  chainId: number,
  config: CacheConfig = DEFAULT_CONFIG
): Promise<any | null> {
  const cacheKey = `floor:${chainId}:${contractAddress}`;

  // Check memory cache first
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch from database
  const floorPrice = await prisma.nFTFloorPrice.findFirst({
    where: {
      contractAddress,
      chainId,
    },
    orderBy: {
      retrievedAt: 'desc',
    },
  });

  if (!floorPrice) {
    return null;
  }

  // Check if data is stale
  const age = Date.now() - floorPrice.retrievedAt.getTime();
  if (age > config.floorPriceTTL * 1000) {
    // Data is stale, return null to trigger refresh
    return null;
  }

  // Cache the result
  memoryCache.set(cacheKey, floorPrice, config.floorPriceTTL);

  return floorPrice;
}

/**
 * Get analytics from cache or database
 */
export async function getCachedAnalytics(
  contractAddress: string,
  chainId: number,
  config: CacheConfig = DEFAULT_CONFIG
): Promise<any | null> {
  const cacheKey = `analytics:${chainId}:${contractAddress}`;

  // Check memory cache first
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Fetch from database
  const analytics = await prisma.nFTCollectionAnalytics.findUnique({
    where: {
      contractAddress_chainId: {
        contractAddress,
        chainId,
      },
    },
  });

  if (!analytics) {
    return null;
  }

  // Check if data is stale
  const age = Date.now() - analytics.calculatedAt.getTime();
  if (age > config.analyticsTTL * 1000) {
    // Data is stale, return null to trigger refresh
    return null;
  }

  // Cache the result
  memoryCache.set(cacheKey, analytics, config.analyticsTTL);

  return analytics;
}

/**
 * Invalidate NFT metadata cache
 */
export function invalidateNFTCache(
  contractAddress: string,
  tokenId: string,
  chainId: number
): void {
  const cacheKey = `nft:${chainId}:${contractAddress}:${tokenId}`;
  memoryCache.delete(cacheKey);
}

/**
 * Invalidate contract metadata cache
 */
export function invalidateContractCache(
  contractAddress: string,
  chainId: number
): void {
  const cacheKey = `contract:${chainId}:${contractAddress}`;
  memoryCache.delete(cacheKey);
}

/**
 * Invalidate floor price cache
 */
export function invalidateFloorPriceCache(
  contractAddress: string,
  chainId: number
): void {
  const cacheKey = `floor:${chainId}:${contractAddress}`;
  memoryCache.delete(cacheKey);
}

/**
 * Invalidate analytics cache
 */
export function invalidateAnalyticsCache(
  contractAddress: string,
  chainId: number
): void {
  const cacheKey = `analytics:${chainId}:${contractAddress}`;
  memoryCache.delete(cacheKey);
}

/**
 * Invalidate all caches for a contract
 */
export function invalidateAllContractCaches(
  contractAddress: string,
  chainId: number
): void {
  invalidateContractCache(contractAddress, chainId);
  invalidateFloorPriceCache(contractAddress, chainId);
  invalidateAnalyticsCache(contractAddress, chainId);
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  memoryCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  size: number;
  config: CacheConfig;
} {
  return {
    size: memoryCache.size(),
    config: DEFAULT_CONFIG,
  };
}

/**
 * Warm up cache for a contract
 * Pre-loads frequently accessed data into cache
 */
export async function warmUpCache(
  contractAddress: string,
  chainId: number,
  config: CacheConfig = DEFAULT_CONFIG
): Promise<void> {
  console.log(`Warming up cache for ${contractAddress} on chain ${chainId}`);

  // Load contract metadata
  await getCachedContractMetadata(contractAddress, chainId, config);

  // Load floor price
  await getCachedFloorPrice(contractAddress, chainId, config);

  // Load analytics
  await getCachedAnalytics(contractAddress, chainId, config);

  console.log('Cache warm-up completed');
}

/**
 * Batch warm up cache for multiple contracts
 */
export async function batchWarmUpCache(
  contracts: Array<{ address: string; chainId: number }>,
  config: CacheConfig = DEFAULT_CONFIG
): Promise<void> {
  console.log(`Warming up cache for ${contracts.length} contracts`);

  await Promise.all(
    contracts.map((contract) =>
      warmUpCache(contract.address, contract.chainId, config)
    )
  );

  console.log('Batch cache warm-up completed');
}
