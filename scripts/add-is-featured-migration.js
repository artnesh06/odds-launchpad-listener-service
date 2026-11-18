/**
 * Manual migration script to add isFeatured field to launchpads table
 * This script adds the isFeatured boolean field with a default value of false
 * and creates an index on the field for efficient querying
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting migration: add isFeatured field to launchpads table...');

  try {
    // Add isFeatured column to launchpads table
    console.log('Adding isFeatured column...');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "launchpads" 
      ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;
    `);
    console.log('✓ isFeatured column added successfully');

    // Create index on isFeatured for efficient querying
    console.log('Creating index on isFeatured...');
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "launchpads_isFeatured_idx" 
      ON "launchpads"("isFeatured");
    `);
    console.log('✓ Index created successfully');

    // Add comment to document the purpose of this field
    console.log('Adding column comment...');
    await prisma.$executeRawUnsafe(`
      COMMENT ON COLUMN "launchpads"."isFeatured" 
      IS 'Featured launchpads receive real-time WebSocket monitoring for mint events';
    `);
    console.log('✓ Column comment added successfully');

    console.log('\n✅ Migration completed successfully!');
    console.log('The isFeatured field has been added to the launchpads table.');
    console.log('Default value: false');
    console.log('Index: launchpads_isFeatured_idx');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
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
