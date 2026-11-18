/**
 * Fix Minted Count
 * 
 * Update mintedCount back to 63 (correct value from OpenSea)
 */

import { prisma } from '../src/config/database';

async function main() {
  const contractAddress = '0x5cb7ecaf7c9eea5ac5fb8109d600e52c6d0261d0';
  const chainId = 4326;
  const correctMintedCount = 63;

  console.log('🔧 Fixing Minted Count');
  console.log('='.repeat(80));
  console.log(`Contract: ${contractAddress}`);
  console.log(`Chain: ${chainId}`);
  console.log(`Setting mintedCount to: ${correctMintedCount}`);
  console.log('='.repeat(80));
  console.log('');

  const result = await prisma.launchpad.updateMany({
    where: {
      contractAddress: contractAddress.toLowerCase(),
      chainId,
    },
    data: {
      mintedCount: correctMintedCount,
    },
  });

  console.log(`✅ Updated ${result.count} launchpad(s)`);
  console.log('');

  await prisma.$disconnect();
}

main();
