/**
 * Fix Phase Price Format
 * 
 * Script to fix phase prices that are stored in ether format (with decimals)
 * and convert them back to wei format (large integers)
 */

import { prisma } from '../src/config/database';
import { ethers } from 'ethers';

async function fixPhasePriceFormat() {
  console.log('🔧 Fixing phase price formats in database...\n');

  try {
    // Get all phases
    const phases = await prisma.launchpadPhase.findMany({
      include: {
        launchpad: {
          select: {
            name: true,
            contractAddress: true,
          }
        }
      }
    });

    console.log(`Found ${phases.length} phases to check\n`);

    let fixedCount = 0;
    let alreadyCorrectCount = 0;
    const fixedPhases: any[] = [];

    for (const phase of phases) {
      const priceStr = phase.price;
      
      // Check if price has decimal point (incorrect format)
      if (priceStr.includes('.')) {
        console.log(`❌ FIXING: ${phase.name} (${phase.launchpad.name})`);
        console.log(`   Old price: ${priceStr}`);
        
        try {
          // Convert from ether to wei
          const priceInWei = ethers.parseEther(priceStr);
          const newPriceStr = priceInWei.toString();
          
          console.log(`   New price: ${newPriceStr} wei`);
          console.log(`   Equivalent: ${ethers.formatEther(newPriceStr)} ETH`);
          
          // Update in database
          await prisma.launchpadPhase.update({
            where: { id: phase.id },
            data: { price: newPriceStr }
          });
          
          fixedCount++;
          fixedPhases.push({
            name: phase.name,
            launchpad: phase.launchpad.name,
            oldPrice: priceStr,
            newPrice: newPriceStr
          });
          
          console.log(`   ✅ Fixed!\n`);
        } catch (error) {
          console.error(`   ❌ Error fixing price:`, error);
          console.log('');
        }
      } else {
        // Check if it's a valid BigInt
        try {
          BigInt(priceStr);
          alreadyCorrectCount++;
        } catch (e) {
          console.log(`⚠️  WARNING: Invalid price format for ${phase.name}: ${priceStr}`);
        }
      }
    }

    console.log('\n📊 Summary:');
    console.log(`  ✅ Fixed: ${fixedCount}`);
    console.log(`  ✓  Already correct: ${alreadyCorrectCount}`);
    console.log(`  📝 Total checked: ${phases.length}`);

    if (fixedPhases.length > 0) {
      console.log('\n📋 Fixed phases:');
      for (const fixed of fixedPhases) {
        console.log(`  - ${fixed.name} (${fixed.launchpad})`);
        console.log(`    ${fixed.oldPrice} → ${fixed.newPrice}`);
      }
    }

  } catch (error) {
    console.error('❌ Error fixing phase prices:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixPhasePriceFormat()
  .then(() => {
    console.log('\n✅ Fix completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Fix failed:', error);
    process.exit(1);
  });
