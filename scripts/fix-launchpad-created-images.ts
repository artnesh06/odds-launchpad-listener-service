/**
 * Script to fix LAUNCHPAD_CREATED activities collectionImage
 * 
 * This script updates all LAUNCHPAD_CREATED activities to ensure
 * collectionImage in metadata matches the image from launchpad_metadata table
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Starting LAUNCHPAD_CREATED collectionImage fix...\n');

  try {
    // Find all LAUNCHPAD_CREATED activities
    const activities = await prisma.activity.findMany({
      where: {
        type: 'LAUNCHPAD_CREATED',
        launchpadId: { not: null }
      },
      include: {
        launchpad: {
          include: {
            metadata: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    console.log(`📊 Found ${activities.length} LAUNCHPAD_CREATED activities\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let noMetadataCount = 0;

    for (const activity of activities) {
      const metadata = activity.metadata as any;
      const currentImage = metadata?.collectionImage;
      const correctImage = activity.launchpad?.metadata?.image;

      // Skip if no launchpad metadata
      if (!activity.launchpad?.metadata) {
        console.log(`⚠️  Activity ${activity.id}: No metadata found for launchpad ${activity.launchpadId}`);
        noMetadataCount++;
        continue;
      }

      // Skip if already correct
      if (currentImage === correctImage) {
        console.log(`✓ Activity ${activity.id}: Already has correct image`);
        skippedCount++;
        continue;
      }

      // Update the activity
      const updatedMetadata = {
        ...metadata,
        collectionImage: correctImage
      };

      await prisma.activity.update({
        where: { id: activity.id },
        data: {
          metadata: updatedMetadata
        }
      });

      console.log(`✅ Activity ${activity.id}: Updated collectionImage`);
      console.log(`   From: ${currentImage || 'null'}`);
      console.log(`   To: ${correctImage || 'null'}\n`);
      updatedCount++;
    }

    console.log('\n📈 Summary:');
    console.log(`   Total activities: ${activities.length}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Already correct: ${skippedCount}`);
    console.log(`   No metadata: ${noMetadataCount}`);
    console.log('\n✅ Fix completed successfully!');

  } catch (error) {
    console.error('❌ Error during fix:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
