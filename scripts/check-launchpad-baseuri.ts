/**
 * Check launchpad baseURI configuration
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const contractAddress = '0xbce4ef852f05bb42e6c66f4c0006d370b777aae5';

  console.log(`🔍 Checking launchpad for ${contractAddress}...`);

  const launchpad = await prisma.launchpad.findUnique({
    where: {
      contractAddress: contractAddress.toLowerCase()
    }
  });

  if (launchpad) {
    console.log('✅ Launchpad found:');
    console.log('Name:', launchpad.name);
    console.log('Symbol:', launchpad.symbol);
    console.log('BaseURI:', launchpad.baseURI);
    console.log('UnrevealedURI:', launchpad.unrevealedURI);
    console.log('ContractURI:', launchpad.contractURI);
    console.log('Description:', launchpad.description);
  } else {
    console.log('❌ Launchpad not found');
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
