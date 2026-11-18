/**
 * Verification script to check if isFeatured field was added successfully
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Verifying isFeatured field migration...\n');

  try {
    // Check if the column exists
    const result = await prisma.$queryRaw`
      SELECT 
        column_name,
        data_type,
        column_default,
        is_nullable
      FROM information_schema.columns
      WHERE table_name = 'launchpads' 
      AND column_name = 'isFeatured';
    `;

    if (result.length === 0) {
      console.error('❌ isFeatured column not found in launchpads table');
      process.exit(1);
    }

    console.log('✓ Column exists:');
    console.log('  Name:', result[0].column_name);
    console.log('  Type:', result[0].data_type);
    console.log('  Default:', result[0].column_default);
    console.log('  Nullable:', result[0].is_nullable);

    // Check if the index exists
    const indexResult = await prisma.$queryRaw`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'launchpads'
      AND indexname = 'launchpads_isFeatured_idx';
    `;

    if (indexResult.length === 0) {
      console.error('\n❌ Index launchpads_isFeatured_idx not found');
      process.exit(1);
    }

    console.log('\n✓ Index exists:');
    console.log('  Name:', indexResult[0].indexname);
    console.log('  Definition:', indexResult[0].indexdef);

    // Test querying by isFeatured
    console.log('\n✓ Testing query functionality...');
    const featuredCount = await prisma.launchpad.count({
      where: { isFeatured: true }
    });
    const nonFeaturedCount = await prisma.launchpad.count({
      where: { isFeatured: false }
    });
    console.log('  Featured launchpads:', featuredCount);
    console.log('  Non-featured launchpads:', nonFeaturedCount);

    console.log('\n✅ All verification checks passed!');
    console.log('The isFeatured field is working correctly.');

  } catch (error) {
    console.error('❌ Verification failed:', error.message);
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
