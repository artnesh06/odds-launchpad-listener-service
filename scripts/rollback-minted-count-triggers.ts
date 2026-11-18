/**
 * Rollback Minted Count Triggers
 * 
 * This script removes the database triggers for mintedCount auto-sync.
 * Use this if you need to rollback to manual mintedCount management.
 * 
 * Usage:
 *   npx tsx scripts/rollback-minted-count-triggers.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function rollbackTriggers() {
  console.log('🔄 Starting rollback of minted count triggers...\n');

  try {
    // Drop triggers
    console.log('🗑️  Dropping triggers...');
    
    await prisma.$executeRaw`
      DROP TRIGGER IF EXISTS mint_insert_trigger ON "mints";
    `;
    console.log('   ✅ Dropped mint_insert_trigger');

    await prisma.$executeRaw`
      DROP TRIGGER IF EXISTS mint_delete_trigger ON "mints";
    `;
    console.log('   ✅ Dropped mint_delete_trigger');

    await prisma.$executeRaw`
      DROP TRIGGER IF EXISTS prevent_manual_minted_count_update_trigger ON "launchpads";
    `;
    console.log('   ✅ Dropped prevent_manual_minted_count_update_trigger');

    // Drop functions
    console.log('\n🗑️  Dropping functions...');
    
    await prisma.$executeRaw`
      DROP FUNCTION IF EXISTS update_minted_count_on_mint_insert();
    `;
    console.log('   ✅ Dropped update_minted_count_on_mint_insert()');

    await prisma.$executeRaw`
      DROP FUNCTION IF EXISTS update_minted_count_on_mint_delete();
    `;
    console.log('   ✅ Dropped update_minted_count_on_mint_delete()');

    await prisma.$executeRaw`
      DROP FUNCTION IF EXISTS prevent_manual_minted_count_update();
    `;
    console.log('   ✅ Dropped prevent_manual_minted_count_update()');

    // Verify cleanup
    console.log('\n🔍 Verifying cleanup...');
    const remainingTriggers = await prisma.$queryRaw<Array<{ trigger_name: string }>>`
      SELECT trigger_name 
      FROM information_schema.triggers 
      WHERE trigger_schema = 'public' 
      AND (
        trigger_name = 'mint_insert_trigger' OR 
        trigger_name = 'mint_delete_trigger' OR
        trigger_name = 'prevent_manual_minted_count_update_trigger'
      );
    `;

    if (remainingTriggers.length === 0) {
      console.log('✅ All triggers removed successfully');
    } else {
      console.warn('⚠️  Some triggers still exist:');
      remainingTriggers.forEach(t => console.log(`   - ${t.trigger_name}`));
    }

    const remainingFunctions = await prisma.$queryRaw<Array<{ routine_name: string }>>`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_type = 'FUNCTION'
      AND (
        routine_name = 'update_minted_count_on_mint_insert' OR 
        routine_name = 'update_minted_count_on_mint_delete' OR
        routine_name = 'prevent_manual_minted_count_update'
      );
    `;

    if (remainingFunctions.length === 0) {
      console.log('✅ All functions removed successfully');
    } else {
      console.warn('⚠️  Some functions still exist:');
      remainingFunctions.forEach(f => console.log(`   - ${f.routine_name}`));
    }

    console.log('\n✅ Rollback completed successfully!');
    console.log('\n⚠️  IMPORTANT: After rollback:');
    console.log('   1. You need to revert code changes to manually increment mintedCount');
    console.log('   2. Restore the increment logic in activity-listener.ts');
    console.log('   3. Test thoroughly before deploying\n');

  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the rollback
rollbackTriggers()
  .then(() => {
    console.log('✅ Rollback script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Rollback script failed:', error);
    process.exit(1);
  });
