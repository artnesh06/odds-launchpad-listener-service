/**
 * Normalize factory contract address to lowercase
 * Fixes case sensitivity issues with Prisma unique constraints
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function normalizeFactoryAddress() {
  try {
    console.log('🔍 Finding factory with mixed-case address...');
    
    // Find all factories
    const factories = await prisma.launchpadFactory.findMany({
      select: {
        id: true,
        contractAddress: true,
        chainId: true
      }
    });

    console.log(`📊 Found ${factories.length} factories`);

    for (const factory of factories) {
      const normalized = factory.contractAddress.toLowerCase();
      
      if (factory.contractAddress !== normalized) {
        console.log(`\n🔄 Normalizing factory address:`);
        console.log(`   Old: ${factory.contractAddress}`);
        console.log(`   New: ${normalized}`);
        console.log(`   Chain: ${factory.chainId}`);

        await prisma.launchpadFactory.update({
          where: { id: factory.id },
          data: { contractAddress: normalized }
        });

        console.log(`✅ Updated factory ${factory.id}`);
      } else {
        console.log(`✓ Factory ${factory.id} already normalized`);
      }
    }

    console.log('\n✅ All factory addresses normalized!');
  } catch (error) {
    console.error('❌ Error normalizing factory addresses:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

normalizeFactoryAddress();
