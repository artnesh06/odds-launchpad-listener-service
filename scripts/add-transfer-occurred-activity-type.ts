import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function runMigration() {
  try {
    console.log('🔄 Running migration: Add TRANSFER_OCCURRED to ActivityType enum...');
    
    // Execute the ALTER TYPE command
    await prisma.$executeRawUnsafe(`ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'TRANSFER_OCCURRED'`);
    
    console.log('✅ Migration completed successfully!');
    console.log('   TRANSFER_OCCURRED has been added to ActivityType enum');
    
    // Verify the enum value was added
    const result: any = await prisma.$queryRawUnsafe(`
      SELECT 1 FROM pg_enum 
      WHERE enumlabel = 'TRANSFER_OCCURRED' 
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ActivityType')
    `);
    
    if (result && result.length > 0) {
      console.log('✅ Verification successful: TRANSFER_OCCURRED exists in ActivityType enum');
    } else {
      console.warn('⚠️ Warning: Could not verify TRANSFER_OCCURRED was added');
    }
    
  } catch (error: any) {
    // Check if error is because value already exists
    if (error.message?.includes('already exists')) {
      console.log('ℹ️ TRANSFER_OCCURRED already exists in ActivityType enum');
    } else {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
