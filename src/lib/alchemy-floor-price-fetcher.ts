/**
 * Alchemy Floor Price Fetcher
 * 
 * Fetches floor prices from multiple marketplaces via Alchemy API
 * Handles floor price storage and comparison logic
 */

import { AlchemyNFTService } from './alchemy-nft-service';
import { Marketplace } from '@prisma/client';
import type { NFTFloorPrice, MarketplaceFloorPrice } from '../types/alchemy';

// ============================================================================
// Type Definitions
// ============================================================================

export interface FloorPriceData {
  marketplace: Marketplace;
  floorPrice: number;
  priceCurrency: string;
  collectionUrl: string | null;
  retrievedAt: Date;
}

export interface MultiMarketplaceFloorPrice {
  contractAddress: string;
  chainId: number;
  prices: FloorPriceData[];
  lowestPrice: FloorPriceData | null;
  retrievedAt: Date;
}

export interface FloorPriceHistory {
  contractAddress: string;
  marketplace: Marketplace;
  previousPrice: number | null;
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  updatedAt: Date;
}

// ============================================================================
// Floor Price Fetcher Class
// ============================================================================

export class AlchemyFloorPriceFetcher {
  private alchemyService: AlchemyNFTService;
  private chainId: number;

  constructor(alchemyService: AlchemyNFTService, chainId: number) {
    this.alchemyService = alchemyService;
    this.chainId = chainId;
  }

  // ==========================================================================
  // Floor Price Fetching Methods
  // ==========================================================================

  /**
   * Fetch floor prices from all available marketplaces
   */
  async fetchFloorPrices(
    contractAddress: string
  ): Promise<MultiMarketplaceFloorPrice> {
    const normalizedAddress = contractAddress.toLowerCase();
    const retrievedAt = new Date();

    try {
      const alchemyData = await this.alchemyService.getFloorPrice(normalizedAddress);
      const prices = this.parseAlchemyFloorPrice(alchemyData, retrievedAt);
      const lowestPrice = this.findLowestPrice(prices);

      return {
        contractAddress: normalizedAddress,
        chainId: this.chainId,
        prices,
        lowestPrice,
        retrievedAt,
      };
    } catch (error) {
      console.error(
        `Error fetching floor prices for ${contractAddress}:`,
        error
      );
      
      // Return empty result on error
      return {
        contractAddress: normalizedAddress,
        chainId: this.chainId,
        prices: [],
        lowestPrice: null,
        retrievedAt,
      };
    }
  }

  /**
   * Fetch floor price from a specific marketplace
   */
  async fetchMarketplaceFloorPrice(
    contractAddress: string,
    marketplace: Marketplace
  ): Promise<FloorPriceData | null> {
    const result = await this.fetchFloorPrices(contractAddress);
    return result.prices.find(p => p.marketplace === marketplace) || null;
  }

  /**
   * Batch fetch floor prices for multiple contracts
   */
  async batchFetchFloorPrices(
    contractAddresses: string[]
  ): Promise<MultiMarketplaceFloorPrice[]> {
    const results: MultiMarketplaceFloorPrice[] = [];

    // Process in parallel with concurrency limit
    const concurrencyLimit = 3;
    for (let i = 0; i < contractAddresses.length; i += concurrencyLimit) {
      const batch = contractAddresses.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map(address => this.fetchFloorPrices(address))
      );
      results.push(...batchResults);
    }

