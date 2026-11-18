/**
 * Alchemy API Helpers
 * 
 * Helper functions for Alchemy API integration
 */

import { createAlchemyNFTService } from './alchemy-nft-service';

/**
 * Map chain ID to Alchemy network name
 */
export function getAlchemyNetwork(chainId?: number | string): string {
  if (!chainId) return process.env.ALCHEMY_NETWORK || 'eth-mainnet';
  
  const id = typeof chainId === 'string' ? parseInt(chainId) : chainId;
  
  const networkMap: Record<number, string> = {
    1: 'eth-mainnet',
    11155111: 'eth-sepolia',
    5: 'eth-goerli',
    137: 'polygon-mainnet',
    80002: 'polygon-amoy',
    80001: 'polygon-mumbai',
    8453: 'base-mainnet',
    84532: 'base-sepolia',
    10: 'opt-mainnet',
    420: 'opt-goerli',
    42161: 'arb-mainnet',
    421613: 'arb-goerli',
    6343: 'megaeth-testnet', // MegaETH Testnet V2
    10143: 'monad-testnet', // Monad Testnet (if supported)
  };
  
  return networkMap[id] || process.env.ALCHEMY_NETWORK || 'eth-mainnet';
}

/**
 * Check if chain supports Alchemy NFT API
 * Note: Some chains only have RPC support, not NFT API support
 */
export function supportsAlchemyNFTAPI(chainId?: number | string): boolean {
  if (!chainId) return true;
  
  const id = typeof chainId === 'string' ? parseInt(chainId) : chainId;
  
  // Chains that DON'T support Alchemy NFT API (only RPC)
  // Verified by testing - these chains return "endpoint not enabled" error
  const unsupportedChains = [
    6343,  // MegaETH Testnet V2 - RPC only, NFT API not enabled
    10143, // Monad Testnet - RPC only (assumed)
  ];
  
  return !unsupportedChains.includes(id);
}

/**
 * Create Alchemy service with network support
 */
export function createAlchemyService(chainId?: number | string) {
  if (!process.env.ALCHEMY_API_KEY) {
    throw new Error('Alchemy API key not configured');
  }

  const network = getAlchemyNetwork(chainId);

  return createAlchemyNFTService({
    apiKey: process.env.ALCHEMY_API_KEY,
    network,
  });
}

/**
 * Validate required parameters
 */
export function validateParams(
  params: Record<string, string | null>,
  required: string[]
): string | null {
  for (const key of required) {
    if (!params[key]) {
      return `${key} is required`;
    }
  }
  return null;
}

/**
 * Safe parseInt with default value
 */
export function parseIntSafe(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safe parseFloat with default value
 */
export function parseFloatSafe(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse boolean from string
 */
export function parseBool(value: string | null, defaultValue = false): boolean {
  if (!value) return defaultValue;
  return value === 'true' || value === '1';
}

/**
 * Handle API errors consistently
 */
export function handleApiError(error: unknown, context: string) {
  console.error(`${context} Error:`, error);
  
  const message = error instanceof Error ? error.message : 'Unknown error';
  
  // Check if it's an Alchemy API error
  if (message.includes('Alchemy API Error')) {
    throw new Error(`Failed to ${context.toLowerCase()}: ${message}`);
  }
  
  throw new Error(`Failed to ${context.toLowerCase()}: ${message}`);
}
