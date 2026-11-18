/**
 * Migration Script: Add isShuffleEnabled field
 * 
 * This script adds the isShuffleEnabled field to the launchpads table
 * to support the new token ID shuffling feature in the smart contract.
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function runMigration() {
  console.log('🚀 Starting isShuffleEnabled field migration...\n');

  try {
    // Read the SQL migration file
    const migrationPath = path.join(__dirname, '../prisma/migrations/manual_add_is_shuffle_enabled.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📄 Migration SQL:');
    console.log(migrationSQL);
    console.log('');

    // Execute the migration
    console.log('⚙️  Executing migration...');
    await prisma.$executeRawUnsafe(migrationSQL);
    console.log('✅ Migration executed successfully!\n');

    // Verify the migration
    console.log('🔍 Verifying migration...');
    const result = await prisma.$queryRaw<Array<{ column_name: string; data_type: string; column_default: string }>>`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'launchpads'
      AND column_name = 'isShuffleEnabled';
    `;

    if (result.length > 0) {
      console.log('✅ Field verified:');
      console.log(`   Column: ${result[0].column_name}`);
      console.log(`   Type: ${result[0].data_type}`);
      console.log(`   Default: ${result[0].column_default}`);
      console.log('');
    } else {
      console.error('❌ Field not found after migration!');
      process.exit(1);
    }

    // Check existing launchpads
    const launchpadCount = await prisma.launchpad.count();
    console.log(`📊 Total launchpads in database: ${launchpadCount}`);
    
    if (launchpadCount > 0) {
      const sampleLaunchpad = await prisma.launchpad.findFirst({
        select: {
          id: true,
          name: true,
          isShuffleEnabled: true
        }
      });
      
      console.log('📋 Sample launchpad:');
      console.log(`   ID: ${sampleLaunchpad?.id}`);
      console.log(`   Name: ${sampleLaunchpad?.name}`);
      console.log(`   isShuffleEnabled: ${sampleLaunchpad?.isShuffleEnabled}`);
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('');
    console.log('📝 Summary:');
    console.log('   - Added isShuffleEnabled field to launchpads table');
    console.log('   - Default value: false');
    console.log('   - All existing launchpads have isShuffleEnabled = false');
    console.log('');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
runMigration()
  .then(() => {
    console.log('🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
