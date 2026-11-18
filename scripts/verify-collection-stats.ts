/**
 * Verify Collection Stats
 * 
 * Script untuk verify dan fix stats collection
 * 
 * Usage:
 *   npx tsx scripts/verify-collection-stats.ts <contractAddress> <chainId>
 */

import { prisma } from '../src/config/database';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('❌ Usage: npx tsx scripts/verify-collection-stats.ts <contractAddress> <chainId>');
    process.exit(1);
  }

  const contractAddress = args[0].toLowerCase();
  const chainId = parseInt(args[1]);

  console.log('🔍 Verifying Collection Stats');
  console.log('='.repeat(80));
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Chain ID: ${chainId}`);
  console.log('='.repeat(80));
  console.log('');

  try {
    // Get launchpad
    const launchpad = await prisma.launchpad.findFirst({
      where: {
        contractAddress,
        chainId,
      },
      select: {
        id: true,
        name: true,
        mintedCount: true,
        volume: true,
      },
    });

    if (!launchpad) {
      console.error(`❌ Launchpad not found`);
      process.exit(1);
    }

    console.log(`✅ Launchpad: ${launchpad.name}`);
    console.log('');

    // Count actual mints from nft_transfers
    const actualMints = await prisma.nFTTransfer.count({
      where: {
        nft: {
          contractAddress,
          chainId,
        },
        transferType: 'MINT',
      },
    });

    // Count actual transfers
    const actualTransfers = await prisma.nFTTransfer.count({
      where: {
        nft: {
          contractAddress,
          chainId,
        },
        transferType: 'TRANSFER',
      },
    });

    // Count actual burns
    const actualBurns = await prisma.nFTTransfer.count({
      where: {
        nft: {
          contractAddress,
          chainId,
        },
        transferType: 'BURN',
      },
    });

    // Count NFTs
    const totalNFTs = await prisma.nFT.count({
      where: {
        contractAddress,
        chainId,
      },
    });

    // Count current owners
    const currentOwners = await prisma.nFTOwnership.count({
      where: {
        nft: {
          contractAddress,
          chainId,
        },
        isCurrent: true,
      },
    });

    // Get volume from mints table
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

    console.log('📊 Current Stats (from launchpads table):');
    console.log(`   Minted Count: ${launchpad.mintedCount}`);
    console.log(`   Volume: ${launchpad.volume}`);
    console.log('');

    console.log('📊 Actual Stats (from database):');
    console.log(`   Mint Transfers: ${actualMints}`);
    console.log(`   Regular Transfers: ${actualTransfers}`);
    console.log(`   Burns: ${actualBurns}`);
    console.log(`   Total NFTs: ${totalNFTs}`);
    console.log(`   Current Owners: ${currentOwners}`);
    console.log(`   Actual Volume: ${actualVolume}`);
    console.log('');

    console.log('🔍 Verification:');
    const mintedCountMatch = launchpad.mintedCount === actualMints;
    const volumeMatch = launchpad.volume === actualVolume;

    console.log(`   Minted Count: ${mintedCountMatch ? '✅' : '❌'} ${launchpad.mintedCount} vs ${actualMints} (diff: ${launchpad.mintedCount - actualMints})`);
    console.log(`   Volume: ${volumeMatch ? '✅' : '❌'} ${launchpad.volume} vs ${actualVolume}`);
    console.log('');

    if (!mintedCountMatch || !volumeMatch) {
      console.log('⚠️  Stats mismatch detected!');
      console.log('');
      console.log('🔧 Fix Options:');
      console.log('   1. Run with --fix flag to update launchpad stats');
      console.log('   2. Manually update in database');
      console.log('');

      if (process.argv.includes('--fix')) {
        console.log('🔧 Fixing stats...');
        
        await prisma.launchpad.update({
          where: { id: launchpad.id },
          data: {
            mintedCount: actualMints,
            volume: actualVolume,
          },
        });

        console.log('✅ Stats updated!');
        console.log(`   Minted Count: ${launchpad.mintedCount} → ${actualMints}`);
        console.log(`   Volume: ${launchpad.volume} → ${actualVolume}`);
      }
    } else {
      console.log('✅ All stats match!');
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ Verification completed');
    console.log('='.repeat(80));

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
