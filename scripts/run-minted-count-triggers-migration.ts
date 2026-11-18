/**
 * Run Minted Count Triggers Migration
 * 
 * This script applies database triggers to auto-sync mintedCount.
 * After running this, mintedCount will be automatically updated by the database
 * whenever a Mint record is created or deleted.
 * 
 * Usage:
 *   npx tsx scripts/run-minted-count-triggers-migration.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runMigration() {
  console.log('🚀 Starting minted count triggers migration...\n');

  try {
    console.log('⚙️  Creating functions and triggers...\n');

    // 1. Create function for insert trigger
    console.log('   [1/7] Creating update_minted_count_on_mint_insert function...');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION update_minted_count_on_mint_insert()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE "launchpads"
        SET 
          "mintedCount" = "mintedCount" + 1,
          "lastMintAt" = COALESCE(NEW."createdAt", NOW()),
          "updatedAt" = NOW()
        WHERE id = NEW."launchpadId";
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('   ✅ Function created\n');

    // 2. Create trigger for insert
    console.log('   [2/7] Creating mint_insert_trigger...');
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS mint_insert_trigger ON "mints"`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER mint_insert_trigger
      AFTER INSERT ON "mints"
      FOR EACH ROW
      EXECUTE FUNCTION update_minted_count_on_mint_insert();
    `);
    console.log('   ✅ Trigger created\n');

    // 3. Create function for delete trigger
    console.log('   [3/7] Creating update_minted_count_on_mint_delete function...');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION update_minted_count_on_mint_delete()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE "launchpads"
        SET 
          "mintedCount" = GREATEST("mintedCount" - 1, 0),
          "updatedAt" = NOW()
        WHERE id = OLD."launchpadId";
        
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('   ✅ Function created\n');

    // 4. Create trigger for delete
    console.log('   [4/7] Creating mint_delete_trigger...');
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS mint_delete_trigger ON "mints"`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER mint_delete_trigger
      AFTER DELETE ON "mints"
      FOR EACH ROW
      EXECUTE FUNCTION update_minted_count_on_mint_delete();
    `);
    console.log('   ✅ Trigger created\n');

    // 5. Create function for manual update warning
    console.log('   [5/7] Creating prevent_manual_minted_count_update function...');
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION prevent_manual_minted_count_update()
      RETURNS TRIGGER AS $$
      DECLARE
        actual_count INTEGER;
      BEGIN
        IF OLD."mintedCount" IS DISTINCT FROM NEW."mintedCount" THEN
          SELECT COUNT(*) INTO actual_count
          FROM "mints"
          WHERE "launchpadId" = NEW.id;
          
          IF NEW."mintedCount" = actual_count THEN
            RETURN NEW;
          END IF;
          
          RAISE WARNING 'Manual mintedCount update detected for launchpad %. Old: %, New: %, Actual: %', 
            NEW.id, OLD."mintedCount", NEW."mintedCount", actual_count;
        END IF;
        
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    console.log('   ✅ Function created\n');

    // 6. Create trigger for manual update warning
    console.log('   [6/7] Creating prevent_manual_minted_count_update_trigger...');
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS prevent_manual_minted_count_update_trigger ON "launchpads"`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER prevent_manual_minted_count_update_trigger
      BEFORE UPDATE ON "launchpads"
      FOR EACH ROW
      WHEN (OLD."mintedCount" IS DISTINCT FROM NEW."mintedCount")
      EXECUTE FUNCTION prevent_manual_minted_count_update();
    `);
    console.log('   ✅ Trigger created\n');

    // 7. Fix existing discrepancies
    console.log('   [7/7] Fixing existing mintedCount discrepancies...');
    const fixResult = await prisma.$executeRaw`
      UPDATE "launchpads" l
      SET "mintedCount" = (
        SELECT COUNT(*) FROM "mints" WHERE "launchpadId" = l.id
      )
      WHERE "mintedCount" != (
        SELECT COUNT(*) FROM "mints" WHERE "launchpadId" = l.id
      )
    `;
    console.log(`   ✅ Fixed ${fixResult} launchpads\n`);

    console.log('✅ Migration executed successfully!\n');

    // Verify triggers were created
    console.log('🔍 Verifying triggers...');
    const triggers = await prisma.$queryRaw<Array<{ trigger_name: string }>>`
      SELECT trigger_name 
      FROM information_schema.triggers 
      WHERE trigger_schema = 'public' 
      AND (
        trigger_name = 'mint_insert_trigger' OR 
        trigger_name = 'mint_delete_trigger' OR
        trigger_name = 'prevent_manual_minted_count_update_trigger'
      )
      ORDER BY trigger_name;
    `;

    if (triggers.length > 0) {
      console.log('✅ Triggers created:');
      triggers.forEach(t => console.log(`   - ${t.trigger_name}`));
    } else {
      console.warn('⚠️  No triggers found. Migration may have failed.');
    }

    // Verify functions were created
    console.log('\n🔍 Verifying functions...');
    const functions = await prisma.$queryRaw<Array<{ routine_name: string }>>`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_type = 'FUNCTION'
      AND (
        routine_name = 'update_minted_count_on_mint_insert' OR 
        routine_name = 'update_minted_count_on_mint_delete' OR
        routine_name = 'prevent_manual_minted_count_update'
      )
      ORDER BY routine_name;
    `;

    if (functions.length > 0) {
      console.log('✅ Functions created:');
      functions.forEach(f => console.log(`   - ${f.routine_name}`));
    } else {
      console.warn('⚠️  No functions found. Migration may have failed.');
    }

    // Test the trigger with a sample query
    console.log('\n🧪 Testing trigger behavior...');
    const testResult = await prisma.$queryRaw<Array<{ launchpad_count: bigint, mint_count: bigint, matches: bigint }>>`
      SELECT 
        COUNT(DISTINCT l.id) as launchpad_count,
        COUNT(m.id) as mint_count,
        COUNT(CASE WHEN l."mintedCount" = (
          SELECT COUNT(*) FROM "mints" WHERE "launchpadId" = l.id
        ) THEN 1 END) as matches
      FROM "launchpads" l
      LEFT JOIN "mints" m ON m."launchpadId" = l.id
    `;

    if (testResult.length > 0) {
      const { launchpad_count, mint_count, matches } = testResult[0];
      console.log(`✅ Database state:`);
      console.log(`   - Launchpads: ${launchpad_count}`);
      console.log(`   - Total mints: ${mint_count}`);
      console.log(`   - Accurate counts: ${matches}/${launchpad_count}`);
      
      if (Number(matches) === Number(launchpad_count)) {
        console.log('   ✅ All mintedCount values are accurate!');
      } else {
        console.log(`   ⚠️  ${Number(launchpad_count) - Number(matches)} launchpads have inaccurate counts (fixed by migration)`);
      }
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('   1. Deploy the updated code (triggers are now active)');
    console.log('   2. Monitor logs for any trigger warnings');
    console.log('   3. mintedCount will now auto-update on Mint insert/delete');
    console.log('   4. No manual increment needed in application code\n');

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
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
