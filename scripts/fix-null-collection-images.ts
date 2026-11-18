/**
 * Script to fix existing LAUNCHPAD_CREATED activities with null collectionImage
 * 
 * This script:
 * 1. Finds all LAUNCHPAD_CREATED activities with null collectionImage
 * 2. Fetches the collection image from LaunchpadMetadata
 * 3. Updates the activity metadata with the correct image
 * 
 * Usage:
 *   npx tsx scripts/fix-null-collection-images.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ActivityMetadata {
  collectionName?: string;
  collectionSymbol?: string;
  collectionImage?: string | null;
  [key: string]: any;
}

async function fixNullCollectionImages() {
  console.log('🔧 Starting fix for null collection images in activities...\n');

  try {
    // Find all LAUNCHPAD_CREATED activities
    const activities = await prisma.activity.findMany({
      where: {
        type: 'LAUNCHPAD_CREATED'
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`📊 Found ${activities.length} LAUNCHPAD_CREATED activities\n`);

    let fixedCount = 0;
    let skippedCount = 0;
    let noImageCount = 0;

    for (const activity of activities) {
      const metadata = activity.metadata as ActivityMetadata;
      const collectionImage = metadata?.collectionImage;

      // Check if collectionImage is null or missing
      if (!collectionImage) {
        // Get launchpad from launchpadId
        if (!activity.launchpadId) {
          console.log(`⚠️ Activity ${activity.id} has no launchpadId, skipping\n`);
          noImageCount++;
          continue;
        }

        const launchpad = await prisma.launchpad.findUnique({
          where: { id: activity.launchpadId },
          include: {
            metadata: true
          }
        });

        if (!launchpad) {
          console.log(`⚠️ Launchpad not found for activity ${activity.id}, skipping\n`);
          noImageCount++;
          continue;
        }

        const launchpadImage = launchpad.metadata?.image;

        if (launchpadImage) {
          // Update activity with collection image
          await prisma.activity.update({
            where: { id: activity.id },
            data: {
              metadata: {
                ...metadata,
                collectionImage: launchpadImage
              }
            }
          });

          console.log(`✅ Fixed activity ${activity.id}:`);
          console.log(`   Collection: ${metadata?.collectionName || 'Unknown'}`);
          console.log(`   Image: ${launchpadImage}`);
          console.log(`   TxHash: ${activity.txHash || 'N/A'}\n`);

          fixedCount++;
        } else {
          console.log(`⚠️ No image available for activity ${activity.id}:`);
          console.log(`   Collection: ${metadata?.collectionName || 'Unknown'}`);
          console.log(`   LaunchpadId: ${activity.launchpadId || 'N/A'}\n`);

          noImageCount++;
        }
      } else {
        skippedCount++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary:');
    console.log(`   Total activities: ${activities.length}`);
    console.log(`   ✅ Fixed: ${fixedCount}`);
    console.log(`   ⏭️ Skipped (already has image): ${skippedCount}`);
    console.log(`   ⚠️ No image available: ${noImageCount}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Error fixing null collection images:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
fixNullCollectionImages()
  .then(() => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
