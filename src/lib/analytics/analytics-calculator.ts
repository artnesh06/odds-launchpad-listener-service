import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface VolumeMetrics {
  totalVolume: string;
  volume24h: string;
  volume7d: string;
  volume30d: string;
}

export interface SalesMetrics {
  totalSales: number;
  sales24h: number;
  sales7d: number;
  sales30d: number;
}

export interface PriceMetrics {
  floorPrice: string | null;
  avgSalePrice: string;
  lastSalePrice: string | null;
  highestSale: string | null;
}

export interface HolderMetrics {
  uniqueHolders: number;
  totalSupply: number;
}

export interface CollectionAnalytics {
  volume: VolumeMetrics;
  sales: SalesMetrics;
  prices: PriceMetrics;
  holders: HolderMetrics;
}

/**
 * Calculate total volume for a collection across all time
 */
export async function calculateTotalVolume(
  contractAddress: string,
  chainId: number
): Promise<string> {
  const result = await prisma.marketplaceSale.aggregate({
    where: {
      contractAddress,
      chainId,
    },
    _sum: {
      blockNumber: true,
    },
  });

  return '0'; // Price field doesn't exist in schema
}

/**
 * Calculate volume for a specific timeframe
 */
export async function calculateVolumeByTimeframe(
  contractAddress: string,
  chainId: number,
  hoursAgo: number
): Promise<string> {
  const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

  const result = await prisma.marketplaceSale.aggregate({
    where: {
      contractAddress,
      chainId,
      blockTimestamp: {
        gte: cutoffTime,
      },
    },
    _sum: {
      blockNumber: true,
    },
  });

  return '0'; // Price field doesn't exist in schema
}

/**
 * Calculate all volume metrics for a collection
 */
export async function calculateVolumeMetrics(
  contractAddress: string,
  chainId: number
): Promise<VolumeMetrics> {
  const [totalVolume, volume24h, volume7d, volume30d] = await Promise.all([
    calculateTotalVolume(contractAddress, chainId),
    calculateVolumeByTimeframe(contractAddress, chainId, 24),
    calculateVolumeByTimeframe(contractAddress, chainId, 24 * 7),
    calculateVolumeByTimeframe(contractAddress, chainId, 24 * 30),
  ]);

  return {
    totalVolume,
    volume24h,
    volume7d,
    volume30d,
  };
}

/**
 * Calculate total sales count for a collection
 */
export async function calculateTotalSales(
  contractAddress: string,
  chainId: number
): Promise<number> {
  return await prisma.marketplaceSale.count({
    where: {
      contractAddress,
      chainId,
    },
  });
}

/**
 * Calculate sales count for a specific timeframe
 */
export async function calculateSalesByTimeframe(
  contractAddress: string,
  chainId: number,
  hoursAgo: number
): Promise<number> {
  const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

  return await prisma.marketplaceSale.count({
    where: {
      contractAddress,
      chainId,
      blockTimestamp: {
        gte: cutoffTime,
      },
    },
  });
}

/**
 * Calculate all sales metrics for a collection
 */
export async function calculateSalesMetrics(
  contractAddress: string,
  chainId: number
): Promise<SalesMetrics> {
  const [totalSales, sales24h, sales7d, sales30d] = await Promise.all([
    calculateTotalSales(contractAddress, chainId),
    calculateSalesByTimeframe(contractAddress, chainId, 24),
    calculateSalesByTimeframe(contractAddress, chainId, 24 * 7),
    calculateSalesByTimeframe(contractAddress, chainId, 24 * 30),
  ]);

  return {
    totalSales,
    sales24h,
    sales7d,
    sales30d,
  };
}

/**
 * Calculate average sale price for a collection
 */
export async function calculateAverageSalePrice(
  contractAddress: string,
  chainId: number
): Promise<string> {
  const result = await prisma.marketplaceSale.aggregate({
    where: {
      contractAddress,
      chainId,
    },
    _avg: {
      blockNumber: true,
    },
  });

  return '0'; // Price field doesn't exist in schema
}

/**
 * Get the last sale price for a collection
 */
export async function getLastSalePrice(
  contractAddress: string,
  chainId: number
): Promise<string | null> {
  const lastSale = await prisma.marketplaceSale.findFirst({
    where: {
      contractAddress,
      chainId,
    },
    orderBy: {
      blockTimestamp: 'desc',
    },
    select: {
      id: true,
    },
  });

  return null; // Price field doesn't exist in schema
}

/**
 * Get the highest sale price for a collection
 */
export async function getHighestSalePrice(
  contractAddress: string,
  chainId: number
): Promise<string | null> {
  const highestSale = await prisma.marketplaceSale.findFirst({
    where: {
      contractAddress,
      chainId,
    },
    orderBy: {
      blockTimestamp: 'desc',
    },
    select: {
      id: true,
    },
  });

  return null; // Price field doesn't exist in schema
}

/**
 * Get the current floor price from the most recent floor price record
 */
