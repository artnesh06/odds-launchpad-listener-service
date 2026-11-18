import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanDuplicateMints() {
  try {
    console.log('🔍 Finding duplicate mint records...');
    
    // Find duplicates using raw SQL
    const duplicates: any = await prisma.$queryRaw`
      SELECT "launchpadId", "tokenId", COUNT(*) as count, array_agg(id) as ids
      FROM mints
      WHERE "tokenId" IS NOT NULL
      GROUP BY "launchpadId", "tokenId"
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `;
    
    if (duplicates.length === 0) {
      console.log('✅ No duplicate mint records found');
      return;
    }
    
    console.log(`⚠️ Found ${duplicates.length} sets of duplicate mints`);
    
    let totalDeleted = 0;
    
    for (const dup of duplicates) {
      const ids = dup.ids as string[];
      const keepId = ids[0]; // Keep the first one (oldest)
      const deleteIds = ids.slice(1); // Delete the rest
      
      console.log(`🔄 Duplicate: launchpadId=${dup.launchpadId}, tokenId=${dup.tokenId}, count=${dup.count}`);
      console.log(`   Keeping: ${keepId}`);
      console.log(`   Deleting: ${deleteIds.join(', ')}`);
      
      // Delete duplicates
      const result = await prisma.mint.deleteMany({
        where: {
          id: {
            in: deleteIds
          }
        }
      });
      
      totalDeleted += result.count;
      console.log(`   ✅ Deleted ${result.count} duplicate records`);
    }
    
    console.log(`\n✅ Cleanup complete: ${totalDeleted} duplicate mint records deleted`);
    console.log(`   ${duplicates.length} unique mints now have single records`);
    
  } catch (error) {
    console.error('❌ Error cleaning duplicates:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanDuplicateMints();
