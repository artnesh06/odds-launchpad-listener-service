import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function normalizeAddresses() {
  try {
    console.log('🔄 Starting address normalization...\n');

    // Normalize Launchpad addresses
    const launchpads = await prisma.launchpad.findMany({
      select: { id: true, contractAddress: true, name: true, createdAt: true },
      orderBy: { createdAt: 'asc' } // Keep oldest first
    });

    console.log(`📋 Found ${launchpads.length} launchpads to check`);

    // Group by lowercase address to find duplicates
    const grouped: Record<string, typeof launchpads> = {};
    for (const lp of launchpads) {
      const lower = lp.contractAddress.toLowerCase();
      if (!grouped[lower]) {
        grouped[lower] = [];
      }
      grouped[lower].push(lp);
    }

    // Handle duplicates first
    const duplicates = Object.entries(grouped).filter(([_, items]) => items.length > 1);
    if (duplicates.length > 0) {
      console.log(`\n⚠️ Found ${duplicates.length} duplicate addresses, removing duplicates...\n`);
      
      for (const [address, items] of duplicates) {
        // Keep the oldest one (first in array due to orderBy)
        const keep = items[0];
        const remove = items.slice(1);
        
        console.log(`Address: ${address}`);
        console.log(`  ✅ Keeping: ID ${keep.id} (${keep.name}) - created ${keep.createdAt}`);
        
        for (const dup of remove) {
          console.log(`  ❌ Removing: ID ${dup.id} (${dup.name}) - created ${dup.createdAt}`);
          
          // Delete related records first
          await prisma.activity.deleteMany({
            where: { launchpadId: dup.id }
          });
          
          await prisma.launchpadMetadata.deleteMany({
            where: { launchpadId: dup.id }
          });
          
          // Delete the duplicate launchpad
          await prisma.launchpad.delete({
            where: { id: dup.id }
          });
        }
        console.log('');
      }
    }

    // Now normalize remaining addresses
    const remainingLaunchpads = await prisma.launchpad.findMany({
      select: { id: true, contractAddress: true }
    });

    let updatedCount = 0;
    for (const lp of remainingLaunchpads) {
      const normalized = lp.contractAddress.toLowerCase();
      if (lp.contractAddress !== normalized) {
        await prisma.launchpad.update({
          where: { id: lp.id },
          data: { contractAddress: normalized }
        });
        console.log(`  ✅ Updated: ${lp.contractAddress} → ${normalized}`);
        updatedCount++;
      }
    }

    console.log(`\n✅ Launchpad addresses normalized: ${updatedCount}/${remainingLaunchpads.length}`);

    // Normalize LaunchpadFactory addresses
    const factories = await prisma.launchpadFactory.findMany({
      select: { id: true, contractAddress: true }
    });

    console.log(`\n📋 Found ${factories.length} factories to check`);

    let factoryUpdatedCount = 0;
    for (const factory of factories) {
      const normalized = factory.contractAddress.toLowerCase();
      if (factory.contractAddress !== normalized) {
        await prisma.launchpadFactory.update({
          where: { id: factory.id },
          data: { contractAddress: normalized }
        });
        console.log(`  ✅ Updated: ${factory.contractAddress} → ${normalized}`);
        factoryUpdatedCount++;
      }
    }

    console.log(`\n✅ Factory addresses normalized: ${factoryUpdatedCount}/${factories.length}`);

    console.log('\n🎉 Address normalization complete!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

normalizeAddresses();