    return results;
  }

  // ==========================================================================
  // Floor Price Parsing
  // ==========================================================================

  /**
   * Parse Alchemy floor price response into structured data
   */
  private parseAlchemyFloorPrice(
    alchemyData: NFTFloorPrice,
    retrievedAt: Date
  ): FloorPriceData[] {
    const prices: FloorPriceData[] = [];

    // Parse OpenSea floor price
    if (alchemyData.openSea) {
      const openSeaPrice = this.parseMarketplaceFloorPrice(
        alchemyData.openSea,
        Marketplace.OPENSEA,
        retrievedAt
      );
      if (openSeaPrice) {
        prices.push(openSeaPrice);
      }
    }

    // Parse LooksRare floor price
    if (alchemyData.looksRare) {
      const looksRarePrice = this.parseMarketplaceFloorPrice(
        alchemyData.looksRare,
        Marketplace.LOOKSRARE,
        retrievedAt
      );
      if (looksRarePrice) {
        prices.push(looksRarePrice);
      }
    }

    return prices;
  }

  /**
   * Parse individual marketplace floor price
   */
  private parseMarketplaceFloorPrice(
    marketplaceData: MarketplaceFloorPrice,
    marketplace: Marketplace,
    retrievedAt: Date
  ): FloorPriceData | null {
    if (!marketplaceData.floorPrice || marketplaceData.floorPrice <= 0) {
      return null;
    }

    return {
      marketplace,
      floorPrice: marketplaceData.floorPrice,
      priceCurrency: marketplaceData.priceCurrency || 'ETH',
      collectionUrl: marketplaceData.collectionUrl || null,
      retrievedAt,
    };
  }

  // ==========================================================================
  // Floor Price Analysis
  // ==========================================================================

  /**
   * Find the lowest floor price across all marketplaces
   */
  private findLowestPrice(prices: FloorPriceData[]): FloorPriceData | null {
    if (prices.length === 0) {
      return null;
    }

    return prices.reduce((lowest, current) => {
      // Compare prices in the same currency
      if (lowest.priceCurrency === current.priceCurrency) {
        return current.floorPrice < lowest.floorPrice ? current : lowest;
      }
      
      // If currencies differ, prefer ETH, then just return the first one
      if (current.priceCurrency === 'ETH') {
        return current;
      }
      
      return lowest;
    });
  }

  /**
   * Calculate floor price change
   */
  calculatePriceChange(
    previousPrice: number | null,
    currentPrice: number
  ): { priceChange: number; priceChangePercent: number } {
    if (previousPrice === null || previousPrice === 0) {
      return {
        priceChange: 0,
        priceChangePercent: 0,
      };
    }

    const priceChange = currentPrice - previousPrice;
    const priceChangePercent = (priceChange / previousPrice) * 100;

    return {
      priceChange,
      priceChangePercent,
    };
  }

  /**
   * Create floor price history entry
   */
  createFloorPriceHistory(
    contractAddress: string,
    marketplace: Marketplace,
    previousPrice: number | null,
    currentPrice: number
  ): FloorPriceHistory {
    const { priceChange, priceChangePercent } = this.calculatePriceChange(
      previousPrice,
      currentPrice
    );

    return {
      contractAddress: contractAddress.toLowerCase(),
      marketplace,
      previousPrice,
      currentPrice,
      priceChange,
      priceChangePercent,
      updatedAt: new Date(),
    };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Check if floor price data is stale
   */
  isFloorPriceStale(
    retrievedAt: Date,
    maxAgeMinutes: number = 60
  ): boolean {
    const now = new Date();
    const ageMinutes = (now.getTime() - retrievedAt.getTime()) / (1000 * 60);
    return ageMinutes > maxAgeMinutes;
  }

  /**
   * Format floor price for display
   */
  formatFloorPrice(
    price: number,
    currency: string,
    decimals: number = 4
  ): string {
    return `${price.toFixed(decimals)} ${currency}`;
  }

  /**
   * Convert floor price to USD (requires exchange rate)
   */
  convertToUSD(
    price: number,
    currency: string,
    exchangeRates: Map<string, number>
  ): number | null {
    const rate = exchangeRates.get(currency);
    if (!rate) {
      return null;
    }
    return price * rate;
  }

  /**
   * Get marketplace name from enum
   */
  getMarketplaceName(marketplace: Marketplace): string {
    const names: Record<Marketplace, string> = {
      [Marketplace.OPENSEA]: 'OpenSea',
      [Marketplace.SEAPORT]: 'Seaport',
      [Marketplace.MAGIC_EDEN]: 'Magic Eden',
      [Marketplace.BLUR]: 'Blur',
      [Marketplace.LOOKSRARE]: 'LooksRare',
      [Marketplace.X2Y2]: 'X2Y2',
      [Marketplace.RARIBLE]: 'Rarible',
      [Marketplace.UNKNOWN]: 'Unknown',
    };
    return names[marketplace] || 'Unknown';
  }

  /**
   * Set chain ID
   */
  setChainId(chainId: number): void {
    this.chainId = chainId;
  }

  /**
   * Get current chain ID
   */
  getChainId(): number {
    return this.chainId;
  }
}

// ============================================================================
// Floor Price Storage Logic
// ============================================================================

/**
 * Prepare floor price data for database storage
 */
export function prepareFloorPriceForStorage(
  contractAddress: string,
  chainId: number,
  priceData: FloorPriceData
): {
  chainId: number;
  contractAddress: string;
  marketplace: Marketplace;
  floorPrice: number;
  priceCurrency: string;
  collectionUrl: string | null;
  retrievedAt: Date;
} {
  return {
    chainId,
    contractAddress: contractAddress.toLowerCase(),
    marketplace: priceData.marketplace,
    floorPrice: priceData.floorPrice,
    priceCurrency: priceData.priceCurrency,
    collectionUrl: priceData.collectionUrl,
    retrievedAt: priceData.retrievedAt,
  };
}

/**
 * Prepare multiple floor prices for batch storage
 */
export function prepareFloorPricesForBatchStorage(
  result: MultiMarketplaceFloorPrice
): Array<{
  chainId: number;
  contractAddress: string;
  marketplace: Marketplace;
  floorPrice: number;
  priceCurrency: string;
  collectionUrl: string | null;
  retrievedAt: Date;
}> {
  return result.prices.map(price =>
    prepareFloorPriceForStorage(result.contractAddress, result.chainId, price)
  );
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an Alchemy Floor Price Fetcher instance
 */
export function createAlchemyFloorPriceFetcher(
  alchemyService: AlchemyNFTService,
  chainId: number
): AlchemyFloorPriceFetcher {
  return new AlchemyFloorPriceFetcher(alchemyService, chainId);
}

// ============================================================================
// Default Export
// ============================================================================

export default AlchemyFloorPriceFetcher;
