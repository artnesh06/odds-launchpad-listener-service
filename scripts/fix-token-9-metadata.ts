/**
 * Fix metadata for token #9 by fetching from collection metadata
 */

import { PrismaClient } from '@prisma/client';
import { convertIpfsToHttp, convertIpfsToIpfsIo } from '../src/utils/ipfs-helpers';

const prisma = new PrismaClient();

async function main() {
  const contractAddress = '0xbce4ef852f05bb42e6c66f4c0006d370b777aae5';
  const tokenId = '9';

  console.log(`🔄 Fixing metadata for token #${tokenId}...`);

  // Get launchpad
  const launchpad = await prisma.launchpad.findUnique({
    where: { contractAddress: contractAddress.toLowerCase() }
  });

  if (!launchpad) {
    console.error('❌ Launchpad not found');
    return;
  }

  console.log(`✅ Found launchpad: ${launchpad.name}`);
  console.log(`📦 ContractURI: ${launchpad.contractURI}`);

  // Fetch collection metadata
  let contractMetadataUrl = launchpad.contractURI || '';
  if (contractMetadataUrl.startsWith('ipfs://')) {
    contractMetadataUrl = convertIpfsToIpfsIo(contractMetadataUrl);
  }

  console.log(`🌐 Fetching from: ${contractMetadataUrl}`);

  const response = await fetch(contractMetadataUrl);
  if (!response.ok) {
    console.error(`❌ Failed to fetch: ${response.status}`);
    return;
  }

  const collectionMetadata: any = await response.json();
  console.log(`✅ Collection metadata:`, {
    name: collectionMetadata.name,
    description: collectionMetadata.description,
    image: collectionMetadata.image
  });

  // Generate token metadata
  const tokenName = `${collectionMetadata.name} #${tokenId}`;
  let imageUrl = collectionMetadata.image;
  if (imageUrl && imageUrl.startsWith('ipfs://')) {
    imageUrl = convertIpfsToIpfsIo(imageUrl);
  }

  console.log(`📝 Generated metadata:`, {
    name: tokenName,
    image: imageUrl
  });

  // Update NFT in database
  const updated = await prisma.nFT.updateMany({
    where: {
      contractAddress: contractAddress.toLowerCase(),
      tokenId: tokenId
    },
    data: {
      name: tokenName,
      description: collectionMetadata.description || launchpad.description,
      imageCachedUrl: imageUrl,
      imageThumbnailUrl: imageUrl,
      imagePngUrl: imageUrl,
      imageOriginalUrl: collectionMetadata.image,
      imageContentType: imageUrl?.endsWith('.png') ? 'image/png' : 'image/jpeg',
      rawMetadata: collectionMetadata as any
    }
  });

  console.log(`✅ Updated ${updated.count} NFT record(s)`);
}

main()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
