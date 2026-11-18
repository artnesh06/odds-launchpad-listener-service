/**
 * Script to sync mintedCount in launchpads table with actual count from mints table
 * Run this to fix any discrepancies caused by previous bugs
 * 
 * Usage: npx ts-node src/scripts/sync-minted-count.ts
 */

import { prisma } from '../config/database';

async function syncMintedCount() {
  console.log('🔄 Starting mintedCount sync...\n');

  try {
    // Get all launchpads with their mint counts
    const launchpads = await prisma.launchpad.findMany({
      select: {
        id: true,
        contractAddress: true,
        name: true,
        mintedCount: true,
        _count: {
          select: {
            mints: true
          }
        }
      }
    });

    let fixedCount = 0;
    let alreadyCorrect = 0;

    for (const launchpad of launchpads) {
      const actualMintCount = launchpad._count.mints;
      const storedMintCount = launchpad.mintedCount;

      if (actualMintCount !== storedMintCount) {
        console.log(`❌ Mismatch found for ${launchpad.name || launchpad.contractAddress}:`);
        console.log(`   - Stored mintedCount: ${storedMintCount}`);
        console.log(`   - Actual mints count: ${actualMintCount}`);
        
        // Update to correct value
        await prisma.launchpad.update({
          where: { id: launchpad.id },
          data: { mintedCount: actualMintCount }
        });
        
        console.log(`   ✅ Fixed: mintedCount updated to ${actualMintCount}\n`);
        fixedCount++;
      } else {
        alreadyCorrect++;
      }
    }

    console.log('\n📊 Sync Summary:');
    console.log(`   - Total launchpads: ${launchpads.length}`);
    console.log(`   - Already correct: ${alreadyCorrect}`);
    console.log(`   - Fixed: ${fixedCount}`);
    console.log('\n✅ Sync complete!');

  } catch (error) {
    console.error('❌ Error during sync:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the sync
syncMintedCount();
