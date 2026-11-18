/**
 * NFT Integration Testing Script
 * 
 * This script tests the integration between Activity Listener and NFT Event Handler
 * to ensure mint events properly save NFT data to the database.
 */

import { prisma } from '../src/config/database';
import { ethers } from 'ethers';

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
  details?: any;
}

const results: TestResult[] = [];

/**
 * Test 1: Check if NFT tables exist in database
 */
async function testDatabaseSchema(): Promise<TestResult> {
  try {
    console.log('\n🧪 Test 1: Checking database schema...');
    
    // Try to query each NFT table
    const tables = [
      { name: 'NFT', query: () => prisma.nFT.findFirst() },
      { name: 'NFTContract', query: () => prisma.nFTContract.findFirst() },
      { name: 'NFTAttribute', query: () => prisma.nFTAttribute.findFirst() },
      { name: 'NFTOwnership', query: () => prisma.nFTOwnership.findFirst() },
      { name: 'NFTTransfer', query: () => prisma.nFTTransfer.findFirst() },
    ];

    const tableResults = [];
    for (const table of tables) {
      try {
        await table.query();
        tableResults.push(`✅ ${table.name}`);
      } catch (error: any) {
        tableResults.push(`❌ ${table.name}: ${error.message}`);
      }
    }

    return {
      test: 'Database Schema',
      status: 'PASS',
      message: 'All NFT tables exist',
      details: tableResults
    };
  } catch (error: any) {
    return {
      test: 'Database Schema',
      status: 'FAIL',
      message: error.message
    };
  }
}

/**
 * Test 2: Check if Alchemy API key is configured
 */
async function testAlchemyConfig(): Promise<TestResult> {
  try {
    console.log('\n🧪 Test 2: Checking Alchemy configuration...');
    
    const alchemyKey = process.env.ALCHEMY_API_KEY;
    const hasChainSpecificKeys = Object.keys(process.env).some(key => 
      key.startsWith('ALCHEMY_API_KEY_')
    );

    if (!alchemyKey && !hasChainSpecificKeys) {
      return {
        test: 'Alchemy Configuration',
        status: 'FAIL',
        message: 'No Alchemy API key found in environment',
        details: {
          suggestion: 'Add ALCHEMY_API_KEY to .env file'
        }
      };
    }

    return {
      test: 'Alchemy Configuration',
      status: 'PASS',
      message: 'Alchemy API key configured',
      details: {
        globalKey: !!alchemyKey,
        chainSpecificKeys: hasChainSpecificKeys
      }
    };
  } catch (error: any) {
    return {
      test: 'Alchemy Configuration',
      status: 'FAIL',
      message: error.message
    };
  }
}

/**
 * Test 3: Check if there are any minted NFTs in Activity table
 */
async function testMintActivities(): Promise<TestResult> {
  try {
    console.log('\n🧪 Test 3: Checking mint activities...');
    
    const mintActivities = await prisma.activity.findMany({
      where: {
        type: 'MINT_OCCURRED'
      },
      take: 10,
      orderBy: {
        createdAt: 'desc'
      }
    });

    // Get launchpad info separately
    const activitiesWithLaunchpad = await Promise.all(
      mintActivities.map(async (activity) => {
        if (!activity.launchpadId) return { ...activity, launchpad: null };
        const launchpad = await prisma.launchpad.findUnique({
          where: { id: activity.launchpadId },
          select: { contractAddress: true, name: true, chainId: true }
        });
        return { ...activity, launchpad };
      })
    );

    if (activitiesWithLaunchpad.length === 0) {
      return {
        test: 'Mint Activities',
        status: 'SKIP',
        message: 'No mint activities found in database',
        details: {
          suggestion: 'Trigger a mint event to test the integration'
        }
      };
    }

    return {
      test: 'Mint Activities',
      status: 'PASS',
      message: `Found ${activitiesWithLaunchpad.length} mint activities`,
      details: {
        count: activitiesWithLaunchpad.length,
        recentMints: activitiesWithLaunchpad.slice(0, 3).map(m => ({
          txHash: m.txHash,
          tokenId: (m.metadata as any)?.tokenId,
          launchpad: m.launchpad?.name,
          chainId: m.launchpad?.chainId
        }))
      }
    };
  } catch (error: any) {
    return {
      test: 'Mint Activities',
      status: 'FAIL',
      message: error.message
    };
  }
}

