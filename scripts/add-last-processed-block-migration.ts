/**
 * Add lastProcessedBlock field to LaunchpadFactory table
 * 
 * This migration adds fields to track the last processed block for factory event polling,
 * allowing the service to resume from where it left off after restart.
 * 
 * Usage:
 *   npx tsx scripts/add-last-processed-block-migration.ts
 */

import { prisma } from '../src/config/database';
import * as fs from 'fs';
import * as path from 'path';

async function runMigration() {
  console.log('🔄 Running lastProcessedBlock migration...\n');

  try {
    // Read SQL migration file
    const sqlPath = path.join(__dirname, '../prisma/migrations/manual_add_last_processed_block.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    console.log('📝 Executing SQL migration:');
    console.log('─'.repeat(60));
    console.log(sql);
    console.log('─'.repeat(60));
    console.log();

    // Execute SQL
    await prisma.$executeRawUnsafe(sql);

    console.log('✅ Migration executed successfully!\n');

    // Verify the migration
    console.log('🔍 Verifying migration...');
    
    const factories = await prisma.launchpadFactory.findMany({
      select: {
        id: true,
        contractAddress: true,
        chainId: true,
        lastProcessedBlock: true,
        lastProcessedBlockAt: true
      }
    });

    console.log(`\n📊 Found ${factories.length} factories:`);
    for (const factory of factories) {
      console.log(`\n   Factory: ${factory.contractAddress}`);
      console.log(`   ├─ Chain ID: ${factory.chainId}`);
      console.log(`   ├─ Last Processed Block: ${factory.lastProcessedBlock || 'null (will start from current block)'}`);
      console.log(`   └─ Last Processed At: ${factory.lastProcessedBlockAt?.toISOString() || 'null'}`);
    }

    console.log('\n✅ Migration verified successfully!');
    console.log('\n💡 Next steps:');
    console.log('   1. Restart the service: npm run restart');
    console.log('   2. Factory polling will now resume from last processed block');
    console.log('   3. Check logs for: "🏭 [Factory] Starting polling from block X"');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nStack trace:', error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
