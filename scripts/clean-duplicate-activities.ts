/**
 * Script to clean duplicate ContractDeployed activities
 * 
 * This script removes duplicate LAUNCHPAD_CREATED activities that have the same txHash
 * or the same contract address, keeping only the most complete entry (with metadata)
 */

import { PrismaClient, ActivityType } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanDuplicateActivities() {
  try {
    console.log('🧹 Starting duplicate activity cleanup...\n');

    // Find all LAUNCHPAD_CREATED activities
    const activities = await prisma.activity.findMany({
      where: {
        type: ActivityType.LAUNCHPAD_CREATED
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    console.log(`📊 Found ${activities.length} LAUNCHPAD_CREATED activities\n`);

    // Group by txHash
    const byTxHash = new Map<string, typeof activities>();
    const byContractAddress = new Map<string, typeof activities>();

    for (const activity of activities) {
      // Group by txHash
      if (activity.txHash) {
        if (!byTxHash.has(activity.txHash)) {
          byTxHash.set(activity.txHash, []);
        }
        byTxHash.get(activity.txHash)!.push(activity);
      }

      // Group by contract address (from metadata or launchpadId)
      const metadata = activity.metadata as any;
      const contractAddress = metadata?.contractAddress;
      
      if (contractAddress) {
        const normalized = contractAddress.toLowerCase();
        if (!byContractAddress.has(normalized)) {
          byContractAddress.set(normalized, []);
        }
        byContractAddress.get(normalized)!.push(activity);
      }
    }

    let duplicatesFound = 0;
    let duplicatesRemoved = 0;
    const idsToDelete: string[] = [];

    // Check for duplicates by txHash
    console.log('🔍 Checking for duplicates by txHash...\n');
    for (const [txHash, group] of byTxHash.entries()) {
      if (group.length > 1) {
        duplicatesFound += group.length - 1;
        console.log(`⚠️  Found ${group.length} activities with txHash: ${txHash}`);
        
        // Sort by: has metadata image > has launchpadId > has contractAddress in metadata > oldest
        const sorted = group.sort((a, b) => {
          const aMetadata = a.metadata as any;
          const bMetadata = b.metadata as any;
          
          // Prefer entries with image
          const aHasImage = aMetadata?.collectionImage && 
                           aMetadata.collectionImage !== '/images/default-collection.png' &&
                           !aMetadata.collectionImage.includes('default');
          const bHasImage = bMetadata?.collectionImage && 
                           bMetadata.collectionImage !== '/images/default-collection.png' &&
                           !bMetadata.collectionImage.includes('default');
          
          if (aHasImage && !bHasImage) return -1;
          if (!aHasImage && bHasImage) return 1;
          
          // Prefer entries with launchpadId
          if (a.launchpadId && !b.launchpadId) return -1;
          if (!a.launchpadId && b.launchpadId) return 1;
          
          // Prefer entries with contractAddress in metadata
          const aHasContract = aMetadata?.contractAddress && aMetadata.contractAddress.startsWith('0x');
          const bHasContract = bMetadata?.contractAddress && bMetadata.contractAddress.startsWith('0x');
          
          if (aHasContract && !bHasContract) return -1;
          if (!aHasContract && bHasContract) return 1;
          
          // Prefer older entries
          return a.createdAt.getTime() - b.createdAt.getTime();
        });

        // Keep the first (best) one, mark others for deletion
        const toKeep = sorted[0];
        const toDelete = sorted.slice(1);
        
        const toKeepMeta = toKeep.metadata as any;
        console.log(`   ✅ Keeping: ${toKeep.id}`);
        console.log(`      - launchpadId: ${toKeep.launchpadId || 'none'}`);
        console.log(`      - contractAddress: ${toKeepMeta?.contractAddress || 'none'}`);
        console.log(`      - image: ${toKeepMeta?.collectionImage || 'none'}`);
        
        for (const activity of toDelete) {
          const meta = activity.metadata as any;
          console.log(`   ❌ Deleting: ${activity.id}`);
          console.log(`      - launchpadId: ${activity.launchpadId || 'none'}`);
          console.log(`      - contractAddress: ${meta?.contractAddress || 'none'}`);
          console.log(`      - image: ${meta?.collectionImage || 'none'}`);
          idsToDelete.push(activity.id);
        }
        console.log('');
      }
    }

    // Check for duplicates by contract address (different txHash but same contract)
    console.log('🔍 Checking for duplicates by contract address...\n');
    for (const [contractAddress, group] of byContractAddress.entries()) {
      if (group.length > 1) {
        // Check if they have different txHashes
        const uniqueTxHashes = new Set(group.map(a => a.txHash).filter(Boolean));
        if (uniqueTxHashes.size > 1) {
          console.log(`⚠️  Found ${group.length} activities for contract: ${contractAddress} with different txHashes`);
          console.log(`   TxHashes: ${Array.from(uniqueTxHashes).join(', ')}`);
          
          // This shouldn't happen - same contract deployed multiple times?
          // Keep the oldest one with valid txHash
          const sorted = group.sort((a, b) => {
            // Prefer entries with txHash
            if (a.txHash && !b.txHash) return -1;
            if (!a.txHash && b.txHash) return 1;
            
            return a.createdAt.getTime() - b.createdAt.getTime();
          });
          
          const toKeep = sorted[0];
          const toDelete = sorted.slice(1);
          
          console.log(`   ✅ Keeping: ${toKeep.id} (txHash: ${toKeep.txHash})`);
          
          for (const activity of toDelete) {
            if (!idsToDelete.includes(activity.id)) {
              console.log(`   ❌ Deleting: ${activity.id} (txHash: ${activity.txHash})`);
              idsToDelete.push(activity.id);
              duplicatesFound++;
            }
          }
          console.log('');
        }
      }
    }

    // Delete duplicates
    if (idsToDelete.length > 0) {
      console.log(`\n🗑️  Deleting ${idsToDelete.length} duplicate activities...\n`);
      
      const result = await prisma.activity.deleteMany({
        where: {
          id: {
            in: idsToDelete
          }
        }
      });

      duplicatesRemoved = result.count;
      console.log(`✅ Deleted ${duplicatesRemoved} duplicate activities\n`);
    } else {
      console.log('✅ No duplicates found to delete\n');
    }

    // Summary
    console.log('📊 Summary:');
    console.log(`   Total activities: ${activities.length}`);
    console.log(`   Duplicates found: ${duplicatesFound}`);
    console.log(`   Duplicates removed: ${duplicatesRemoved}`);
    console.log(`   Remaining activities: ${activities.length - duplicatesRemoved}`);

  } catch (error) {
    console.error('❌ Error cleaning duplicate activities:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
cleanDuplicateActivities()
  .then(() => {
    console.log('\n✅ Cleanup completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Cleanup failed:', error);
    process.exit(1);
  });
