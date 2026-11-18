import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const launchpad = await prisma.launchpad.findUnique({
    where: { contractAddress: '0xbce4ef852f05bb42e6c66f4c0006d370b777aae5' }
  });
  
  console.log('ManifestHash:', launchpad?.manifestHash);
  console.log('BaseURI:', launchpad?.baseURI);
  console.log('Description:', launchpad?.description);
}

main().finally(() => prisma.$disconnect());
