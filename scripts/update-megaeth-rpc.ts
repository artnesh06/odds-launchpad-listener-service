/**
 * Update MegaETH RPC URL in database
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Updating MegaETH RPC URL...');

  const result = await prisma.chain.update({
    where: {
      chainId: 6343
    },
    data: {
      rpcUrl: 'wss://megaeth-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY'
    }
  });

  console.log('✅ Updated MegaETH RPC URL:', result.rpcUrl);
}

main()
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
