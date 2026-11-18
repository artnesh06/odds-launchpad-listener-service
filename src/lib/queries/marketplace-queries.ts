import { PrismaClient, Prisma, Marketplace } from '@prisma/client';

const prisma = new PrismaClient();

export interface MarketplaceQueryOptions {
  chainId?: number;
  contractAddress?: string;
  marketplace?: Marketplace;
  buyer?: string;
  seller?: string;
  fromDate?: Date;
  toDate?: Date;
  minPrice?: string;
  maxPrice?: string;
  limit?: number;
  cursor?: string;
  orderBy?: 'blockTimestamp' | 'price';
  orderDirection?: 'asc' | 'desc';
}

export interface PaginatedSalesResult {
  sales: any[];
  nextCursor?: string;
  hasMore: boolean;
  total: number;
}

/**
 * Query marketplace sales with advanced filtering
 */
export async function querySales(
  options: MarketplaceQueryOptions
): Promise<PaginatedSalesResult> {
  const {
    chainId,
    contractAddress,
    marketplace,
    buyer,
    seller,
    fromDate,
    toDate,
    minPrice,
    maxPrice,
    limit = 50,
    cursor,
    orderBy = 'blockTimestamp',
    orderDirection = 'desc',
  } = options;

  // Build where clause
  const where: Prisma.MarketplaceSaleWhereInput = {};

  if (chainId) {
    where.chainId = chainId;
  }

  if (contractAddress) {
    where.contractAddress = contractAddress.toLowerCase();
  }

  if (marketplace) {
    where.marketplace = marketplace;
  }

  if (buyer) {
    where.buyer = buyer;
  }

  if (seller) {
    where.seller = seller;
  }

  if (fromDate || toDate) {
    where.blockTimestamp = {};
    if (fromDate) {
      where.blockTimestamp.gte = fromDate;
    }
    if (toDate) {
      where.blockTimestamp.lte = toDate;
    }
  }

  if (minPrice || maxPrice) {
    where.price = {};
    if (minPrice) {
      where.price.gte = minPrice;
    }
    if (maxPrice) {
      where.price.lte = maxPrice;
    }
  }

  // Get total count
  const total = await prisma.marketplaceSale.count({ where });

  // Query with cursor pagination
  const sales = await prisma.marketplaceSale.findMany({
    where,
    take: limit + 1,
    ...(cursor && {
      skip: 1,
      cursor: {
        id: cursor,
      },
    }),
    orderBy: {
      [orderBy]: orderDirection,
    },
    include: {
      contract: {
        select: {
          name: true,
          symbol: true,
        },
      },
    },
  });

  const hasMore = sales.length > limit;
  const results = hasMore ? sales.slice(0, -1) : sales;
  const nextCursor = hasMore ? results[results.length - 1].id : undefined;

  return {
    sales: results,
    nextCursor,
    hasMore,
    total,
  };
}

/**
 * Get sales for a specific NFT
 */
export async function getSalesForNFT(
  contractAddress: string,
  tokenId: string,
  chainId: number,
  options: Omit<
    MarketplaceQueryOptions,
    'contractAddress' | 'chainId'
  > = {}
): Promise<PaginatedSalesResult> {
  return querySales({
    ...options,
    contractAddress,
    chainId,
  });
}

/**
 * Get sales by a specific seller
 */
export async function getSalesBySeller(
  seller: string,
  options: Omit<MarketplaceQueryOptions, 'seller'> = {}
): Promise<PaginatedSalesResult> {
  return querySales({
    ...options,
    seller,
  });
}

/**
 * Get sales by a specific buyer
 */
export async function getSalesByBuyer(
  buyer: string,
  options: Omit<MarketplaceQueryOptions, 'buyer'> = {}
): Promise<PaginatedSalesResult> {
  return querySales({
    ...options,
    buyer,
  });
}

/**
 * Get recent sales for a collection
 */
export async function getRecentSales(
  contractAddress: string,
  chainId: number,
  limit: number = 10
): Promise<any[]> {
  return await prisma.marketplaceSale.findMany({
    where: {
      contractAddress,
      chainId,
    },
    orderBy: {
      blockTimestamp: 'desc',
    },
    take: limit,
    include: {
      contract: {
        select: {
          name: true,
          symbol: true,
        },
      },
    },
  });
}

/**
 * Get active listings for a collection
 */
export async function getActiveListings(
  contractAddress: string,
  chainId: number,
  options: {
    marketplace?: Marketplace;
    limit?: number;
    cursor?: string;
  } = {}
): Promise<{
  listings: any[];
  nextCursor?: string;
  hasMore: boolean;
  total: number;
}> {
  const { marketplace, limit = 50, cursor } = options;

  const where: Prisma.MarketplaceListingWhereInput = {
    contractAddress,
    chainId,
    status: 'ACTIVE',
    ...(marketplace && { marketplace }),
  };

  const total = await prisma.marketplaceListing.count({ where });

  const listings = await prisma.marketplaceListing.findMany({
    where,
    take: limit + 1,
    ...(cursor && {
      skip: 1,
      cursor: {
        id: cursor,
      },
    }),
    orderBy: {
      startTime: 'desc',
    },
    include: {
      contract: {
        select: {
          name: true,
          symbol: true,
        },
      },
    },
  });

  const hasMore = listings.length > limit;
  const results = hasMore ? listings.slice(0, -1) : listings;
  const nextCursor = hasMore ? results[results.length - 1].id : undefined;

  return {
    listings: results,
    nextCursor,
    hasMore,
    total,
  };
}

