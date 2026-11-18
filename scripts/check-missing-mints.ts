/**
 * Check Missing Mints
 * 
 * Script untuk check token IDs mana yang belum ter-record
 */

import { prisma } from '../src/config/database';

async function main() {
  const contractAddress = '0x5cb7ecaf7c9eea5ac5fb8109d600e52c6d0261d0';
  const chainId = 4326;

  console.log('🔍 Checking Missing Mints');
  console.log('='.repeat(80));
  console.log(`Contract: ${contractAddress}`);
  console.log(`Chain: ${chainId}`);
  console.log('='.repeat(80));
  console.log('');

  // Get all MINT transfers
  const transfers = await prisma.nFTTransfer.findMany({
    where: {
      nft: {
        contractAddress: contractAddress.toLowerCase(),
        chainId,
      },
      transferType: 'MINT',
    },
    select: {
      nft: {
        select: {
          tokenId: true,
        },
      },
      txHash: true,
      blockNumber: true,
    },
    orderBy: {
      blockNumber: 'asc',
    },
  });

  console.log(`📊 Total MINT transfers in database: ${transfers.length}`);
  console.log('');

  // Get token IDs
  const tokenIds = transfers.map(t => parseInt(t.nft.tokenId)).sort((a, b) => a - b);
  
  console.log('✅ Token IDs yang sudah ter-record:');
  console.log(tokenIds.join(', '));
  console.log('');

  // Find missing token IDs (assuming sequential from 0 to max)
  const maxTokenId = Math.max(...tokenIds);
  const missing: number[] = [];
  
  for (let i = 0; i <= maxTokenId; i++) {
    if (!tokenIds.includes(i)) {
      missing.push(i);
    }
  }

  if (missing.length > 0) {
    console.log(`❌ Missing Token IDs (${missing.length}):`);
    console.log(missing.join(', '));
    console.log('');
  } else {
    console.log('✅ No missing token IDs in sequence 0 to ' + maxTokenId);
    console.log('');
  }

  // Check if there are tokens beyond maxTokenId
  console.log(`📊 Expected total (if sequential 0-${maxTokenId}): ${maxTokenId + 1}`);
  console.log(`📊 Actual total in database: ${transfers.length}`);
  console.log(`📊 Difference: ${(maxTokenId + 1) - transfers.length}`);
  console.log('');

  // Get all NFTs (not just transfers)
  const allNFTs = await prisma.nFT.findMany({
    where: {
      contractAddress: contractAddress.toLowerCase(),
      chainId,
    },
    select: {
      tokenId: true,
    },
    orderBy: {
      tokenId: 'asc',
    },
  });

  console.log(`📊 Total NFTs in database: ${allNFTs.length}`);
  const nftTokenIds = allNFTs.map(n => parseInt(n.tokenId)).sort((a, b) => a - b);
  console.log('NFT Token IDs:', nftTokenIds.join(', '));
  console.log('');

  // Find NFTs without MINT transfer
  const nftsWithoutMint = nftTokenIds.filter(id => !tokenIds.includes(id));
  if (nftsWithoutMint.length > 0) {
    console.log(`⚠️  NFTs without MINT transfer (${nftsWithoutMint.length}):`);
    console.log(nftsWithoutMint.join(', '));
  }

  await prisma.$disconnect();
}

main();
