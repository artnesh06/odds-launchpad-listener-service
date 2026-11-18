import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

export interface NFTQueryOptions {
  chainId?: number;
  contractAddress?: string;
  ownerAddress?: string;
  attributes?: Array<{ traitType: string; value: string }>;
  excludeSpam?: boolean;
  excludeAirdrop?: boolean;
  limit?: number;
  cursor?: string; // For cursor-based pagination
  orderBy?: 'tokenId' | 'timeLastUpdated' | 'rarity';
  orderDirection?: 'asc' | 'desc';
}

export interface PaginatedNFTResult {
  nfts: any[];
  nextCursor?: string;
  hasMore: boolean;
  total: number;
}

/**
 * Query NFTs with advanced filtering and pagination
 */
export async function queryNFTs(
  options: NFTQueryOptions
): Promise<PaginatedNFTResult> {
  const {
    chainId,
    contractAddress,
    ownerAddress,
    attributes,
    excludeSpam = true,
    excludeAirdrop = true,
    limit = 50,
    cursor,
    orderBy = 'tokenId',
    orderDirection = 'asc',
  } = options;

  // Build where clause
  const where: Prisma.NFTWhereInput = {};

  if (chainId) {
    where.chainId = chainId;
  }

  if (contractAddress) {
    where.contractAddress = contractAddress.toLowerCase();
  }

  if (ownerAddress) {
    where.ownership = {
      some: {
        ownerAddress,
        isCurrent: true,
      },
    };
  }

  if (excludeSpam) {
    where.isSpam = false;
  }

  if (excludeAirdrop) {
    where.isAirdrop = false;
  }

  // Filter by attributes (all must match)
  if (attributes && attributes.length > 0) {
    where.AND = attributes.map((attr) => ({
      attributes: {
        some: {
          traitType: attr.traitType,
          value: attr.value,
        },
      },
    }));
  }

  // Build orderBy clause
  const orderByClause: Prisma.NFTOrderByWithRelationInput = {};
  if (orderBy === 'rarity') {
    orderByClause.rarity = {
      rank: orderDirection,
    };
  } else {
    orderByClause[orderBy] = orderDirection;
  }

  // Get total count
  const total = await prisma.nFT.count({ where });

  // Query with cursor pagination
  const nfts = await prisma.nFT.findMany({
    where,
    take: limit + 1, // Fetch one extra to check if there are more
    ...(cursor && {
      skip: 1, // Skip the cursor
      cursor: {
        id: cursor,
      },
    }),
    orderBy: orderByClause,
    include: {
      attributes: true,
      ownership: {
        where: {
          isCurrent: true,
        },
      },
      rarity: true,
      contract: {
        select: {
          name: true,
          symbol: true,
          openSeaCollectionName: true,
        },
      },
    },
  });

  // Check if there are more results
  const hasMore = nfts.length > limit;
  const results = hasMore ? nfts.slice(0, -1) : nfts;
  const nextCursor = hasMore ? results[results.length - 1].id : undefined;

  return {
    nfts: results,
    nextCursor,
    hasMore,
    total,
  };
}

/**
 * Query NFTs by multiple attribute combinations (OR logic)
 */