/**
 * Get active offers for a collection
 */
export async function getActiveOffers(
  contractAddress: string,
  chainId: number,
  options: {
    marketplace?: Marketplace;
    limit?: number;
    cursor?: string;
  } = {}
): Promise<{
  offers: any[];
  nextCursor?: string;
  hasMore: boolean;
  total: number;
}> {
  const { marketplace, limit = 50, cursor } = options;

  const where: Prisma.MarketplaceOfferWhereInput = {
    contractAddress,
    chainId,
    status: 'ACTIVE',
    ...(marketplace && { marketplace }),
  };

  const total = await prisma.marketplaceOffer.count({ where });

  const offers = await prisma.marketplaceOffer.findMany({
    where,
    take: limit + 1,
    ...(cursor && {
      skip: 1,
      cursor: {
        id: cursor,
      },
    }),
    orderBy: {
      offerTime: 'desc',
    },
  });

  const hasMore = offers.length > limit;
  const results = hasMore ? offers.slice(0, -1) : offers;
  const nextCursor = hasMore ? results[results.length - 1].id : undefined;

  return {
    offers: results,
    nextCursor,
    hasMore,
    total,
  };
}

/**
 * Get marketplace activity for a collection (sales, listings, offers)
 */
export async function getMarketplaceActivity(
  contractAddress: string,
  chainId: number,
  options: {
    limit?: number;
    fromDate?: Date;
    toDate?: Date;
  } = {}
): Promise<
  Array<{
    type: 'sale' | 'listing' | 'offer';
    data: any;
    timestamp: Date;
  }>
> {
  const { limit = 50, fromDate, toDate } = options;

  // Get recent sales
  const salesWhere: Prisma.MarketplaceSaleWhereInput = {
    contractAddress,
    chainId,
  };
  if (fromDate || toDate) {
    salesWhere.blockTimestamp = {};
    if (fromDate) salesWhere.blockTimestamp.gte = fromDate;
    if (toDate) salesWhere.blockTimestamp.lte = toDate;
  }

  const sales = await prisma.marketplaceSale.findMany({
    where: salesWhere,
    orderBy: { blockTimestamp: 'desc' },
    take: limit,
  });

  // Get recent listings
  const listingsWhere: Prisma.MarketplaceListingWhereInput = {
    contractAddress,
    chainId,
  };
  if (fromDate || toDate) {
    listingsWhere.startTime = {};
    if (fromDate) listingsWhere.startTime.gte = fromDate;
    if (toDate) listingsWhere.startTime.lte = toDate;
  }

  const listings = await prisma.marketplaceListing.findMany({
    where: listingsWhere,
    orderBy: { startTime: 'desc' },
    take: limit,
  });

  // Get recent offers
  const offersWhere: Prisma.MarketplaceOfferWhereInput = {
    contractAddress,
    chainId,
  };
  if (fromDate || toDate) {
    offersWhere.offerTime = {};
    if (fromDate) offersWhere.offerTime.gte = fromDate;
    if (toDate) offersWhere.offerTime.lte = toDate;
  }

  const offers = await prisma.marketplaceOffer.findMany({
    where: offersWhere,
    orderBy: { offerTime: 'desc' },
    take: limit,
  });

  // Combine and sort by timestamp
  const activity = [
    ...sales.map((s) => ({
      type: 'sale' as const,
      data: s,
      timestamp: s.blockTimestamp,
    })),
    ...listings.map((l) => ({
      type: 'listing' as const,
      data: l,
      timestamp: l.startTime,
    })),
    ...offers.map((o) => ({
      type: 'offer' as const,
      data: o,
      timestamp: o.offerTime,
    })),
  ];

  activity.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return activity.slice(0, limit);
}

/**
 * Get sales statistics for a collection
 */
export async function getSalesStatistics(
  contractAddress: string,
  chainId: number,
  timeframe?: { fromDate?: Date; toDate?: Date }
): Promise<{
  totalSales: number;
  totalVolume: string;
  averagePrice: string;
  minPrice: string;
  maxPrice: string;
  uniqueBuyers: number;
  uniqueSellers: number;
}> {
  const where: Prisma.MarketplaceSaleWhereInput = {
    contractAddress,
    chainId,
  };

  if (timeframe?.fromDate || timeframe?.toDate) {
    where.blockTimestamp = {};
    if (timeframe.fromDate) where.blockTimestamp.gte = timeframe.fromDate;
    if (timeframe.toDate) where.blockTimestamp.lte = timeframe.toDate;
  }

  const [totalSales, aggregates, uniqueBuyers, uniqueSellers] =
    await Promise.all([
      prisma.marketplaceSale.count({ where }),
      prisma.marketplaceSale.aggregate({
        where,
        _sum: { blockNumber: true },
        _avg: { blockNumber: true },
        _min: { blockTimestamp: true },
        _max: { blockTimestamp: true },
      }),
      prisma.marketplaceSale
        .groupBy({
          by: ['buyer'],
          where,
        })
        .then((r) => r.length),
      prisma.marketplaceSale
        .groupBy({
          by: ['seller'],
          where,
        })
        .then((r) => r.length),
    ]);

  return {
    totalSales,
    totalVolume: '0', // Price field doesn't exist in schema
    averagePrice: '0', // Price field doesn't exist in schema
    minPrice: '0', // Price field doesn't exist in schema
    maxPrice: '0', // Price field doesn't exist in schema
    uniqueBuyers,
    uniqueSellers,
  };
}
