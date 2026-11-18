import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function runManualMigration() {
  try {
    console.log('🔄 Running manual migration to add processed_events table...');

    // Read the SQL file
    const sqlPath = path.join(
      __dirname,
      '..',
      'prisma',
      'migrations',
      'manual_add_processed_event_table.sql'
    );
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    // Split by semicolon and execute each statement
    // First, remove comment lines
    const cleanedSql = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    
    const statements = cleanedSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    console.log(`📝 Found ${statements.length} statements to execute`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      try {
        console.log(`\n🔄 Executing statement ${i + 1}/${statements.length}:`);
        console.log(statement.substring(0, 100) + '...');
        
        if (statement.toLowerCase().includes('select')) {
          const result = await prisma.$queryRawUnsafe(statement);
          console.log('✅ Result:', result);
        } else {
          await prisma.$executeRawUnsafe(statement);
          console.log('✅ Executed successfully');
        }
      } catch (error) {
        console.error(`❌ Error executing statement ${i + 1}:`, error);
        throw error;
      }
    }

    console.log('✅ Migration completed successfully!');
    console.log('📊 Verifying table exists...');

    // Verify the table exists
    const tableCheck = await prisma.$queryRaw`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'processed_events'
      );
    `;

    console.log('✅ Table verification:', tableCheck);
    
    // Verify indexes exist
    const indexCheck = await prisma.$queryRaw`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'processed_events';
    `;
    
    console.log('✅ Indexes:', indexCheck);
    console.log('🎉 All done! The processed_events table has been added safely.');
  } catch (error) {
    console.error('❌ Error running migration:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

runManualMigration();
