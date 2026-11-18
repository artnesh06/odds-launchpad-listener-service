/**
 * Marketplace Contract Registry
 * 
 * Configuration for marketplace contract addresses per chain.
 * Supports multiple marketplace versions.
 * 
 * Requirements: 4.5, 8.1, 13.5
 */

import { Marketplace } from '@prisma/client';

export interface MarketplaceContractConfig {
  marketplace: Marketplace;
  version: string;
  address: string;
  startBlock?: number; // Optional: block number when contract was deployed
}

export interface ChainMarketplaceConfig {
  chainId: number;
  chainName: string;
  contracts: MarketplaceContractConfig[];
}

/**
 * Marketplace contract addresses by chain
 * 
 * Note: These are the primary marketplace contracts for each platform.
 * Some marketplaces may have multiple contract versions or proxy contracts.
 */
export const MARKETPLACE_CONTRACTS: ChainMarketplaceConfig[] = [
  // Ethereum Mainnet (chainId: 1)
  {
    chainId: 1,
    chainName: 'Ethereum Mainnet',
    contracts: [
      // OpenSea Seaport
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.5',
        address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
        startBlock: 17473923
      },
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.4',
        address: '0x00000000000001ad428e4906aE43D8F9852d0dD6',
        startBlock: 16946467
      },
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.1',
        address: '0x00000000006c3852cbEf3e08E8dF289169EdE581',
        startBlock: 14946474
      },
      // Blur
      {
        marketplace: Marketplace.BLUR,
        version: '1.0',
        address: '0x000000000000Ad05Ccc4F10045630fb830B95127',
        startBlock: 16589900
      },
      // LooksRare
      {
        marketplace: Marketplace.LOOKSRARE,
        version: '2.0',
        address: '0x0000000000E655fAe4d56241588680F86E3b2377',
        startBlock: 16566707
      },
      {
        marketplace: Marketplace.LOOKSRARE,
        version: '1.0',
        address: '0x59728544B08AB483533076417FbBB2fD0B17CE3a',
        startBlock: 13991436
      },
      // X2Y2
      {
        marketplace: Marketplace.X2Y2,
        version: '1.0',
        address: '0x74312363e45DCaBA76c59ec49a7Aa8A65a67EeD3',
        startBlock: 14120913
      },
      // Rarible
      {
        marketplace: Marketplace.RARIBLE,
        version: '2.0',
        address: '0x9757F2d2b135150BBeb65308D4a91804107cd8D6',
        startBlock: 11571614
      }
    ]
  },
  // Polygon (chainId: 137)
  {
    chainId: 137,
    chainName: 'Polygon',
    contracts: [
      // OpenSea Seaport
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.5',
        address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
        startBlock: 43600000
      },
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.1',
        address: '0x00000000006c3852cbEf3e08E8dF289169EdE581',
        startBlock: 28600000
      },
      // Magic Eden
      {
        marketplace: Marketplace.MAGIC_EDEN,
        version: '1.0',
        address: '0x0000000000E655fAe4d56241588680F86E3b2377',
        startBlock: 40000000
      }
    ]
  },
  // BSC (chainId: 56)
  {
    chainId: 56,
    chainName: 'BNB Smart Chain',
    contracts: [
      // OpenSea Seaport
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.5',
        address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
        startBlock: 28000000
      }
    ]
  },
  // Arbitrum (chainId: 42161)
  {
    chainId: 42161,
    chainName: 'Arbitrum One',
    contracts: [
      // OpenSea Seaport
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.5',
        address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
        startBlock: 100000000
      },
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.1',
        address: '0x00000000006c3852cbEf3e08E8dF289169EdE581',
        startBlock: 10000000
      }
    ]
  },
  // Optimism (chainId: 10)
  {
    chainId: 10,
    chainName: 'Optimism',
    contracts: [
      // OpenSea Seaport
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.5',
        address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
        startBlock: 100000000
      },
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.1',
        address: '0x00000000006c3852cbEf3e08E8dF289169EdE581',
        startBlock: 10000000
      }
    ]
  },
  // Base (chainId: 8453)
  {
    chainId: 8453,
    chainName: 'Base',
    contracts: [
      // OpenSea Seaport
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.5',
        address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
        startBlock: 1000000
      },
      // Magic Eden
      {
        marketplace: Marketplace.MAGIC_EDEN,
        version: '1.0',
        address: '0x0000000000E655fAe4d56241588680F86E3b2377',
        startBlock: 2000000
      }
    ]
  },
  // Avalanche (chainId: 43114)
  {
    chainId: 43114,
    chainName: 'Avalanche C-Chain',
    contracts: [
      // OpenSea Seaport
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.5',
        address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
        startBlock: 30000000
      }
    ]
  },
  // Sepolia Testnet (chainId: 11155111)
  {
    chainId: 11155111,
    chainName: 'Sepolia',
    contracts: [
      // OpenSea Seaport
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.5',
        address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
        startBlock: 3000000
      }
    ]
  },
  // Mumbai Testnet (chainId: 80001)
  {
    chainId: 80001,
    chainName: 'Mumbai',
    contracts: [
      // OpenSea Seaport
      {
        marketplace: Marketplace.SEAPORT,
        version: '1.5',
        address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
        startBlock: 30000000
      }
    ]
  }
];

