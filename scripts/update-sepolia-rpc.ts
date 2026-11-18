/**
 * Update Sepolia RPC URL in database
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Updating Sepolia RPC URL...');

  const result = await prisma.chain.update({
    where: {
      chainId: 11155111
    },
    data: {
      rpcUrl: 'wss://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY'
    }
  });

  console.log('✅ Updated Sepolia RPC URL:', result.rpcUrl);
}

main()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
