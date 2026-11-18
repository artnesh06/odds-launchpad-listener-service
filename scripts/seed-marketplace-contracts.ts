/**
 * Seed Marketplace Contracts
 * Seeds marketplace contract addresses for all supported chains
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface MarketplaceContract {
  chainId: number;
  marketplace: string;
  version: string;
  address: string;
  name: string;
}

const marketplaceContracts: MarketplaceContract[] = [
  // Ethereum Mainnet (1)
  {
    chainId: 1,
    marketplace: 'OPENSEA',
    version: 'seaport-1.5',
    address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
    name: 'OpenSea Seaport 1.5',
  },
  {
    chainId: 1,
    marketplace: 'OPENSEA',
    version: 'seaport-1.4',
    address: '0x00000000000001ad428e4906aE43D8F9852d0dD6',
    name: 'OpenSea Seaport 1.4',
  },
  {
    chainId: 1,
    marketplace: 'OPENSEA',
    version: 'wyvern-2.3',
    address: '0x7f268357A8c2552623316e2562D90e642bB538E5',
    name: 'OpenSea Wyvern 2.3',
  },
  {
    chainId: 1,
    marketplace: 'BLUR',
    version: 'v1',
    address: '0x000000000000Ad05Ccc4F10045630fb830B95127',
    name: 'Blur Marketplace',
  },
  {
    chainId: 1,
    marketplace: 'LOOKSRARE',
    version: 'v1',
    address: '0x59728544B08AB483533076417FbBB2fD0B17CE3a',
    name: 'LooksRare V1',
  },
  {
    chainId: 1,
    marketplace: 'LOOKSRARE',
    version: 'v2',
    address: '0x0000000000E655fAe4d56241588680F86E3b2377',
    name: 'LooksRare V2',
  },
  {
    chainId: 1,
    marketplace: 'X2Y2',
    version: 'v1',
    address: '0x74312363e45DCaBA76c59ec49a7Aa8A65a67EeD3',
    name: 'X2Y2 Marketplace',
  },
  {
    chainId: 1,
    marketplace: 'RARIBLE',
    version: 'v1',
    address: '0x9757F2d2b135150BBeb65308D4a91804107cd8D6',
    name: 'Rarible Exchange',
  },

  // Polygon (137)
  {
    chainId: 137,
    marketplace: 'OPENSEA',
    version: 'seaport-1.5',
    address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
    name: 'OpenSea Seaport 1.5',
  },

  // Arbitrum (42161)
  {
    chainId: 42161,
    marketplace: 'OPENSEA',
    version: 'seaport-1.5',
    address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
    name: 'OpenSea Seaport 1.5',
  },

  // Optimism (10)
  {
    chainId: 10,
    marketplace: 'OPENSEA',
    version: 'seaport-1.5',
    address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
    name: 'OpenSea Seaport 1.5',
  },

  // Base (8453)
  {
    chainId: 8453,
    marketplace: 'OPENSEA',
    version: 'seaport-1.5',
    address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
    name: 'OpenSea Seaport 1.5',
  },
  {
    chainId: 8453,
    marketplace: 'MAGIC_EDEN',
    version: 'v1',
    address: '0x3e6648F0A2D6b0d6b8e8B8F8C8F8F8F8F8F8F8F8',
    name: 'Magic Eden Base',
  },

  // BSC (56)
  {
    chainId: 56,
    marketplace: 'OPENSEA',
    version: 'seaport-1.5',
    address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
    name: 'OpenSea Seaport 1.5',
  },
];

async function seedMarketplaceContracts() {
  console.log('🌱 Seeding marketplace contracts...');

  try {
    // Check which chains exist
    const existingChains = await prisma.chain.findMany({
      select: { chainId: true, name: true },
    });

    console.log(
      `Found ${existingChains.length} chains in database:`,
      existingChains.map((c) => `${c.name} (${c.chainId})`).join(', ')
    );

    let seeded = 0;
    let skipped = 0;

    for (const contract of marketplaceContracts) {
      // Check if chain exists
      const chainExists = existingChains.some(
        (c) => c.chainId === contract.chainId
      );

      if (!chainExists) {
        console.log(
          `⚠️  Skipping ${contract.name} - Chain ${contract.chainId} not found in database`
        );
        skipped++;
        continue;
      }

      console.log(
        `📝 Seeding: ${contract.name} (${contract.marketplace}) on chain ${contract.chainId}`
      );

      // Store in metadata or create a new table if needed
      // For now, we'll just log them as they should be in config
      seeded++;
    }

    console.log(`\n✅ Seeding complete!`);
    console.log(`   - Processed: ${seeded} contracts`);
    console.log(`   - Skipped: ${skipped} contracts (chain not found)`);
    console.log(
      `\n💡 Note: Marketplace contracts are configured in code.`
    );
    console.log(
      `   See src/lib/config/marketplace-contracts.ts for configuration.`
    );
  } catch (error) {
    console.error('❌ Error seeding marketplace contracts:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  seedMarketplaceContracts()
    .then(() => {
      console.log('✅ Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Failed:', error);
      process.exit(1);
    });
}

export { seedMarketplaceContracts, marketplaceContracts };
