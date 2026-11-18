/**
 * Sync All Factory Collections
 * 
 * Script untuk sync semua collection dari 1 factory address
 * 
 * Usage:
 *   npx tsx scripts/sync-factory-collections.ts <factoryAddress> <chainId> [fromBlock] [toBlock]
 * 
 * Examples:
 *   npx tsx scripts/sync-factory-collections.ts 0x1234567890abcdef 6343
 *   npx tsx scripts/sync-factory-collections.ts 0x1234567890abcdef 6343 10000
 *   npx tsx scripts/sync-factory-collections.ts 0x1234567890abcdef 6343 10000 20000
 */

import { createCollectionSyncService } from '../src/lib/blockchain/collection-sync-service';
import { getChainConfig, initializeChainConfigCache } from '../src/config/chains';
import { prisma } from '../src/config/database';

interface CollectionSyncSummary {
  contractAddress: string;
  name: string;
  success: boolean;
  totalEvents: number;
  mints: number;
  transfers: number;
  burns: number;
  errors: number;
  duration: number;
  errorMessage?: string;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('❌ Usage: npx tsx scripts/sync-factory-collections.ts <factoryAddress> <chainId> [fromBlock] [toBlock]');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx scripts/sync-factory-collections.ts 0x1234567890abcdef 6343');
    console.error('  npx tsx scripts/sync-factory-collections.ts 0x1234567890abcdef 6343 10000');
    console.error('  npx tsx scripts/sync-factory-collections.ts 0x1234567890abcdef 6343 10000 20000');
    process.exit(1);
  }

  const factoryAddress = args[0].toLowerCase();
  const chainId = parseInt(args[1]);
  const fromBlockOverride = args[2] ? parseInt(args[2]) : undefined;
  const toBlock = args[3] ? parseInt(args[3]) : undefined;

  console.log('🏭 Sync All Factory Collections');
  console.log('='.repeat(80));
  console.log(`Factory Address: ${factoryAddress}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`From Block Override: ${fromBlockOverride || 'use factory deployment block'}`);
  console.log(`To Block: ${toBlock || 'latest'}`);
  console.log('='.repeat(80));
  console.log('');

  const startTime = Date.now();
  const summaries: CollectionSyncSummary[] = [];

  try {
    // Initialize chain config cache from database
    await initializeChainConfigCache();

    // Validate chain
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig) {
      console.error(`❌ Chain ${chainId} not supported`);
      process.exit(1);
    }

    if (!chainConfig.rpcUrl) {
      console.error(`❌ RPC URL not configured for chain ${chainId}`);
      console.error(`   Please set CHAIN_${chainId}_RPC_URL environment variable`);
      process.exit(1);
    }

    console.log(`✅ Chain: ${chainConfig.name}`);
    console.log(`   RPC: ${chainConfig.rpcUrl}`);
    console.log('');

    // Check factory exists
    const factory = await prisma.launchpadFactory.findFirst({
      where: {
        chainId,
        contractAddress: factoryAddress,
      },
      select: {
        id: true,
        version: true,
        totalLaunchpads: true,
        deployedAt: true,
      },
    });

    if (!factory) {
      console.error(`❌ Factory not found: ${factoryAddress} on chain ${chainId}`);
      process.exit(1);
    }

    // Get factory deployment block
    const factoryActivity = await prisma.activity.findFirst({
      where: {
        chainId,
        factoryId: factory.id,
        type: 'FACTORY_CREATED',
        blockNumber: { not: null },
      },
      select: {
        blockNumber: true,
      },
      orderBy: {
        blockNumber: 'asc',
      },
    });

    const factoryDeploymentBlock = factoryActivity?.blockNumber || null;
    const fromBlock = fromBlockOverride || factoryDeploymentBlock;

    console.log(`✅ Factory: v${factory.version}`);
    console.log(`   ID: ${factory.id}`);
    console.log(`   Total Launchpads: ${factory.totalLaunchpads}`);
    if (factoryDeploymentBlock) {
      console.log(`   Deployed at block: ${factoryDeploymentBlock}`);
    }
    if (fromBlock) {
      console.log(`   Sync from block: ${fromBlock}`);
    } else {
      console.log(`   ⚠️  Factory deployment block not found, will use each collection's deployment block`);
    }
    console.log('');

    // Get all launchpads from this factory
    const launchpads = await prisma.launchpad.findMany({
      where: {
        chainId,
        factoryId: factory.id,
      },
      select: {
        id: true,
        contractAddress: true,
        name: true,
        mintedCount: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (launchpads.length === 0) {
      console.log('⚠️  No launchpads found for this factory');
      process.exit(0);
    }

    console.log(`📦 Found ${launchpads.length} collections to sync`);
    console.log('');

    // Confirm before proceeding
    console.log('⚠️  This will sync ALL collections from this factory.');
    console.log('   This may take a long time for factories with many collections.');
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    console.log('');

    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Create sync service (updateStats = false to prevent double counting)
    const syncService = createCollectionSyncService(chainId, chainConfig.rpcUrl, null, false);

    // Sync each collection
    for (let i = 0; i < launchpads.length; i++) {
      const launchpad = launchpads[i];
      
      console.log('');
      console.log('='.repeat(80));
      console.log(`📦 Collection ${i + 1}/${launchpads.length}: ${launchpad.name}`);
      console.log('='.repeat(80));
      console.log(`   Contract: ${launchpad.contractAddress}`);
      console.log(`   Current Minted Count: ${launchpad.mintedCount}`);
      console.log('');

      try {
        // Run sync
        const result = await syncService.syncCollectionTransactions({
          contractAddress: launchpad.contractAddress,
          chainId,
          fromBlock: fromBlock ?? undefined,
          toBlock,
          skipExisting: true,
          batchSize: 1000,
          rpcUrl: chainConfig.rpcUrl,
        });

        // Store summary
        summaries.push({
          contractAddress: launchpad.contractAddress,
          name: launchpad.name,
          success: result.success,
          totalEvents: result.totalEvents,
          mints: result.mints,
          transfers: result.transfers,
          burns: result.burns,
          errors: result.errors,
          duration: result.duration,
          errorMessage: result.errorDetails?.[0],
        });

        console.log('');
        console.log(`${result.success ? '✅' : '❌'} Collection sync ${result.success ? 'completed' : 'failed'}`);
        console.log(`   Total Events: ${result.totalEvents}`);
        console.log(`   Mints: ${result.mints}`);
        console.log(`   Transfers: ${result.transfers}`);
        console.log(`   Burns: ${result.burns}`);
        console.log(`   Errors: ${result.errors}`);
        console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);

        // Recalculate stats for this collection
        if (result.success && result.totalEvents > 0) {
          console.log('');
          console.log('🔄 Recalculating stats...');

          const actualMintCount = await prisma.nFTTransfer.count({
            where: {
              nft: {
                contractAddress: launchpad.contractAddress,
                chainId,
              },
              transferType: 'MINT',
            },
          });

          const mints = await prisma.mint.findMany({
            where: {
              launchpadId: launchpad.id,
            },
            select: {
              price: true,
            },
          });

          const actualVolume = mints.reduce((sum, mint) => {
            return sum + BigInt(mint.price);
          }, BigInt(0)).toString();

          // Update launchpad
          await prisma.launchpad.update({
            where: { id: launchpad.id },
            data: {
              mintedCount: actualMintCount,
              volume: actualVolume,
            },
          });

          // Recalculate analytics
          const avgMintPrice = actualMintCount > 0 
            ? (BigInt(actualVolume) / BigInt(actualMintCount)).toString()
            : '0';

          const lastMint = await prisma.mint.findFirst({
            where: { launchpadId: launchpad.id },
            orderBy: { createdAt: 'desc' },
            select: { price: true },
          });

          const uniqueHoldersCount = await prisma.nFTOwnership.groupBy({
            by: ['ownerAddress'],
            where: {
              nft: {
                contractAddress: launchpad.contractAddress,
                chainId,
              },
              isCurrent: true,
            },
            _count: {
              ownerAddress: true,
            },
          });

          const uniqueHolders = uniqueHoldersCount.length;

          const currentAnalytics = await prisma.launchpadAnalytics.findUnique({
            where: { launchpadId: launchpad.id },
            select: { views: true, likes: true },
          });

          await prisma.launchpadAnalytics.upsert({
            where: { launchpadId: launchpad.id },
            create: {
              launchpadId: launchpad.id,
              totalVolume: actualVolume,
              totalMints: actualMintCount,
              uniqueHolders,
              avgMintPrice,
              lastSalePrice: lastMint?.price || '0',
              views: 0,
              likes: 0,
              calculatedAt: new Date(),
            },
            update: {
              totalVolume: actualVolume,
              totalMints: actualMintCount,
              uniqueHolders,
              avgMintPrice,
              lastSalePrice: lastMint?.price || '0',
              views: currentAnalytics?.views || 0,
              likes: currentAnalytics?.likes || 0,
              calculatedAt: new Date(),
            },
          });

          console.log('✅ Stats recalculated!');
          console.log(`   Minted Count: ${launchpad.mintedCount} → ${actualMintCount}`);
          console.log(`   Volume: ${actualVolume}`);
          console.log(`   Unique Holders: ${uniqueHolders}`);
          console.log(`   Avg Mint Price: ${avgMintPrice}`);
        }

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ Error syncing collection: ${errorMsg}`);
        
        summaries.push({
          contractAddress: launchpad.contractAddress,
          name: launchpad.name,
          success: false,
          totalEvents: 0,
          mints: 0,
          transfers: 0,
          burns: 0,
          errors: 1,
          duration: 0,
          errorMessage: errorMsg,
        });
      }

      // Small delay between collections to avoid rate limiting
      if (i < launchpads.length - 1) {
        console.log('');
        console.log('⏳ Waiting 2 seconds before next collection...');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    const totalDuration = Date.now() - startTime;

    // Print summary
    console.log('');
    console.log('');
    console.log('='.repeat(80));
    console.log('📊 FACTORY SYNC SUMMARY');
    console.log('='.repeat(80));
    console.log(`Factory: ${factoryAddress}`);
    console.log(`Chain: ${chainConfig.name} (${chainId})`);
    console.log(`Total Collections: ${summaries.length}`);
    console.log(`Total Duration: ${(totalDuration / 1000).toFixed(2)}s (${(totalDuration / 60000).toFixed(2)} minutes)`);
    console.log('');

    const successCount = summaries.filter(s => s.success).length;
    const failedCount = summaries.filter(s => !s.success).length;
    const totalEvents = summaries.reduce((sum, s) => sum + s.totalEvents, 0);
    const totalMints = summaries.reduce((sum, s) => sum + s.mints, 0);
    const totalTransfers = summaries.reduce((sum, s) => sum + s.transfers, 0);
    const totalBurns = summaries.reduce((sum, s) => sum + s.burns, 0);
    const totalErrors = summaries.reduce((sum, s) => sum + s.errors, 0);

    console.log('📈 Overall Stats:');
    console.log(`   Successful: ${successCount}`);
    console.log(`   Failed: ${failedCount}`);
    console.log(`   Total Events: ${totalEvents}`);
    console.log(`   Total Mints: ${totalMints}`);
    console.log(`   Total Transfers: ${totalTransfers}`);
    console.log(`   Total Burns: ${totalBurns}`);
    console.log(`   Total Errors: ${totalErrors}`);
    console.log('');

    console.log('📋 Collection Details:');
    console.log('');
    summaries.forEach((summary, index) => {
      const status = summary.success ? '✅' : '❌';
      console.log(`${index + 1}. ${status} ${summary.name}`);
      console.log(`   Contract: ${summary.contractAddress}`);
      console.log(`   Events: ${summary.totalEvents} (M:${summary.mints} T:${summary.transfers} B:${summary.burns})`);
      console.log(`   Duration: ${(summary.duration / 1000).toFixed(2)}s`);
      if (!summary.success && summary.errorMessage) {
        console.log(`   Error: ${summary.errorMessage}`);
      }
      console.log('');
    });

    console.log('='.repeat(80));
    if (failedCount === 0) {
      console.log('✅ All collections synced successfully!');
    } else {
      console.log(`⚠️  ${successCount} collections synced, ${failedCount} failed`);
    }
    console.log('='.repeat(80));

    process.exit(failedCount === 0 ? 0 : 1);
  } catch (error) {
    console.error('');
    console.error('='.repeat(80));
    console.error('❌ Fatal Error');
    console.error('='.repeat(80));
    console.error(error);
    console.error('');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
