import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface AttributePrevalence {
  traitType: string;
  value: string;
  count: number;
  prevalence: number; // Percentage (0-100)
}

export interface RarityData {
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

/**
 * Calculate attribute prevalence for a collection
 * Returns a map of "traitType:value" -> prevalence percentage
 */
export async function calculateAttributePrevalence(
  contractAddress: string,
  chainId: number
): Promise<Map<string, AttributePrevalence>> {
  // Get total NFT count for the collection
  const totalNFTs = await prisma.nFT.count({
    where: {
      contractAddress,
      chainId,
    },
  });

  if (totalNFTs === 0) {
    return new Map();
  }

  // Get all attributes for the collection
  const attributes = await prisma.nFTAttribute.groupBy({
    by: ['traitType', 'value'],
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

  const prevalenceMap = new Map<string, AttributePrevalence>();

  for (const attr of attributes) {
    const key = `${attr.traitType}:${attr.value}`;
    const count = attr._count.id;
    const prevalence = (count / totalNFTs) * 100;

    prevalenceMap.set(key, {
      traitType: attr.traitType,
      value: attr.value,
      count,
      prevalence,
    });
  }

  return prevalenceMap;
}

/**
 * Update attribute prevalence in the database
 */
export async function updateAttributePrevalence(
  contractAddress: string,
  chainId: number
): Promise<void> {
  const prevalenceMap = await calculateAttributePrevalence(
    contractAddress,
    chainId
  );

  // Update each attribute with its prevalence
  for (const [, data] of prevalenceMap) {
    await prisma.nFTAttribute.updateMany({
      where: {
        traitType: data.traitType,
        value: data.value,
        nft: {
          contractAddress,
          chainId,
        },
      },
      data: {
        prevalence: data.prevalence,
        count: data.count,
      },
    });
  }
}

/**
 * Calculate rarity score for an NFT based on attribute prevalence
 * Lower prevalence = higher rarity score
 * Score = sum of (1 / prevalence) for each attribute
 */
export async function calculateRarityScore(nftId: string): Promise<number> {
  const attributes = await prisma.nFTAttribute.findMany({
    where: {
      nftId,
    },
    select: {
      prevalence: true,
    },
  });

  if (attributes.length === 0) {
    return 0;
  }

  let score = 0;
  for (const attr of attributes) {
    if (attr.prevalence && attr.prevalence > 0) {
      // Rarity score: inverse of prevalence
      score += 1 / (attr.prevalence / 100);
    }
  }

  return score;
}

/**
 * Calculate rarity rank for an NFT within its collection
 * Returns the rank (1 = rarest) and total supply
 */
export async function calculateRarityRank(
  nftId: string
): Promise<{ rank: number; maxRank: number }> {
  const nft = await prisma.nFT.findUnique({
    where: { id: nftId },
    select: {
      contractAddress: true,
      chainId: true,
    },
  });

  if (!nft) {
    throw new Error(`NFT not found: ${nftId}`);
  }

  // Get all NFTs in the collection with their rarity scores
  const allNFTs = await prisma.nFT.findMany({
    where: {
      contractAddress: nft.contractAddress,
      chainId: nft.chainId,
    },
    select: {
      id: true,
    },
  });

  // Calculate rarity scores for all NFTs
  const scores = await Promise.all(
    allNFTs.map(async (n) => ({
      id: n.id,
      score: await calculateRarityScore(n.id),
    }))
  );

  // Sort by score descending (highest score = rarest)
  scores.sort((a, b) => b.score - a.score);

  // Find rank of the target NFT
  const rank = scores.findIndex((s) => s.id === nftId) + 1;

  return {
    rank,
    maxRank: scores.length,
  };
}

/**
 * Calculate percentile ranking for an NFT
 * Returns a value between 0-100 where 100 = rarest
 */
export function calculatePercentile(rank: number, maxRank: number): number {
  if (maxRank === 0) return 0;
  return ((maxRank - rank + 1) / maxRank) * 100;
}

/**
 * Calculate complete rarity data for an NFT
 */
export async function calculateCompleteRarity(
  nftId: string
): Promise<RarityData> {
  const nft = await prisma.nFT.findUnique({
    where: { id: nftId },
    select: {
      contractAddress: true,
      chainId: true,
      contract: {
        select: {
          totalSupply: true,
        },
      },
    },
  });

  if (!nft) {
    throw new Error(`NFT not found: ${nftId}`);
  }

  const score = await calculateRarityScore(nftId);
  const { rank, maxRank } = await calculateRarityRank(nftId);
  const percentile = calculatePercentile(rank, maxRank);
  const totalSupply = parseInt(nft.contract.totalSupply || '0', 10);

  // Calculate overall prevalence (how common this NFT is)
  const prevalence = (rank / maxRank) * 100;

  return {
    strategyId: 'trait-rarity',
    strategyVersion: '1.0',
    rank,
    score,
    maxRank,
    totalSupply,
    rarityScore: score,
    prevalence,
    percentile,
  };
}

/**
 * Store rarity data in the database
 */
export async function storeRarityData(
  nftId: string,
  rarityData: RarityData
): Promise<void> {
  await prisma.nFTRarity.upsert({
    where: {
      nftId,
    },
    create: {
      nftId,
      ...rarityData,
      calculatedAt: new Date(),
    },
    update: {
      ...rarityData,
      calculatedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/**
 * Update rarity for a single NFT
 */
export async function updateNFTRarity(nftId: string): Promise<void> {
  const rarityData = await calculateCompleteRarity(nftId);
  await storeRarityData(nftId, rarityData);
}

/**
 * Update rarity for an entire collection
 * This should be run after attribute prevalence is calculated
 */
export async function updateCollectionRarity(
  contractAddress: string,
  chainId: number
): Promise<void> {
  // First, update attribute prevalence
  await updateAttributePrevalence(contractAddress, chainId);

  // Get all NFTs in the collection
  const nfts = await prisma.nFT.findMany({
    where: {
      contractAddress,
      chainId,
    },
    select: {
      id: true,
    },
  });

  // Calculate and store rarity for each NFT
  // Process in batches to avoid overwhelming the database
  const batchSize = 100;
  for (let i = 0; i < nfts.length; i += batchSize) {
    const batch = nfts.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (nft) => {
        try {
          await updateNFTRarity(nft.id);
        } catch (error) {
          console.error(`Error updating rarity for NFT ${nft.id}:`, error);
        }
      })
    );
  }
}

/**
 * Recalculate rarity when attributes change
 */
export async function recalculateRarityAfterAttributeChange(
  contractAddress: string,
  chainId: number
): Promise<void> {
  console.log(
    `Recalculating rarity for collection ${contractAddress} on chain ${chainId}`
  );
  await updateCollectionRarity(contractAddress, chainId);
}

/**
 * Get rarity data for an NFT
 */
export async function getRarityData(
  nftId: string
): Promise<RarityData | null> {
  const rarity = await prisma.nFTRarity.findUnique({
    where: {
      nftId,
    },
  });

  if (!rarity) {
    return null;
  }

  return {
    strategyId: rarity.strategyId,
    strategyVersion: rarity.strategyVersion,
    rank: rarity.rank,
    score: rarity.score,
    maxRank: rarity.maxRank,
    totalSupply: rarity.totalSupply,
    rarityScore: rarity.rarityScore,
    prevalence: rarity.prevalence,
    percentile: rarity.percentile,
  };
}

/**
 * Get top rarest NFTs in a collection
 */
export async function getTopRarestNFTs(
  contractAddress: string,
  chainId: number,
  limit: number = 10
): Promise<Array<{ nftId: string; rank: number; score: number }>> {
  const rarities = await prisma.nFTRarity.findMany({
    where: {
      nft: {
        contractAddress,
        chainId,
      },
    },
    orderBy: {
      rank: 'asc',
    },
    take: limit,
    select: {
      nftId: true,
      rank: true,
      score: true,
    },
  });

  return rarities;
}
