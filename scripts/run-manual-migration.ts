import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function runManualMigration() {
  try {
    console.log('🔄 Running manual migration to add error_logs table...');

    // Read the SQL file
    const sqlPath = path.join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      'manual_add_error_log_table.sql'
    );
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.toLowerCase().includes('select')) {
        const result = await prisma.$queryRawUnsafe(statement);
        console.log('✅', result);
      } else {
        await prisma.$executeRawUnsafe(statement);
        console.log('✅ Executed:', statement.substring(0, 50) + '...');
      }
    }

    console.log('✅ Migration completed successfully!');
    console.log('📊 Verifying table exists...');

    // Verify the table exists
    const tableCheck = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'error_logs'
      );
    `;

    console.log('✅ Table verification:', tableCheck);
    console.log('🎉 All done! The error_logs table has been added safely.');
  } catch (error) {
    console.error('❌ Error running migration:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

runManualMigration();
