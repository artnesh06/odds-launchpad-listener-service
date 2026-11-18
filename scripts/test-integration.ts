/**
 * Integration Test Script
 * Tests the complete NFT indexing flow with real data
 */

import { PrismaClient } from '@prisma/client';
import { ethers } from 'ethers';

const prisma = new PrismaClient();

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
  duration?: number;
}

const results: TestResult[] = [];

function logTest(result: TestResult) {
  const icon = result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} ${result.test}: ${result.message}`);
  results.push(result);
}

/**
 * Test 1: Database Connection
 */
async function testDatabaseConnection(): Promise<void> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    logTest({
      test: 'Database Connection',
      status: 'PASS',
      message: 'Successfully connected to database',
      duration: Date.now() - start,
    });
  } catch (error) {
    logTest({
      test: 'Database Connection',
      status: 'FAIL',
      message: `Failed to connect: ${error}`,
      duration: Date.now() - start,
    });
    throw error;
  }
}

/**
 * Test 2: Schema Validation
 */
async function testSchemaValidation(): Promise<void> {
  const start = Date.now();
  try {
    // Check if all required tables exist
    const tables = [
      'nfts',
      'nft_contracts',
      'nft_attributes',
      'nft_ownership',
      'nft_transfers',
      'marketplace_listings',
      'marketplace_sales',
      'marketplace_offers',
      'nft_floor_prices',
      'nft_rarity',
      'nft_collection_analytics',
      'error_logs',
    ];

    const tableChecks = await Promise.all(
      tables.map(async (table) => {
        const result = await prisma.$queryRawUnsafe<any[]>(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = '${table}'
          );
        `);
        return { table, exists: result[0]?.exists || false };
      })
    );

    const missingTables = tableChecks.filter((t) => !t.exists);

    if (missingTables.length === 0) {
      logTest({
        test: 'Schema Validation',
        status: 'PASS',
        message: `All ${tables.length} required tables exist`,
        duration: Date.now() - start,
      });
    } else {
      logTest({
        test: 'Schema Validation',
        status: 'FAIL',
        message: `Missing tables: ${missingTables.map((t) => t.table).join(', ')}`,
        duration: Date.now() - start,
      });
    }
  } catch (error) {
    logTest({
      test: 'Schema Validation',
      status: 'FAIL',
      message: `Error checking schema: ${error}`,
      duration: Date.now() - start,
    });
  }
}

/**
 * Test 3: RPC Connection
 */
async function testRPCConnection(): Promise<void> {
  const start = Date.now();
  try {
    const chains = await prisma.chain.findMany({
      select: { chainId: true, name: true, rpcUrl: true },
      take: 3, // Test first 3 chains
    });

    if (chains.length === 0) {
      logTest({
        test: 'RPC Connection',
        status: 'SKIP',
        message: 'No chains configured in database',
        duration: Date.now() - start,
      });
      return;
    }

    const rpcTests = await Promise.allSettled(
      chains.map(async (chain) => {
        const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
        const blockNumber = await provider.getBlockNumber();
        return { chain: chain.name, blockNumber };
      })
    );

    const successful = rpcTests.filter((r) => r.status === 'fulfilled').length;
    const failed = rpcTests.filter((r) => r.status === 'rejected').length;

    if (failed === 0) {
      logTest({
        test: 'RPC Connection',
        status: 'PASS',
        message: `All ${successful} RPC connections successful`,
        duration: Date.now() - start,
      });
    } else {
      logTest({
        test: 'RPC Connection',
        status: 'FAIL',
        message: `${failed} of ${chains.length} RPC connections failed`,
        duration: Date.now() - start,
      });
    }
  } catch (error) {
    logTest({
      test: 'RPC Connection',
      status: 'FAIL',
      message: `Error testing RPC: ${error}`,
      duration: Date.now() - start,
    });
  }
}

/**
 * Test 4: NFT Data Integrity
 */
async function testNFTDataIntegrity(): Promise<void> {
  const start = Date.now();
  try {
    const nftCount = await prisma.nFT.count();

    if (nftCount === 0) {
      logTest({
        test: 'NFT Data Integrity',
        status: 'SKIP',
        message: 'No NFTs in database yet',
        duration: Date.now() - start,
      });
      return;
    }

    // Check for NFTs with required fields
    const nftsWithMetadata = await prisma.nFT.count({
      where: {
        AND: [
          { contractAddress: { not: '' } },
          { tokenId: { not: '' } },
          { tokenType: { not: '' } },
        ],
      },
    });

    const integrity = (nftsWithMetadata / nftCount) * 100;

    if (integrity === 100) {
      logTest({
        test: 'NFT Data Integrity',
        status: 'PASS',
        message: `All ${nftCount} NFTs have required fields`,
        duration: Date.now() - start,
      });
    } else {
      logTest({
        test: 'NFT Data Integrity',
        status: 'FAIL',
        message: `Only ${integrity.toFixed(1)}% of NFTs have complete data`,
        duration: Date.now() - start,
      });
    }
  } catch (error) {
    logTest({
      test: 'NFT Data Integrity',
      status: 'FAIL',
      message: `Error checking integrity: ${error}`,
      duration: Date.now() - start,
    });
  }
}

