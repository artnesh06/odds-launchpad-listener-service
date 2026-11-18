/**
 * Check if token #9 exists in database
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const contractAddress = '0xbce4ef852f05bb42e6c66f4c0006d370b777aae5';
  const tokenId = '9';

  console.log(`🔍 Checking for token #${tokenId} at ${contractAddress}...`);

  // Check NFT
  const nft = await prisma.nFT.findFirst({
    where: {
      contractAddress: contractAddress.toLowerCase(),
      tokenId: tokenId,
    },
    include: {
      contract: true,
      attributes: true,
      ownership: true,
    }
  });

  if (nft) {
    console.log('✅ NFT found in database:');
    console.log(JSON.stringify(nft, null, 2));
  } else {
    console.log('❌ NFT not found in database');
    
    // Check if contract exists
    const contract = await prisma.nFTContract.findFirst({
      where: {
        address: contractAddress.toLowerCase(),
      }
    });
    
    if (contract) {
      console.log('✅ Contract exists:', contract.name);
    } else {
      console.log('❌ Contract not found');
    }
    
    // Check transfers
    const transfers = await prisma.nFTTransfer.findMany({
      where: {
        nft: {
          contractAddress: contractAddress.toLowerCase(),
          tokenId: tokenId,
        }
      }
    });
    
    console.log(`📦 Found ${transfers.length} transfers`);
  }
}

main()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
