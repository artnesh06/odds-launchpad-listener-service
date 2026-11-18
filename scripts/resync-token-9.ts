/**
 * Re-sync metadata for token #9
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const contractAddress = '0xbce4ef852f05bb42e6c66f4c0006d370b777aae5';
  const tokenId = '9';

  console.log(`🔄 Deleting token #${tokenId} to trigger re-sync...`);

  // Delete NFT to trigger re-sync
  const deleted = await prisma.nFT.deleteMany({
    where: {
      contractAddress: contractAddress.toLowerCase(),
      tokenId: tokenId,
    }
  });

  console.log(`✅ Deleted ${deleted.count} NFT record(s)`);
  console.log(`💡 Service will re-sync this token on next mint event or manual trigger`);
}

main()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
