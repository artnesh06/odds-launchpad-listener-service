/**
 * Spam Filter
 * Filters out spam and airdrop NFTs from queries
 */

import { Prisma } from '@prisma/client';

export interface SpamFilterOptions {
  excludeSpam?: boolean;
  excludeAirdrop?: boolean;
  includeSpam?: boolean;
  includeAirdrop?: boolean;
}

/**
 * Build Prisma where clause for spam filtering
 */
export function buildSpamFilter(
  options: SpamFilterOptions = {}
): Prisma.NFTWhereInput {
  const filter: Prisma.NFTWhereInput = {};

  // Default behavior: exclude spam and airdrops unless explicitly included
  const shouldExcludeSpam =
    options.excludeSpam !== false && !options.includeSpam;
  const shouldExcludeAirdrop =
    options.excludeAirdrop !== false && !options.includeAirdrop;

  if (shouldExcludeSpam) {
    filter.isSpam = false;
  } else if (options.includeSpam === true) {
    // Explicitly include spam
    filter.isSpam = true;
  }

  if (shouldExcludeAirdrop) {
    filter.isAirdrop = false;
  } else if (options.includeAirdrop === true) {
    // Explicitly include airdrops
    filter.isAirdrop = true;
  }

  return filter;
}

/**
 * Apply spam filter to existing where clause
 */
export function applySpamFilter(
  whereClause: Prisma.NFTWhereInput,
  options: SpamFilterOptions = {}
): Prisma.NFTWhereInput {
  const spamFilter = buildSpamFilter(options);

  return {
    ...whereClause,
    ...spamFilter,
  };
}

/**
 * Check if NFT should be filtered out
 */
export function shouldFilterNFT(
  nft: { isSpam: boolean; isAirdrop: boolean },
  options: SpamFilterOptions = {}
): boolean {
  const shouldExcludeSpam =
    options.excludeSpam !== false && !options.includeSpam;
  const shouldExcludeAirdrop =
    options.excludeAirdrop !== false && !options.includeAirdrop;

  if (shouldExcludeSpam && nft.isSpam) {
    return true;
  }

  if (shouldExcludeAirdrop && nft.isAirdrop) {
    return true;
  }

  return false;
}

/**
 * Filter NFT array based on spam settings
 */
export function filterNFTs<T extends { isSpam: boolean; isAirdrop: boolean }>(
  nfts: T[],
  options: SpamFilterOptions = {}
): T[] {
  return nfts.filter((nft) => !shouldFilterNFT(nft, options));
}

/**
 * Get spam statistics for a collection
 */
export async function getSpamStats(
  prisma: any,
  contractAddress: string,
  chainId: number
): Promise<{
  total: number;
  spam: number;
  airdrop: number;
  clean: number;
  spamPercentage: number;
  airdropPercentage: number;
}> {
  const [total, spam, airdrop] = await Promise.all([
    prisma.nFT.count({
      where: { contractAddress, chainId },
    }),
    prisma.nFT.count({
      where: { contractAddress, chainId, isSpam: true },
    }),
    prisma.nFT.count({
      where: { contractAddress, chainId, isAirdrop: true },
    }),
  ]);

  const clean = total - spam - airdrop;

  return {
    total,
    spam,
    airdrop,
    clean,
    spamPercentage: total > 0 ? (spam / total) * 100 : 0,
    airdropPercentage: total > 0 ? (airdrop / total) * 100 : 0,
  };
}

/**
 * Mark NFT as spam
 */
export async function markAsSpam(
  prisma: any,
  nftId: string,
  reason?: string
): Promise<void> {
  await prisma.nFT.update({
    where: { id: nftId },
    data: {
      isSpam: true,
      timeLastUpdated: new Date(),
    },
  });

  // Log the spam marking
  console.log(`Marked NFT ${nftId} as spam${reason ? `: ${reason}` : ''}`);
}

/**
 * Mark NFT as airdrop
 */
export async function markAsAirdrop(
  prisma: any,
  nftId: string,
  reason?: string
): Promise<void> {
  await prisma.nFT.update({
    where: { id: nftId },
    data: {
      isAirdrop: true,
      timeLastUpdated: new Date(),
    },
  });

  // Log the airdrop marking
  console.log(`Marked NFT ${nftId} as airdrop${reason ? `: ${reason}` : ''}`);
}

/**
 * Unmark NFT as spam
 */
export async function unmarkAsSpam(prisma: any, nftId: string): Promise<void> {
  await prisma.nFT.update({
    where: { id: nftId },
    data: {
      isSpam: false,
      timeLastUpdated: new Date(),
    },
  });

  console.log(`Unmarked NFT ${nftId} as spam`);
}

/**
 * Unmark NFT as airdrop
 */
export async function unmarkAsAirdrop(
  prisma: any,
  nftId: string
): Promise<void> {
  await prisma.nFT.update({
    where: { id: nftId },
    data: {
      isAirdrop: false,
      timeLastUpdated: new Date(),
    },
  });

  console.log(`Unmarked NFT ${nftId} as airdrop`);
}

/**
 * Bulk mark NFTs as spam
 */
export async function bulkMarkAsSpam(
  prisma: any,
  nftIds: string[]
): Promise<number> {
  const result = await prisma.nFT.updateMany({
    where: { id: { in: nftIds } },
    data: {
      isSpam: true,
      timeLastUpdated: new Date(),
    },
  });

  console.log(`Bulk marked ${result.count} NFTs as spam`);
  return result.count;
}

/**
 * Bulk mark NFTs as airdrop
 */
export async function bulkMarkAsAirdrop(
  prisma: any,
  nftIds: string[]
): Promise<number> {
  const result = await prisma.nFT.updateMany({
    where: { id: { in: nftIds } },
    data: {
      isAirdrop: true,
      timeLastUpdated: new Date(),
    },
  });

  console.log(`Bulk marked ${result.count} NFTs as airdrop`);
  return result.count;
}

/**
 * Mark entire collection as spam
 */
export async function markCollectionAsSpam(
  prisma: any,
  contractAddress: string,
  chainId: number
): Promise<number> {
  const result = await prisma.nFT.updateMany({
    where: { contractAddress, chainId },
    data: {
      isSpam: true,
      timeLastUpdated: new Date(),
    },
  });

  console.log(
    `Marked collection ${contractAddress} (${result.count} NFTs) as spam`
  );
  return result.count;
}