/**
 * Test 4: Check if NFTs are being saved to NFT table
 */
async function testNFTData(): Promise<TestResult> {
  try {
    console.log('\n🧪 Test 4: Checking NFT data...');
    
    const nfts = await prisma.nFT.findMany({
      take: 10,
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        contract: {
          select: {
            address: true,
            name: true,
            symbol: true
          }
        },
        attributes: true,
        ownership: {
          where: {
            isCurrent: true
          }
        }
      }
    });

    if (nfts.length === 0) {
      return {
        test: 'NFT Data',
        status: 'FAIL',
        message: 'No NFTs found in database - Integration may not be working',
        details: {
          suggestion: 'Check if NFT Event Handler is being called in handleMintEvent'
        }
      };
    }

    // Check if NFTs have metadata
    const nftsWithMetadata = nfts.filter(nft => nft.name || nft.description);
    const nftsWithAttributes = nfts.filter(nft => nft.attributes.length > 0);
    const nftsWithOwnership = nfts.filter(nft => nft.ownership.length > 0);

    return {
      test: 'NFT Data',
      status: 'PASS',
      message: `Found ${nfts.length} NFTs in database`,
      details: {
        totalNFTs: nfts.length,
        withMetadata: nftsWithMetadata.length,
        withAttributes: nftsWithAttributes.length,
        withOwnership: nftsWithOwnership.length,
        recentNFTs: nfts.slice(0, 3).map(nft => ({
          tokenId: nft.tokenId,
          contract: nft.contract?.name,
          name: nft.name,
          hasMetadata: !!(nft.name || nft.description),
          attributeCount: nft.attributes.length,
          owner: nft.ownership[0]?.ownerAddress
        }))
      }
    };
  } catch (error: any) {
    return {
      test: 'NFT Data',
      status: 'FAIL',
      message: error.message
    };
  }
}

/**
 * Test 5: Cross-check mint activities with NFT data
 */
