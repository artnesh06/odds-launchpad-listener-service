import { PrismaClient } from '@prisma/client';
import { updateCollectionAnalytics } from './analytics-calculator';
import { updateCollectionRarity } from './rarity-calculator';

const prisma = new PrismaClient();

export interface SchedulerConfig {
  analyticsUpdateInterval: number; // in milliseconds
  rarityUpdateInterval: number; // in milliseconds
  batchSize: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  analyticsUpdateInterval: 5 * 60 * 1000, // 5 minutes
  rarityUpdateInterval: 60 * 60 * 1000, // 1 hour
  batchSize: 10,
};

let analyticsIntervalId: NodeJS.Timeout | null = null;
let rarityIntervalId: NodeJS.Timeout | null = null;

/**
 * Update analytics for all collections incrementally
 */
export async function updateAllCollectionsAnalytics(
  batchSize: number = DEFAULT_CONFIG.batchSize
): Promise<void> {
  console.log('Starting incremental analytics update for all collections...');

  try {
    // Get all unique contract addresses
    const contracts = await prisma.nFTContract.findMany({
      select: {
        address: true,
        chainId: true,
      },
    });

    console.log(`Found ${contracts.length} contracts to update`);

    // Process in batches
    for (let i = 0; i < contracts.length; i += batchSize) {
      const batch = contracts.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (contract) => {
          try {
            await updateCollectionAnalytics(contract.address, contract.chainId);
            console.log(
              `Updated analytics for ${contract.address} on chain ${contract.chainId}`
            );
          } catch (error) {
            console.error(
              `Error updating analytics for ${contract.address}:`,
              error
            );
          }
        })
      );

      // Small delay between batches to avoid overwhelming the database
      if (i + batchSize < contracts.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    console.log('Completed analytics update for all collections');
  } catch (error) {
    console.error('Error in updateAllCollectionsAnalytics:', error);
  }
}

/**
 * Update rarity for all collections incrementally
 */
export async function updateAllCollectionsRarity(
  batchSize: number = DEFAULT_CONFIG.batchSize
): Promise<void> {
  console.log('Starting incremental rarity update for all collections...');

  try {
    // Get all unique contract addresses
    const contracts = await prisma.nFTContract.findMany({
      select: {
        address: true,
        chainId: true,
      },
    });

    console.log(`Found ${contracts.length} contracts to update rarity`);

    // Process in batches
    for (let i = 0; i < contracts.length; i += batchSize) {
      const batch = contracts.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (contract) => {
          try {
            await updateCollectionRarity(contract.address, contract.chainId);
            console.log(
              `Updated rarity for ${contract.address} on chain ${contract.chainId}`
            );
          } catch (error) {
            console.error(
              `Error updating rarity for ${contract.address}:`,
              error
            );
          }
        })
      );

      // Longer delay between batches for rarity updates (more intensive)
      if (i + batchSize < contracts.length) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    console.log('Completed rarity update for all collections');
  } catch (error) {
    console.error('Error in updateAllCollectionsRarity:', error);
  }
}

/**
 * Start the analytics update scheduler
 */
export function startAnalyticsScheduler(
  config: Partial<SchedulerConfig> = {}
): void {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  if (analyticsIntervalId) {
    console.log('Analytics scheduler is already running');
    return;
  }

  console.log(
    `Starting analytics scheduler with interval: ${finalConfig.analyticsUpdateInterval}ms`
  );

  // Run immediately on start
  updateAllCollectionsAnalytics(finalConfig.batchSize);

  // Then run on interval
  analyticsIntervalId = setInterval(() => {
    updateAllCollectionsAnalytics(finalConfig.batchSize);
  }, finalConfig.analyticsUpdateInterval);
}

/**
 * Start the rarity update scheduler
 */
export function startRarityScheduler(
  config: Partial<SchedulerConfig> = {}
): void {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  if (rarityIntervalId) {
    console.log('Rarity scheduler is already running');
    return;
  }

  console.log(
    `Starting rarity scheduler with interval: ${finalConfig.rarityUpdateInterval}ms`
  );

  // Run immediately on start
  updateAllCollectionsRarity(finalConfig.batchSize);

  // Then run on interval
  rarityIntervalId = setInterval(() => {
    updateAllCollectionsRarity(finalConfig.batchSize);
  }, finalConfig.rarityUpdateInterval);
}

/**
 * Stop the analytics scheduler
 */
export function stopAnalyticsScheduler(): void {
  if (analyticsIntervalId) {
    clearInterval(analyticsIntervalId);
    analyticsIntervalId = null;
    console.log('Analytics scheduler stopped');
  }
}

/**
 * Stop the rarity scheduler
 */
export function stopRarityScheduler(): void {
  if (rarityIntervalId) {
    clearInterval(rarityIntervalId);
    rarityIntervalId = null;
    console.log('Rarity scheduler stopped');
  }
}

/**
 * Start all schedulers
 */
export function startAllSchedulers(
  config: Partial<SchedulerConfig> = {}
): void {
  startAnalyticsScheduler(config);
  startRarityScheduler(config);
}

/**
 * Stop all schedulers
 */
export function stopAllSchedulers(): void {
  stopAnalyticsScheduler();
  stopRarityScheduler();
}

/**
 * Update analytics for a specific collection immediately
 */
export async function updateCollectionAnalyticsNow(
  contractAddress: string,
  chainId: number
): Promise<void> {
  console.log(
    `Updating analytics for ${contractAddress} on chain ${chainId}...`
  );
  await updateCollectionAnalytics(contractAddress, chainId);
  console.log('Analytics update completed');
}

/**
 * Update rarity for a specific collection immediately
 */
export async function updateCollectionRarityNow(
  contractAddress: string,
  chainId: number
): Promise<void> {
  console.log(`Updating rarity for ${contractAddress} on chain ${chainId}...`);
  await updateCollectionRarity(contractAddress, chainId);
  console.log('Rarity update completed');
}