export async function queryNFTsByAttributeVariants(
  contractAddress: string,
  chainId: number,
  attributeVariants: Array<Array<{ traitType: string; value: string }>>,
  options: Omit<NFTQueryOptions, 'contractAddress' | 'chainId' | 'attributes'> = {}
): Promise<PaginatedNFTResult> {
  const {
    excludeSpam = true,
    excludeAirdrop = true,
    limit = 50,
    cursor,
    orderBy = 'tokenId',
    orderDirection = 'asc',
  } = options;

  // Build where clause with OR conditions for attribute variants
  const where: Prisma.NFTWhereInput = {
    contractAddress,
    chainId,
    ...(excludeSpam && { isSpam: false }),
    ...(excludeAirdrop && { isAirdrop: false }),
    OR: attributeVariants.map((variant) => ({
      AND: variant.map((attr) => ({
        attributes: {
          some: {
            traitType: attr.traitType,
            value: attr.value,
          },
        },
      })),
    })),
  };

  // Build orderBy clause
  const orderByClause: Prisma.NFTOrderByWithRelationInput = {};
  if (orderBy === 'rarity') {
    orderByClause.rarity = {
      rank: orderDirection,
    };
  } else {
    orderByClause[orderBy] = orderDirection;
  }

  // Get total count
  const total = await prisma.nFT.count({ where });

  // Query with cursor pagination
  const nfts = await prisma.nFT.findMany({
    where,
    take: limit + 1,
    ...(cursor && {
      skip: 1,
      cursor: {
        id: cursor,
      },
    }),
    orderBy: orderByClause,
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

  const hasMore = nfts.length > limit;
  const results = hasMore ? nfts.slice(0, -1) : nfts;
  const nextCursor = hasMore ? results[results.length - 1].id : undefined;

  return {
    nfts: results,
    nextCursor,
    hasMore,
    total,
  };
}

/**
 * Get NFTs owned by an address across all chains
 */
export async function getNFTsForOwner(
  ownerAddress: string,
  options: Omit<NFTQueryOptions, 'ownerAddress'> = {}
): Promise<PaginatedNFTResult> {
  return queryNFTs({
    ...options,
    ownerAddress,
  });
}

/**
 * Get NFTs in a collection
 */
export async function getNFTsInCollection(
  contractAddress: string,
  chainId: number,
  options: Omit<NFTQueryOptions, 'contractAddress' | 'chainId'> = {}
): Promise<PaginatedNFTResult> {
  return queryNFTs({
    ...options,
    contractAddress,
    chainId,
  });
}

/**
 * Get rarest NFTs in a collection
 */
export async function getRarestNFTs(
  contractAddress: string,
  chainId: number,
  limit: number = 10
): Promise<any[]> {
  return await prisma.nFT.findMany({
    where: {
      contractAddress,
      chainId,
      rarity: {
        isNot: null,
      },
    },
    orderBy: {
      rarity: {
        rank: 'asc',
      },
    },
    take: limit,
    include: {
      attributes: true,
      rarity: true,
      ownership: {
        where: {
          isCurrent: true,
        },
      },
    },
  });
}

/**
 * Get NFTs with numeric attribute in range
 */
export async function getNFTsByNumericAttributeRange(
  contractAddress: string,
  chainId: number,
  traitType: string,
  min: number,
  max: number,
  options: Omit<NFTQueryOptions, 'contractAddress' | 'chainId' | 'attributes'> = {}
): Promise<PaginatedNFTResult> {
  const {
    excludeSpam = true,
    excludeAirdrop = true,
    limit = 50,
    cursor,
  } = options;

  const where: Prisma.NFTWhereInput = {
    contractAddress,
    chainId,
    ...(excludeSpam && { isSpam: false }),
    ...(excludeAirdrop && { isAirdrop: false }),
    attributes: {
      some: {
        traitType,
        numericValue: {
          gte: min,
          lte: max,
        },
      },
    },
  };

  const total = await prisma.nFT.count({ where });

  const nfts = await prisma.nFT.findMany({
    where,
    take: limit + 1,
    ...(cursor && {
      skip: 1,
      cursor: {
        id: cursor,
      },
    }),
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

  const hasMore = nfts.length > limit;
  const results = hasMore ? nfts.slice(0, -1) : nfts;
  const nextCursor = hasMore ? results[results.length - 1].id : undefined;

  return {
    nfts: results,
    nextCursor,
    hasMore,
    total,
  };
}

/**
 * Get attribute distribution for a collection
 */
export async function getAttributeDistribution(
  contractAddress: string,
  chainId: number
): Promise<
  Array<{
    traitType: string;
    values: Array<{ value: string; count: number; prevalence: number }>;
  }>
> {
  const attributes = await prisma.nFTAttribute.groupBy({
    by: ['traitType', 'value', 'count', 'prevalence'],
    where: {
      nft: {
        contractAddress,
        chainId,
      },
    },
    _count: {
      id: true,
    },
  });

  // Group by trait type
  const distribution = new Map<
    string,
    Array<{ value: string; count: number; prevalence: number }>
  >();

  for (const attr of attributes) {
    if (!distribution.has(attr.traitType)) {
      distribution.set(attr.traitType, []);
    }

    distribution.get(attr.traitType)!.push({
      value: attr.value,
      count: attr.count || 0,
      prevalence: attr.prevalence || 0,
    });
  }

  // Convert to array
  return Array.from(distribution.entries()).map(([traitType, values]) => ({
    traitType,
    values: values.sort((a, b) => b.count - a.count),
  }));
}

/**
 * Search NFTs by name or description
 */
export async function searchNFTs(
  searchTerm: string,
  options: NFTQueryOptions = {}
): Promise<PaginatedNFTResult> {
  const {
    chainId,
    contractAddress,
    excludeSpam = true,
    excludeAirdrop = true,
    limit = 50,
    cursor,
  } = options;

  const where: Prisma.NFTWhereInput = {
    ...(chainId && { chainId }),
    ...(contractAddress && { contractAddress }),
    ...(excludeSpam && { isSpam: false }),
    ...(excludeAirdrop && { isAirdrop: false }),
    OR: [
      {
        name: {
          contains: searchTerm,
          mode: 'insensitive',
        },
      },
      {
        description: {
          contains: searchTerm,
          mode: 'insensitive',
        },
      },
    ],
  };

  const total = await prisma.nFT.count({ where });

  const nfts = await prisma.nFT.findMany({
    where,
    take: limit + 1,
    ...(cursor && {
      skip: 1,
      cursor: {
        id: cursor,
      },
    }),
    include: {
      attributes: true,
      ownership: {
        where: {
          isCurrent: true,
        },
      },
      rarity: true,
      contract: {
        select: {
          name: true,
          symbol: true,
        },
      },
    },
  });

  const hasMore = nfts.length > limit;
  const results = hasMore ? nfts.slice(0, -1) : nfts;
  const nextCursor = hasMore ? results[results.length - 1].id : undefined;

  return {
    nfts: results,
    nextCursor,
    hasMore,
    total,
  };
}