/**
 * Get marketplace contracts for a specific chain
 */
export function getMarketplaceContractsForChain(chainId: number): MarketplaceContractConfig[] {
  const chainConfig = MARKETPLACE_CONTRACTS.find(c => c.chainId === chainId);
  return chainConfig?.contracts || [];
}

/**
 * Get all contract addresses for a specific marketplace across all chains
 */
export function getContractAddressesForMarketplace(marketplace: Marketplace): Map<number, string[]> {
  const result = new Map<number, string[]>();
  
  for (const chainConfig of MARKETPLACE_CONTRACTS) {
    const addresses = chainConfig.contracts
      .filter(c => c.marketplace === marketplace)
      .map(c => c.address.toLowerCase());
    
    if (addresses.length > 0) {
      result.set(chainConfig.chainId, addresses);
    }
  }
  
  return result;
}

/**
 * Get marketplace contract config by address and chain
 */
export function getMarketplaceByAddress(
  chainId: number,
  address: string
): MarketplaceContractConfig | undefined {
  const chainConfig = MARKETPLACE_CONTRACTS.find(c => c.chainId === chainId);
  if (!chainConfig) {
    return undefined;
  }
  
  const normalizedAddress = address.toLowerCase();
  return chainConfig.contracts.find(c => c.address.toLowerCase() === normalizedAddress);
}

/**
 * Check if an address is a known marketplace contract
 */
export function isMarketplaceContract(chainId: number, address: string): boolean {
  return getMarketplaceByAddress(chainId, address) !== undefined;
}

/**
 * Get all supported marketplaces for a chain
 */
export function getSupportedMarketplaces(chainId: number): Marketplace[] {
  const chainConfig = MARKETPLACE_CONTRACTS.find(c => c.chainId === chainId);
  if (!chainConfig) {
    return [];
  }
  
  // Get unique marketplaces
  const marketplaces = new Set(chainConfig.contracts.map(c => c.marketplace));
  return Array.from(marketplaces);
}

/**
 * Get all chains that support a specific marketplace
 */
export function getChainsForMarketplace(marketplace: Marketplace): number[] {
  const chains = new Set<number>();
  
  for (const chainConfig of MARKETPLACE_CONTRACTS) {
    const hasMarketplace = chainConfig.contracts.some(c => c.marketplace === marketplace);
    if (hasMarketplace) {
      chains.add(chainConfig.chainId);
    }
  }
  
  return Array.from(chains);
}