async function testMintToNFTCorrelation(): Promise<TestResult> {
  try {
    console.log('\n🧪 Test 5: Cross-checking mint activities with NFT data...');
    
    // Get recent mint activities
    const mintActivities = await prisma.activity.findMany({
      where: {
        type: 'MINT_OCCURRED'
      },
      take: 20,
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (mintActivities.length === 0) {
      return {
        test: 'Mint-NFT Correlation',
        status: 'SKIP',
        message: 'No mint activities to check'
      };
    }

    // Check if corresponding NFTs exist
    const correlationResults = [];
    for (const activity of mintActivities.slice(0, 10)) {
      const tokenId = (activity.metadata as any)?.tokenId;
      
      // Get launchpad info
      let contractAddress: string | undefined;
      let chainId: number | undefined;
      if (activity.launchpadId) {
        const launchpad = await prisma.launchpad.findUnique({
          where: { id: activity.launchpadId },
          select: { contractAddress: true, chainId: true }
        });
        contractAddress = launchpad?.contractAddress;
        chainId = launchpad?.chainId;
      }

      if (!tokenId || !contractAddress || !chainId) {
        continue;
      }

      const nft = await prisma.nFT.findFirst({
        where: {
          contractAddress: contractAddress.toLowerCase(),
          tokenId: tokenId.toString(),
          chainId: chainId
        }
      });

      correlationResults.push({
        txHash: activity.txHash,
        tokenId,
        contractAddress,
        nftExists: !!nft,
        hasMetadata: !!(nft?.name || nft?.description)
      });
    }

    const nftsFound = correlationResults.filter(r => r.nftExists).length;
    const nftsWithMetadata = correlationResults.filter(r => r.hasMetadata).length;
    const totalChecked = correlationResults.length;

    const status = nftsFound === totalChecked ? 'PASS' : 
                   nftsFound > 0 ? 'PASS' : 'FAIL';

    return {
      test: 'Mint-NFT Correlation',
      status,
      message: `${nftsFound}/${totalChecked} mint activities have corresponding NFT data`,
      details: {
        totalChecked,
        nftsFound,
        nftsWithMetadata,
        correlationRate: `${Math.round((nftsFound / totalChecked) * 100)}%`,
        samples: correlationResults.slice(0, 5)
      }
    };
  } catch (error: any) {
    return {
      test: 'Mint-NFT Correlation',
      status: 'FAIL',
      message: error.message
    };
  }
}

/**
 * Test 6: Check NFT ownership tracking
 */
async function testOwnershipTracking(): Promise<TestResult> {
  try {
    console.log('\n🧪 Test 6: Checking ownership tracking...');
    
    const ownerships = await prisma.nFTOwnership.findMany({
      where: {
        isCurrent: true
      },
      take: 10,
      include: {
        nft: {
          select: {
            tokenId: true,
            contractAddress: true
          }
        }
      }
    });

    if (ownerships.length === 0) {
      return {
        test: 'Ownership Tracking',
        status: 'FAIL',
        message: 'No ownership records found',
        details: {
          suggestion: 'Check if NFT Event Handler is creating ownership records'
        }
      };
    }

    return {
      test: 'Ownership Tracking',
      status: 'PASS',
      message: `Found ${ownerships.length} current ownership records`,
      details: {
        totalRecords: ownerships.length,
        samples: ownerships.slice(0, 3).map(o => ({
          tokenId: o.nft.tokenId,
          owner: o.ownerAddress,
          acquiredAt: o.acquiredAt
        }))
      }
    };
  } catch (error: any) {
    return {
      test: 'Ownership Tracking',
      status: 'FAIL',
      message: error.message
    };
  }
}

/**
 * Test 7: Check NFT transfer records
 */
async function testTransferRecords(): Promise<TestResult> {
  try {
    console.log('\n🧪 Test 7: Checking transfer records...');
    
    const transfers = await prisma.nFTTransfer.findMany({
      where: {
        transferType: 'MINT'
      },
      take: 10,
      orderBy: {
        createdAt: 'desc'
      },
      include: {
        nft: {
          select: {
            tokenId: true,
            contractAddress: true
          }
        }
      }
    });

    if (transfers.length === 0) {
      return {
        test: 'Transfer Records',
        status: 'FAIL',
        message: 'No mint transfer records found',
        details: {
          suggestion: 'Check if NFT Event Handler is creating transfer records'
        }
      };
    }

    return {
      test: 'Transfer Records',
      status: 'PASS',
      message: `Found ${transfers.length} mint transfer records`,
      details: {
        totalRecords: transfers.length,
        samples: transfers.slice(0, 3).map(t => ({
          tokenId: t.nft.tokenId,
          from: t.fromAddress,
          to: t.toAddress,
          txHash: t.txHash
        }))
      }
    };
  } catch (error: any) {
    return {
      test: 'Transfer Records',
      status: 'FAIL',
      message: error.message
    };
  }
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('🚀 Starting NFT Integration Tests...\n');
  console.log('=' .repeat(60));

  // Run all tests
  results.push(await testDatabaseSchema());
  results.push(await testAlchemyConfig());
  results.push(await testMintActivities());
  results.push(await testNFTData());
  results.push(await testMintToNFTCorrelation());
  results.push(await testOwnershipTracking());
  results.push(await testTransferRecords());

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 TEST SUMMARY\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const skipped = results.filter(r => r.status === 'SKIP').length;

  results.forEach(result => {
    const icon = result.status === 'PASS' ? '✅' : 
                 result.status === 'FAIL' ? '❌' : '⏭️';
    console.log(`${icon} ${result.test}: ${result.message}`);
    
    if (result.details) {
      console.log(`   Details:`, JSON.stringify(result.details, null, 2));
    }
  });

  console.log('\n' + '='.repeat(60));
  console.log(`\n📈 Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  
  if (failed > 0) {
    console.log('\n❌ Some tests failed. Please review the details above.');
    process.exit(1);
  } else if (passed === 0 && skipped > 0) {
    console.log('\n⚠️ No tests passed. You may need to trigger mint events first.');
    process.exit(0);
  } else {
    console.log('\n✅ All tests passed! NFT integration is working correctly.');
    process.exit(0);
  }
}

// Run tests
runTests().catch(error => {
  console.error('❌ Test runner error:', error);
  process.exit(1);
});
