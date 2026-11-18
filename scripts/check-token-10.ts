/**
 * Check if token #10 exists in database
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const contractAddress = '0xbce4ef852f05bb42e6c66f4c0006d370b777aae5';
  const tokenId = '10';

  console.log(`🔍 Checking for token #${tokenId}...`);

  const nft = await prisma.nFT.findFirst({
    where: {
      contractAddress: contractAddress.toLowerCase(),
      tokenId: tokenId,
    }
  });

  if (nft) {
    console.log('✅ NFT found in database:');
    console.log('Name:', nft.name);
    console.log('Description:', nft.description);
    console.log('TokenURI:', nft.tokenUri);
    console.log('Image (cached):', nft.imageCachedUrl);
    console.log('Image (original):', nft.imageOriginalUrl);
    console.log('Raw Metadata:', JSON.stringify(nft.rawMetadata, null, 2));
  } else {
    console.log('❌ NFT not found in database');
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
