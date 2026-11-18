/**
 * Sync Collection Transactions
 * 
 * Script untuk sync semua transaksi (mint, transfer, burn) dari 1 collection
 * 
 * Usage:
 *   npx tsx scripts/sync-collection.ts <contractAddress> <chainId> [fromBlock] [toBlock]
 * 
 * Examples:
 *   npx tsx scripts/sync-collection.ts 0x1234567890abcdef 6343
 *   npx tsx scripts/sync-collection.ts 0x1234567890abcdef 6343 10000
 *   npx tsx scripts/sync-collection.ts 0x1234567890abcdef 6343 10000 20000
 */

import { createCollectionSyncService } from '../src/lib/blockchain/collection-sync-service';
import { getChainConfig, initializeChainConfigCache } from '../src/config/chains';
import { prisma } from '../src/config/database';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('❌ Usage: npx tsx scripts/sync-collection.ts <contractAddress> <chainId> [fromBlock] [toBlock]');
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx scripts/sync-collection.ts 0x1234567890abcdef 6343');
    console.error('  npx tsx scripts/sync-collection.ts 0x1234567890abcdef 6343 10000');
    console.error('  npx tsx scripts/sync-collection.ts 0x1234567890abcdef 6343 10000 20000');
    process.exit(1);
  }

  const contractAddress = args[0].toLowerCase();
  const chainId = parseInt(args[1]);
  const fromBlock = args[2] ? parseInt(args[2]) : undefined;
  const toBlock = args[3] ? parseInt(args[3]) : undefined;

  console.log('🔄 Sync Collection Transactions');
  console.log('='.repeat(80));
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`From Block: ${fromBlock || 'deployment block'}`);
  console.log(`To Block: ${toBlock || 'latest'}`);
  console.log('='.repeat(80));
  console.log('');

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

    // Check launchpad exists
    const launchpad = await prisma.launchpad.findFirst({
      where: {
        chainId,
        contractAddress,
      },
      select: {
        id: true,
        name: true,
        mintedCount: true,
      },
    });

    if (!launchpad) {
      console.error(`❌ Launchpad not found: ${contractAddress} on chain ${chainId}`);
      process.exit(1);
    }

    // Get deployment block from activity
    const activity = await prisma.activity.findFirst({
      where: {
        chainId,
        type: 'LAUNCHPAD_CREATED',
        launchpadId: launchpad.id,
        blockNumber: { not: null },
      },
      select: {
        blockNumber: true,
      },
      orderBy: {
        blockNumber: 'asc',
      },
    });

    const deploymentBlock = activity?.blockNumber || null;

    console.log(`✅ Launchpad: ${launchpad.name}`);
    console.log(`   ID: ${launchpad.id}`);
    if (deploymentBlock) {
      console.log(`   Deployed at block: ${deploymentBlock}`);
    } else {
      console.log(`   ⚠️  Deployment block not found in activities`);
      console.log(`   Will use fromBlock parameter or first mint block`);
    }
    console.log(`   Current minted count: ${launchpad.mintedCount}`);
    console.log('');

    // Check current stats
    const currentStats = await prisma.nFTTransfer.groupBy({
      by: ['transferType'],
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

    console.log('📊 Current Transfer Stats:');
    currentStats.forEach((stat) => {
      console.log(`   ${stat.transferType}: ${stat._count.id}`);
    });
    console.log('');

    // Confirm before proceeding
    console.log('⚠️  This will sync all transactions for this collection.');
    console.log('   This may take several minutes for large collections.');
    console.log('   Press Ctrl+C to cancel, or wait 3 seconds to continue...');
    console.log('');

    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Create sync service (updateStats = false to prevent double counting)
    console.log('🚀 Starting collection sync...');
    console.log('   ⚠️  Stats will NOT be updated during sync to prevent double counting');
    console.log('   ✅ Stats will be recalculated after sync completes');
    console.log('');

    const syncService = createCollectionSyncService(chainId, chainConfig.rpcUrl, null, false);

    // Run sync
    const result = await syncService.syncCollectionTransactions({
      contractAddress,
      chainId,
      fromBlock,
      toBlock,
      skipExisting: true,
      batchSize: 1000,
      rpcUrl: chainConfig.rpcUrl,
    });

    console.log('');
    console.log('='.repeat(80));
    console.log('📊 Sync Result');
    console.log('='.repeat(80));
    console.log(`Success: ${result.success ? '✅' : '❌'}`);
    console.log(`Total Events: ${result.totalEvents}`);
    console.log(`Mints: ${result.mints}`);
    console.log(`Transfers: ${result.transfers}`);
    console.log(`Burns: ${result.burns}`);
    console.log(`Errors: ${result.errors}`);
    console.log(`From Block: ${result.fromBlock}`);
    console.log(`To Block: ${result.toBlock}`);
    console.log(`Duration: ${result.duration}ms (${(result.duration / 1000).toFixed(2)}s)`);

    if (result.errorDetails && result.errorDetails.length > 0) {
      console.log('');
      console.log('❌ Error Details:');
      result.errorDetails.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }

    console.log('');

    // Check updated stats
    const updatedStats = await prisma.nFTTransfer.groupBy({
      by: ['transferType'],
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

    console.log('📊 Updated Transfer Stats:');
    updatedStats.forEach((stat) => {
      console.log(`   ${stat.transferType}: ${stat._count.id}`);
    });
    console.log('');

    // Check updated launchpad
    const updatedLaunchpad = await prisma.launchpad.findFirst({
      where: {
        chainId,
        contractAddress,
      },
      select: {
        id: true,
        mintedCount: true,
        volume: true,
        lastMintAt: true,
      },
    });

    if (updatedLaunchpad) {
      console.log('📊 Current Launchpad Stats (before recalculation):');
      console.log(`   Minted Count: ${updatedLaunchpad.mintedCount}`);
      console.log(`   Volume: ${updatedLaunchpad.volume}`);
      console.log(`   Last Mint At: ${updatedLaunchpad.lastMintAt}`);
      console.log('');

      // Recalculate stats from actual data
      console.log('🔄 Recalculating stats from actual data...');
      
      const actualMintCount = await prisma.nFTTransfer.count({
        where: {
          nft: {
            contractAddress,
            chainId,
          },
          transferType: 'MINT',
        },
      });

      const mints = await prisma.mint.findMany({
        where: {
          launchpadId: updatedLaunchpad.id,
        },
        select: {
          price: true,
        },
      });

      const actualVolume = mints.reduce((sum, mint) => {
        return sum + BigInt(mint.price);
      }, BigInt(0)).toString();

      // Update with correct stats
      await prisma.launchpad.update({
        where: { id: updatedLaunchpad.id },
        data: {
          mintedCount: actualMintCount,
          volume: actualVolume,
        },
      });

      console.log('✅ Launchpad stats recalculated!');
      console.log(`   Minted Count: ${updatedLaunchpad.mintedCount} → ${actualMintCount}`);
      console.log(`   Volume: ${updatedLaunchpad.volume} → ${actualVolume}`);
      console.log('');

      // Recalculate launchpad analytics
      console.log('🔄 Recalculating launchpad analytics...');
      
      const avgMintPrice = actualMintCount > 0 
        ? (BigInt(actualVolume) / BigInt(actualMintCount)).toString()
        : '0';

      // Get last mint price
      const lastMint = await prisma.mint.findFirst({
        where: { launchpadId: updatedLaunchpad.id },
        orderBy: { createdAt: 'desc' },
        select: { price: true },
      });

      // Calculate unique holders from current NFT ownership
      const uniqueHoldersCount = await prisma.nFTOwnership.groupBy({
        by: ['ownerAddress'],
        where: {
          nft: {
            contractAddress,
            chainId,
          },
          isCurrent: true,
        },
        _count: {
          ownerAddress: true,
        },
      });

      const uniqueHolders = uniqueHoldersCount.length;

      // Get current analytics to preserve views and likes
      const currentAnalytics = await prisma.launchpadAnalytics.findUnique({
        where: { launchpadId: updatedLaunchpad.id },
        select: { views: true, likes: true },
      });

      // Upsert analytics
      await prisma.launchpadAnalytics.upsert({
        where: { launchpadId: updatedLaunchpad.id },
        create: {
          launchpadId: updatedLaunchpad.id,
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

      console.log('✅ Launchpad analytics recalculated!');
      console.log(`   Total Volume: ${actualVolume}`);
      console.log(`   Total Mints: ${actualMintCount}`);
      console.log(`   Unique Holders: ${uniqueHolders}`);
      console.log(`   Avg Mint Price: ${avgMintPrice}`);
      console.log(`   Last Sale Price: ${lastMint?.price || '0'}`);
      console.log('');
    }

    // Summary
    console.log('='.repeat(80));
    if (result.success) {
      console.log('✅ Collection sync completed successfully!');
    } else {
      console.log('❌ Collection sync failed!');
    }
    console.log('='.repeat(80));

    process.exit(result.success ? 0 : 1);
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
