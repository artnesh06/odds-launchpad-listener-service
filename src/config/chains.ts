import { prisma } from './database';

export interface ChainConfig {
  id: number;
  name: string;
  network: string;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  launchpadFactoryAddress?: string;
  oddsTemplateAddress?: string; // OddsLaunchpad template address for OddsLaunchpadFactory
  isTestnet: boolean;
  icon: string;
  blockTime?: number; // Average block time in seconds
}

// Helper to normalize addresses to lowercase
const normalizeAddress = (address: string): string => address.toLowerCase();

// Static chain metadata (everything except rpcUrl which comes from database)
const CHAIN_METADATA: Record<number, Omit<ChainConfig, 'rpcUrl'>> = {
  4326: {
    id: 4326,
    name: "MegaETH",
    network: "megaeth",
    blockExplorer: "https://mega.etherscan.io",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    launchpadFactoryAddress: "0x779E3426cCF433746c686caFf67e33B92A9b8B2c", // ✅ CORRECT FACTORY
    oddsTemplateAddress: "0xFDFeB928C2379444154250C22e6eE0c8d53e0DC1", // OddsLaunchpad Template
    isTestnet: false,
    icon: "/images/Chain/MegaETH.webp",
    blockTime: 1 // MegaETH has very fast blocks (~1 second)
  },
  6343: {
    id: 6343,
    name: "MegaETH Testnet V2",
    network: "megaeth-testnet-v2",
    blockExplorer: "https://megaeth-testnet-v2.blockscout.com",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    launchpadFactoryAddress: normalizeAddress("0x89C05c6d454742DdE267c3C01dF1CD69Fd0F64B0"), // 🎉 NEW FACTORY - Nov 24, 2025 - Verified on Blockscout
    oddsTemplateAddress: normalizeAddress("0x8214c3755126f11Ad093BD491C3d3974A7244415"), // OddsLaunchpad Template (approved ✅)
    isTestnet: true,
    icon: "/images/Chain/MegaETH.webp",
    blockTime: 1 // MegaETH has very fast blocks (~1 second)
  },
  11155111: {
    id: 11155111,
    name: "Sepolia",
    network: "sepolia",
    blockExplorer: "https://sepolia.etherscan.io",
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "ETH",
      decimals: 18,
    },
    launchpadFactoryAddress: normalizeAddress("0xB759B92CB8493342ABD53103E2Db5cd20E549975"), // OddsLaunchpadFactory - Nov 18, 2025
    oddsTemplateAddress: normalizeAddress("0x8214c3755126f11Ad093BD491C3d3974A7244415"), // OddsLaunchpad Template - Nov 18, 2025
    isTestnet: true,
    icon: "/images/Chain/Sepolia.webp",
    blockTime: 12 // Ethereum Sepolia ~12 seconds per block
  },
  10143: {
    id: 10143,
    name: "Monad Testnet",
    network: "monad-testnet",
    blockExplorer: "https://explorer.testnet.monad.xyz",
    nativeCurrency: {
      name: "Monad",
      symbol: "MON",
      decimals: 18,
    },
    launchpadFactoryAddress: normalizeAddress("0x292d4516a315B3DD53537F1532EAAaA26194aBA6"), // OddsLaunchpadFactory - Nov 19, 2025
    oddsTemplateAddress: normalizeAddress("0x8214c3755126f11Ad093BD491C3d3974A7244415"), // OddsLaunchpad Template (same as Sepolia)
    isTestnet: true,
    icon: "/images/Chain/Monad.png",
    blockTime: 1 // Monad has very fast blocks (~1 second)
  },
};

// In-memory cache for RPC URLs from database
// This is populated at startup and refreshed periodically
let rpcUrlCache: Record<number, string> = {};
let cacheInitialized = false;

/**
 * Initialize RPC URL cache from database
 * Called at application startup
 */
export async function initializeChainConfigCache(): Promise<void> {
  try {
    console.log('🔄 Initializing chain config cache from database...');
    
    const chains = await prisma.chain.findMany({
      select: {
        chainId: true,
        rpcUrl: true
      }
    });

    for (const chain of chains) {
      if (chain.rpcUrl) {
        rpcUrlCache[chain.chainId] = chain.rpcUrl;
      }
    }

    cacheInitialized = true;
    console.log(`✅ Chain config cache initialized with ${chains.length} chains`);
    console.log(`   Cached RPC URLs for chains: ${Object.keys(rpcUrlCache).join(', ')}`);
  } catch (error) {
    console.error('❌ Error initializing chain config cache:', error);
    console.warn('⚠️ Will use environment variable fallbacks');
  }
}

/**
 * Refresh RPC URL cache from database
 * Can be called periodically or when RPC URLs are updated
 */
export async function refreshChainConfigCache(): Promise<void> {
  await initializeChainConfigCache();
}

/**
 * Get chain configuration (synchronous, uses cache)
 * RPC URLs are loaded from database cache (initialized at startup)
 * Falls back to environment variables if cache is not initialized
 */
export function getChainConfig(chainId: number): ChainConfig | null {
  const metadata = CHAIN_METADATA[chainId];
  if (!metadata) {
    return null;
  }

  // Try to get RPC URL from cache first
  let rpcUrl = rpcUrlCache[chainId];

  // Fallback to environment variables if not in cache
  if (!rpcUrl) {
    if (cacheInitialized) {
      console.warn(`⚠️ RPC URL not found in cache for chain ${chainId}, using environment variable fallback`);
    }
    rpcUrl = getFallbackRpcUrl(chainId);
  }

  return {
    ...metadata,
    rpcUrl
  };
}

/**
 * Fallback RPC URLs from environment variables
 * Only used if database cache is not available
 */
function getFallbackRpcUrl(chainId: number): string {
  // RPC URLs (and any API keys inside them) must come from the environment,
  // never from source code. RPC_URLS_<chainId> accepts a comma-separated list.
  const legacy: Record<number, string | undefined> = {
    4326: process.env.MEGAETH_MAINNET_RPC_URL,
    6343: process.env.MEGAETH_RPC_URL,
    11155111: process.env.SEPOLIA_RPC_URL,
    10143: process.env.MONAD_RPC_URL,
  };
  return process.env[`RPC_URLS_${chainId}`] || legacy[chainId] || (chainId === 4326 ? "https://mainnet.megaeth.com/rpc" : "");
}

/**
 * Get synchronous chain config (without RPC URL from database)
 * Use this only for static metadata, not for blockchain connections
 */
export const getChainConfigSync = (chainId: number): Omit<ChainConfig, 'rpcUrl'> | null => {
  return CHAIN_METADATA[chainId] || null;
};

export const getSupportedChainIds = (): number[] => {
  return Object.keys(CHAIN_METADATA).map(Number);
};

export const isChainSupported = (chainId: number): boolean => {
  return chainId in CHAIN_METADATA;
};

export const getDefaultChain = (): ChainConfig => {
  const config = getChainConfig(4326); // MegaETH mainnet as default
  if (!config) {
    throw new Error('Default chain (MegaETH) not configured');
  }
  return config;
};

export const getChainName = (chainId: number): string => {
  const chain = CHAIN_METADATA[chainId];
  if (chain) {
    return chain.name;
  }
  console.warn(`Unknown chainId: ${chainId}. Using fallback.`);
  return `Unknown Chain (${chainId})`;
};