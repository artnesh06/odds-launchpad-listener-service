/**
 * Check Ownership Count
 * 
 * Quick check untuk ownership count
 */

import { prisma } from '../src/config/database';

async function main() {
  const contractAddress = '0x5cb7ecaf7c9eea5ac5fb8109d600e52c6d0261d0';
  const chainId = 4326;

  console.log('🔍 Checking Ownership Count');
  console.log('='.repeat(80));
  
  // Count NFTs
  const nftCount = await prisma.nFT.count({
    where: {
      contractAddress: contractAddress.toLowerCase(),
      chainId,
    },
  });

  // Count all ownership records
  const totalOwnership = await prisma.nFTOwnership.count({
    where: {
      nft: {
        contractAddress: contractAddress.toLowerCase(),
        chainId,
      },
    },
  });

  // Count current ownership records
  const currentOwnership = await prisma.nFTOwnership.count({
    where: {
      nft: {
        contractAddress: contractAddress.toLowerCase(),
        chainId,
      },
      isCurrent: true,
    },
  });

  console.log(`📊 NFTs: ${nftCount}`);
  console.log(`📊 Total Ownership Records: ${totalOwnership}`);
  console.log(`📊 Current Ownership Records: ${currentOwnership}`);
  console.log('');

  if (currentOwnership > nftCount) {
    console.log(`⚠️  Problem: ${currentOwnership - nftCount} extra current ownership records!`);
    console.log('');

    // Find NFTs with multiple current owners
    const multipleOwners = await prisma.$queryRaw<Array<{
      nftId: string;
      tokenId: string;
      count: bigint;
    }>>`
      SELECT 
        o."nftId",
        n."tokenId",
        COUNT(*) as count
      FROM nft_ownership o
      JOIN nfts n ON n.id = o."nftId"
      WHERE n."contractAddress" = ${contractAddress.toLowerCase()}
        AND n."chainId" = ${chainId}
        AND o."isCurrent" = true
      GROUP BY o."nftId", n."tokenId"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
    `;

    if (multipleOwners.length > 0) {
      console.log(`❌ Found ${multipleOwners.length} NFTs with multiple current owners:`);
      for (const nft of multipleOwners) {
        console.log(`   Token ${nft.tokenId}: ${nft.count} current owners`);
      }
      console.log('');
      console.log('💡 Run this to fix:');
      console.log(`   npx tsx scripts/find-duplicate-ownership.ts ${contractAddress} ${chainId} --fix`);
    }
  } else if (currentOwnership < nftCount) {
    console.log(`⚠️  Problem: ${nftCount - currentOwnership} NFTs without current owner!`);
    
    // Find NFTs without current owner
    const withoutOwner = await prisma.nFT.findMany({
      where: {
        contractAddress: contractAddress.toLowerCase(),
        chainId,
        ownerships: {
          none: {
            isCurrent: true,
          },
        },
      },
      select: {
        tokenId: true,
      },
    });

    if (withoutOwner.length > 0) {
      console.log(`❌ NFTs without current owner:`);
      console.log(`   Token IDs: ${withoutOwner.map(n => n.tokenId).join(', ')}`);
    }
  } else {
    console.log('✅ All good! Each NFT has exactly 1 current owner');
  }

  console.log('');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main();
