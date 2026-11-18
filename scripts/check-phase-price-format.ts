/**
 * Check Phase Price Format
 * 
 * Script to check if phase prices are stored correctly in the database
 */

import { prisma } from '../src/config/database';
import { ethers } from 'ethers';

async function checkPhasePriceFormat() {
  console.log('🔍 Checking phase price formats in database...\n');

  try {
    // Get all phases with their prices
    const phases = await prisma.launchpadPhase.findMany({
      include: {
        launchpad: {
          select: {
            name: true,
            contractAddress: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 20 // Check last 20 phases
    });

    console.log(`Found ${phases.length} phases\n`);

    let correctCount = 0;
    let incorrectCount = 0;

    for (const phase of phases) {
      const priceStr = phase.price;
      
      // Check if price looks like wei (should be a large integer)
      // Wei values are typically 15-18 digits for reasonable ETH amounts
      const isLikelyWei = /^\d{15,}$/.test(priceStr);
      
      // Check if price looks like ether (has decimal point)
      const isLikelyEther = priceStr.includes('.');
      
      // Try to parse as BigInt
      let isValidBigInt = false;
      try {
        BigInt(priceStr);
        isValidBigInt = true;
      } catch (e) {
        isValidBigInt = false;
      }

      const status = isLikelyWei && isValidBigInt ? '✅ CORRECT' : '❌ INCORRECT';
      
      if (isLikelyWei && isValidBigInt) {
        correctCount++;
      } else {
        incorrectCount++;
      }

      console.log(`${status} Phase: ${phase.name}`);
      console.log(`  Launchpad: ${phase.launchpad.name} (${phase.launchpad.contractAddress})`);
      console.log(`  Price (raw): ${priceStr}`);
      console.log(`  Has decimal: ${isLikelyEther ? 'YES ❌' : 'NO ✅'}`);
      console.log(`  Valid BigInt: ${isValidBigInt ? 'YES ✅' : 'NO ❌'}`);
      console.log(`  Looks like wei: ${isLikelyWei ? 'YES ✅' : 'NO ❌'}`);
      
      if (isValidBigInt) {
        try {
          const etherValue = ethers.formatEther(priceStr);
          console.log(`  Price in ETH: ${etherValue} ETH`);
        } catch (e) {
          console.log(`  Price in ETH: Cannot convert`);
        }
      }
      
      console.log('');
    }

    console.log('\n📊 Summary:');
    console.log(`  ✅ Correct format (wei): ${correctCount}`);
    console.log(`  ❌ Incorrect format: ${incorrectCount}`);

    if (incorrectCount > 0) {
      console.log('\n⚠️  WARNING: Some phases have incorrect price format!');
      console.log('   Prices should be stored as wei (large integers), not ether (decimals)');
      console.log('   Example: "100000000000000" (0.0001 ETH in wei) not "0.0001"');
    }

  } catch (error) {
    console.error('❌ Error checking phase prices:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the check
checkPhasePriceFormat()
  .then(() => {
    console.log('\n✅ Check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Check failed:', error);
    process.exit(1);
  });
