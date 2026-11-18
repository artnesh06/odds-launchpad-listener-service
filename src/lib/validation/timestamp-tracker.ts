/**
 * Timestamp Tracker
 * Tracks and updates timestamps for NFT metadata and status changes
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Update NFT metadata timestamp
 */
export async function updateMetadataTimestamp(nftId: string): Promise<void> {
  await prisma.nFT.update({
    where: { id: nftId },
    data: {
      timeLastUpdated: new Date(),
    },
  });
}

/**
 * Update multiple NFT metadata timestamps
 */
export async function updateMultipleMetadataTimestamps(
  nftIds: string[]
): Promise<number> {
  const result = await prisma.nFT.updateMany({
    where: { id: { in: nftIds } },
    data: {
      timeLastUpdated: new Date(),
    },
  });

  return result.count;
}

/**
 * Update spam status with timestamp
 */
export async function updateSpamStatus(
  nftId: string,
  isSpam: boolean
): Promise<void> {
  await prisma.nFT.update({
    where: { id: nftId },
    data: {
      isSpam,
      timeLastUpdated: new Date(),
    },
  });
}

/**
 * Update airdrop status with timestamp
 */
export async function updateAirdropStatus(
  nftId: string,
  isAirdrop: boolean
): Promise<void> {
  await prisma.nFT.update({
    where: { id: nftId },
    data: {
      isAirdrop,
      timeLastUpdated: new Date(),
    },
  });
}

/**
 * Track metadata change and update timestamp
 */
export async function trackMetadataChange(
  nftId: string,
  changes: {
    name?: string;
    description?: string;
    tokenUri?: string;
    imageCachedUrl?: string;
    rawMetadata?: any;
  }
): Promise<void> {
  await prisma.nFT.update({
    where: { id: nftId },
    data: {
      ...changes,
      timeLastUpdated: new Date(),
    },
  });
}

/**
 * Get NFTs that need metadata refresh (older than threshold)
 */
export async function getNFTsNeedingRefresh(
  thresholdHours: number = 24,
  limit: number = 100
): Promise<
  Array<{
    id: string;
    contractAddress: string;
    tokenId: string;
    chainId: number;
    timeLastUpdated: Date;
  }>
> {
  const threshold = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

  return await prisma.nFT.findMany({
    where: {
      timeLastUpdated: {
        lt: threshold,
      },
    },
    select: {
      id: true,
      contractAddress: true,
      tokenId: true,
      chainId: true,
      timeLastUpdated: true,
    },
    orderBy: {
      timeLastUpdated: 'asc',
    },
    take: limit,
  });
}

/**
 * Get timestamp statistics for a collection
 */
export async function getTimestampStats(
  contractAddress: string,
  chainId: number
): Promise<{
  total: number;
  lastUpdated: Date | null;
  oldestUpdate: Date | null;
  averageAge: number; // in hours
  needsRefresh: number; // older than 24 hours
}> {
  const nfts = await prisma.nFT.findMany({
    where: { contractAddress, chainId },
    select: { timeLastUpdated: true },
  });

  if (nfts.length === 0) {
    return {
      total: 0,
      lastUpdated: null,
      oldestUpdate: null,
      averageAge: 0,
      needsRefresh: 0,
    };
  }

  const now = Date.now();
  const timestamps = nfts.map((nft) => nft.timeLastUpdated.getTime());
  const lastUpdated = new Date(Math.max(...timestamps));
  const oldestUpdate = new Date(Math.min(...timestamps));

  const totalAge = timestamps.reduce((sum, ts) => sum + (now - ts), 0);
  const averageAge = totalAge / timestamps.length / (1000 * 60 * 60); // hours

  const threshold24h = now - 24 * 60 * 60 * 1000;
  const needsRefresh = timestamps.filter((ts) => ts < threshold24h).length;

  return {
    total: nfts.length,
    lastUpdated,
    oldestUpdate,
    averageAge,
    needsRefresh,
  };
}

/**
 * Bulk update timestamps for collection
 */
export async function bulkUpdateCollectionTimestamps(
  contractAddress: string,
  chainId: number
): Promise<number> {
  const result = await prisma.nFT.updateMany({
    where: { contractAddress, chainId },
    data: {
      timeLastUpdated: new Date(),
    },
  });

  return result.count;
}

/**
 * Track status change history (for spam/airdrop changes)
 */
export interface StatusChange {
  nftId: string;
  field: 'isSpam' | 'isAirdrop';
  oldValue: boolean;
  newValue: boolean;
  timestamp: Date;
  reason?: string;
}

// In-memory tracking (could be moved to database if needed)
const statusChangeHistory: StatusChange[] = [];
const MAX_HISTORY_SIZE = 1000;

/**
 * Record status change
 */
export function recordStatusChange(change: StatusChange): void {
  statusChangeHistory.unshift(change);

  // Keep only recent changes
  if (statusChangeHistory.length > MAX_HISTORY_SIZE) {
    statusChangeHistory.pop();
  }
}

/**
 * Get status change history for NFT
 */
export function getStatusChangeHistory(
  nftId: string,
  limit: number = 10
): StatusChange[] {
  return statusChangeHistory
    .filter((change) => change.nftId === nftId)
    .slice(0, limit);
}

/**
 * Get recent status changes
 */
export function getRecentStatusChanges(limit: number = 50): StatusChange[] {
  return statusChangeHistory.slice(0, limit);
}

/**
 * Clear status change history
 */
export function clearStatusChangeHistory(): void {
  statusChangeHistory.length = 0;
}

/**
 * Update spam status and track change
 */
export async function updateSpamStatusWithTracking(
  nftId: string,
  isSpam: boolean,
  reason?: string
): Promise<void> {
  // Get current value
  const nft = await prisma.nFT.findUnique({
    where: { id: nftId },
    select: { isSpam: true },
  });

  if (!nft) {
    throw new Error(`NFT ${nftId} not found`);
  }

  // Update status
  await updateSpamStatus(nftId, isSpam);

  // Record change
  recordStatusChange({
    nftId,
    field: 'isSpam',
    oldValue: nft.isSpam,
    newValue: isSpam,
    timestamp: new Date(),
    reason,
  });
}

/**
 * Update airdrop status and track change
 */
export async function updateAirdropStatusWithTracking(
  nftId: string,
  isAirdrop: boolean,
  reason?: string
): Promise<void> {
  // Get current value
  const nft = await prisma.nFT.findUnique({
    where: { id: nftId },
    select: { isAirdrop: true },
  });

  if (!nft) {
    throw new Error(`NFT ${nftId} not found`);
  }

  // Update status
  await updateAirdropStatus(nftId, isAirdrop);

  // Record change
  recordStatusChange({
    nftId,
    field: 'isAirdrop',
    oldValue: nft.isAirdrop,
    newValue: isAirdrop,
    timestamp: new Date(),
    reason,
  });
}
