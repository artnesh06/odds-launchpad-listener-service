/**
 * Script to reset ALL data except config table (chains)
 * Keeps: chains only
 * Resets: Everything else (launchpads, nfts, mints, activities, marketplace, etc)
 * 
 * Usage: npx ts-node src/scripts/reset-transaction-data.ts
 * 
 * WARNING: This will delete ALL data except chains config! Make sure to backup first.
 */

import { prisma } from '../config/database';

async function resetAllData() {
  console.log('⚠️  WARNING: This will reset ALL data except chains config!');
  console.log('');
  console.log('Data that will be DELETED:');
  console.log('  - mints');
  console.log('  - nft_transfers');
  console.log('  - nft_ownership');
  console.log('  - nft_attributes');
  console.log('  - nfts');
  console.log('  - nft_contracts');
  console.log('  - nft_collection_analytics');
  console.log('  - activities');
  console.log('  - marketplace_sales');
  console.log('  - marketplace_listings');
  console.log('  - marketplace_offers');
  console.log('  - launchpad_analytics');
  console.log('  - launchpad_phases');
  console.log('  - launchpad_metadata');
  console.log('  - launchpads');
  console.log('  - launchpad_factories');
  console.log('  - error_logs');
  console.log('');
  console.log('Data that will be KEPT:');
  console.log('  - chains (config only)');
  console.log('');
  
  // Auto-confirm for non-interactive environments
  const args = process.argv.slice(2);
  if (!args.includes('--yes') && !args.includes('-y')) {
    console.log('Add --yes or -y flag to confirm and run the reset.');
    console.log('Example: npx ts-node src/scripts/reset-transaction-data.ts --yes');
    process.exit(0);
  }

  console.log('🔄 Starting full reset...\n');

  try {
    // Delete in order respecting foreign key constraints
    
    console.log('1️⃣  Clearing error logs...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE error_logs CASCADE`);
    console.log('   ✅ Error logs cleared');

    console.log('2️⃣  Clearing marketplace data...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE marketplace_sales CASCADE`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE marketplace_offers CASCADE`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE marketplace_listings CASCADE`);
    console.log('   ✅ Marketplace data cleared');

    console.log('3️⃣  Clearing activities...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE activities CASCADE`);
    console.log('   ✅ Activities cleared');

    console.log('4️⃣  Clearing mints...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE mints CASCADE`);
    console.log('   ✅ Mints cleared');

    console.log('5️⃣  Clearing NFT data...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE nft_transfers CASCADE`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE nft_ownership CASCADE`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE nft_attributes CASCADE`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE nfts CASCADE`);
    console.log('   ✅ NFT data cleared');

    console.log('6️⃣  Clearing NFT collection analytics...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE nft_collection_analytics CASCADE`);
    console.log('   ✅ NFT collection analytics cleared');

    console.log('7️⃣  Clearing NFT contracts...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE nft_contracts CASCADE`);
    console.log('   ✅ NFT contracts cleared');

    console.log('8️⃣  Clearing launchpad analytics...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE launchpad_analytics CASCADE`);
    console.log('   ✅ Launchpad analytics cleared');

    console.log('9️⃣  Clearing launchpad phases...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE launchpad_phases CASCADE`);
    console.log('   ✅ Launchpad phases cleared');

    console.log('🔟  Clearing launchpad metadata...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE launchpad_metadata CASCADE`);
    console.log('   ✅ Launchpad metadata cleared');

    console.log('1️⃣1️⃣  Clearing launchpads...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE launchpads CASCADE`);
    console.log('   ✅ Launchpads cleared');

    console.log('1️⃣2️⃣  Clearing launchpad factories...');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE launchpad_factories CASCADE`);
    console.log('   ✅ Launchpad factories cleared');

    console.log('\n✅ Full reset complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Restart the blockchain listener to re-index everything');
    console.log('   2. Factories and launchpads will be auto-discovered from blockchain');

  } catch (error) {
    console.error('\n❌ Error during reset:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the reset
resetAllData();
