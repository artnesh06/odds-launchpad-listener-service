import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runMigration() {
  try {
    console.log('🔄 Running migration: Add unique constraint to mints table...');
    
    // Execute the ALTER TABLE command
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "mints_launchpadId_tokenId_key" 
      ON public.mints ("launchpadId", "tokenId")
    `);
    
    console.log('✅ Migration completed successfully!');
    console.log('   Unique constraint mints_launchpadId_tokenId_key has been added');
    
    // Verify the constraint was added
    const result: any = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM pg_indexes 
      WHERE indexname = 'mints_launchpadId_tokenId_key'
    `);
    
    if (result && result.length > 0) {
      console.log('✅ Verification successful: Constraint exists in database');
    } else {
      console.warn('⚠️ Warning: Could not verify constraint was added');
    }
    
  } catch (error: any) {
    // Check if error is because constraint already exists
    if (error.message?.includes('already exists')) {
      console.log('ℹ️ Unique constraint already exists on mints table');
    } else {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