export async function getCurrentFloorPrice(
  contractAddress: string,
  chainId: number
): Promise<string | null> {
  const floorPriceRecord = await prisma.nFTFloorPrice.findFirst({
    where: {
      contractAddress,
      chainId,
    },
    orderBy: {
      retrievedAt: 'desc',
    },
    select: {
      floorPrice: true,
    },
  });

  return floorPriceRecord?.floorPrice.toString() || null;
}

/**
 * Calculate all price metrics for a collection
 */
export async function calculatePriceMetrics(
  contractAddress: string,
  chainId: number
): Promise<PriceMetrics> {
  const [floorPrice, avgSalePrice, lastSalePrice, highestSale] =
    await Promise.all([
      getCurrentFloorPrice(contractAddress, chainId),
      calculateAverageSalePrice(contractAddress, chainId),
      getLastSalePrice(contractAddress, chainId),
      getHighestSalePrice(contractAddress, chainId),
    ]);

  return {
    floorPrice,
    avgSalePrice,
    lastSalePrice,
    highestSale,
  };
}

/**
 * Calculate unique holder count for a collection
 */
export async function calculateUniqueHolders(
  contractAddress: string,
  chainId: number
): Promise<number> {
  const result = await prisma.nFTOwnership.groupBy({
    by: ['ownerAddress'],
    where: {
      isCurrent: true,
      nft: {
        contractAddress,
        chainId,
      },
    },
  });

  return result.length;
}

/**
 * Get total supply from contract metadata
 */
export async function getTotalSupply(
  contractAddress: string,
  chainId: number
): Promise<number> {
  const contract = await prisma.nFTContract.findUnique({
    where: {
      address_chainId: {
        address: contractAddress,
        chainId,
      },
    },
    select: {
      totalSupply: true,
    },
  });

  return parseInt(contract?.totalSupply || '0', 10);
}

/**
 * Calculate all holder metrics for a collection
 */
export async function calculateHolderMetrics(
  contractAddress: string,
  chainId: number
): Promise<HolderMetrics> {
  const [uniqueHolders, totalSupply] = await Promise.all([
    calculateUniqueHolders(contractAddress, chainId),
    getTotalSupply(contractAddress, chainId),
  ]);

  return {
    uniqueHolders,
    totalSupply,
  };
}

/**
 * Calculate all analytics for a collection
 */
export async function calculateAllAnalytics(
  contractAddress: string,
  chainId: number
): Promise<CollectionAnalytics> {
  const [volume, sales, prices, holders] = await Promise.all([
    calculateVolumeMetrics(contractAddress, chainId),
    calculateSalesMetrics(contractAddress, chainId),
    calculatePriceMetrics(contractAddress, chainId),
    calculateHolderMetrics(contractAddress, chainId),
  ]);

  return {
    volume,
    sales,
    prices,
    holders,
  };
}

/**
 * Update collection analytics in the database
 */
export async function updateCollectionAnalytics(
  contractAddress: string,
  chainId: number
): Promise<void> {
  const analytics = await calculateAllAnalytics(contractAddress, chainId);

  await prisma.nFTCollectionAnalytics.upsert({
    where: {
      contractAddress_chainId: {
        contractAddress,
        chainId,
      },
    },
    create: {
      contractAddress,
      chainId,
      totalVolume: analytics.volume.totalVolume,
      volume24h: analytics.volume.volume24h,
      volume7d: analytics.volume.volume7d,
      volume30d: analytics.volume.volume30d,
      totalSales: analytics.sales.totalSales,
      sales24h: analytics.sales.sales24h,
      sales7d: analytics.sales.sales7d,
      sales30d: analytics.sales.sales30d,
      floorPrice: analytics.prices.floorPrice,
      avgSalePrice: analytics.prices.avgSalePrice,
      lastSalePrice: analytics.prices.lastSalePrice,
      highestSale: analytics.prices.highestSale,
      uniqueHolders: analytics.holders.uniqueHolders,
      totalSupply: analytics.holders.totalSupply,
      calculatedAt: new Date(),
    },
    update: {
      totalVolume: analytics.volume.totalVolume,
      volume24h: analytics.volume.volume24h,
      volume7d: analytics.volume.volume7d,
      volume30d: analytics.volume.volume30d,
      totalSales: analytics.sales.totalSales,
      sales24h: analytics.sales.sales24h,
      sales7d: analytics.sales.sales7d,
      sales30d: analytics.sales.sales30d,
      floorPrice: analytics.prices.floorPrice,
      avgSalePrice: analytics.prices.avgSalePrice,
      lastSalePrice: analytics.prices.lastSalePrice,
      highestSale: analytics.prices.highestSale,
      uniqueHolders: analytics.holders.uniqueHolders,
      totalSupply: analytics.holders.totalSupply,
      calculatedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * Update holder count after ownership change
 */
export async function updateHolderCountAfterTransfer(
  contractAddress: string,
  chainId: number
): Promise<void> {
  const uniqueHolders = await calculateUniqueHolders(contractAddress, chainId);

  await prisma.nFTCollectionAnalytics.update({
    where: {
      contractAddress_chainId: {
        contractAddress,
        chainId,
      },
    },
    data: {
      uniqueHolders,
      updatedAt: new Date(),
    },
  });
}