/**
 * Test 5: Ownership Tracking
 */
async function testOwnershipTracking(): Promise<void> {
  const start = Date.now();
  try {
    const ownershipCount = await prisma.nFTOwnership.count();

    if (ownershipCount === 0) {
      logTest({
        test: 'Ownership Tracking',
        status: 'SKIP',
        message: 'No ownership records yet',
        duration: Date.now() - start,
      });
      return;
    }

    // Check for current ownership records
    const currentOwnership = await prisma.nFTOwnership.count({
      where: { isCurrent: true },
    });

    logTest({
      test: 'Ownership Tracking',
      status: 'PASS',
      message: `${currentOwnership} current ownership records, ${ownershipCount - currentOwnership} historical`,
      duration: Date.now() - start,
    });
  } catch (error) {
    logTest({
      test: 'Ownership Tracking',
      status: 'FAIL',
      message: `Error checking ownership: ${error}`,
      duration: Date.now() - start,
    });
  }
}

/**
 * Test 6: Marketplace Data
 */
async function testMarketplaceData(): Promise<void> {
  const start = Date.now();
  try {
    const [salesCount, listingsCount, offersCount] = await Promise.all([
      prisma.marketplaceSale.count(),
      prisma.marketplaceListing.count(),
      prisma.marketplaceOffer.count(),
    ]);

    const total = salesCount + listingsCount + offersCount;

    if (total === 0) {
      logTest({
        test: 'Marketplace Data',
        status: 'SKIP',
        message: 'No marketplace data yet',
        duration: Date.now() - start,
      });
      return;
    }

    logTest({
      test: 'Marketplace Data',
      status: 'PASS',
      message: `${salesCount} sales, ${listingsCount} listings, ${offersCount} offers`,
      duration: Date.now() - start,
    });
  } catch (error) {
    logTest({
      test: 'Marketplace Data',
      status: 'FAIL',
      message: `Error checking marketplace data: ${error}`,
      duration: Date.now() - start,
    });
  }
}

/**
 * Test 7: Analytics Calculation
 */
async function testAnalyticsCalculation(): Promise<void> {
  const start = Date.now();
  try {
    const analyticsCount = await prisma.nFTCollectionAnalytics.count();

    if (analyticsCount === 0) {
      logTest({
        test: 'Analytics Calculation',
        status: 'SKIP',
        message: 'No analytics calculated yet',
        duration: Date.now() - start,
      });
      return;
    }

    // Check for recent analytics
    const recentAnalytics = await prisma.nFTCollectionAnalytics.count({
      where: {
        calculatedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    });

    logTest({
      test: 'Analytics Calculation',
      status: 'PASS',
      message: `${analyticsCount} collections analyzed, ${recentAnalytics} updated in last 24h`,
      duration: Date.now() - start,
    });
  } catch (error) {
    logTest({
      test: 'Analytics Calculation',
      status: 'FAIL',
      message: `Error checking analytics: ${error}`,
      duration: Date.now() - start,
    });
  }
}

/**
 * Test 8: Error Logging
 */
async function testErrorLogging(): Promise<void> {
  const start = Date.now();
  try {
    const errorCount = await prisma.errorLog.count();

    // Check recent errors
    const recentErrors = await prisma.errorLog.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 60 * 60 * 1000), // Last hour
        },
      },
    });

    logTest({
      test: 'Error Logging',
      status: 'PASS',
      message: `${errorCount} total errors logged, ${recentErrors} in last hour`,
      duration: Date.now() - start,
    });
  } catch (error) {
    logTest({
      test: 'Error Logging',
      status: 'FAIL',
      message: `Error checking error logs: ${error}`,
      duration: Date.now() - start,
    });
  }
}

/**
 * Run all tests
 */
async function runIntegrationTests() {
  console.log('🧪 Running Integration Tests...\n');
  console.log('=' .repeat(60));

  const startTime = Date.now();

  try {
    await testDatabaseConnection();
    await testSchemaValidation();
    await testRPCConnection();
    await testNFTDataIntegrity();
    await testOwnershipTracking();
    await testMarketplaceData();
    await testAnalyticsCalculation();
    await testErrorLogging();
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
  }

  const totalDuration = Date.now() - startTime;

  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Test Summary:');
  console.log(`   Total Tests: ${results.length}`);
  console.log(
    `   Passed: ${results.filter((r) => r.status === 'PASS').length}`
  );
  console.log(
    `   Failed: ${results.filter((r) => r.status === 'FAIL').length}`
  );
  console.log(
    `   Skipped: ${results.filter((r) => r.status === 'SKIP').length}`
  );
  console.log(`   Duration: ${totalDuration}ms`);

  const failedTests = results.filter((r) => r.status === 'FAIL');
  if (failedTests.length > 0) {
    console.log('\n❌ Failed Tests:');
    failedTests.forEach((test) => {
      console.log(`   - ${test.test}: ${test.message}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  runIntegrationTests()
    .catch((error) => {
      console.error('❌ Test runner failed:', error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}

export { runIntegrationTests };
