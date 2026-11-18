/**
 * WebSocket Configuration Helper
 * 
 * Provides utilities for getting WebSocket configuration from database
 * for multi-chain support. Each chain can have its own WebSocket RPC URL.
 */

import { prisma } from './database';
import { blockchainConfig } from './blockchain';

/**
 * Get WebSocket RPC URL for a specific chain from database
 * 
 * @param chainId - Chain ID to get WebSocket URL for
 * @returns WebSocket URL or null if not available
 */
export async function getChainWebSocketUrl(chainId: number): Promise<string | null> {
  try {
    // Get chain from database
    const chain = await prisma.chain.findUnique({
      where: { chainId },
      select: { rpcUrl: true }
    });

    if (!chain || !chain.rpcUrl) {
      console.warn(`[WebSocketConfig] No RPC URL found for chain ${chainId}`);
      return null;
    }

    // Parse multiple RPC URLs (comma-separated)
    const rpcUrls = chain.rpcUrl.split(',').map(url => url.trim()).filter(url => url.length > 0);
    
    if (rpcUrls.length === 0) {
      console.warn(`[WebSocketConfig] No valid RPC URLs found for chain ${chainId}`);
      return null;
    }

    // Get first RPC URL
    const primaryRpcUrl = rpcUrls[0];

    // Check if it's already a WebSocket URL
    if (primaryRpcUrl.startsWith('ws://') || primaryRpcUrl.startsWith('wss://')) {
      console.log(`[WebSocketConfig] Found WebSocket URL for chain ${chainId}: ${primaryRpcUrl.substring(0, 50)}...`);
      return primaryRpcUrl;
    }

    // Try to convert HTTP to WebSocket
    if (primaryRpcUrl.startsWith('https://')) {
      const wsUrl = primaryRpcUrl.replace('https://', 'wss://');
      console.log(`[WebSocketConfig] Converted HTTPS to WSS for chain ${chainId}: ${wsUrl.substring(0, 50)}...`);
      return wsUrl;
    }

    if (primaryRpcUrl.startsWith('http://')) {
      const wsUrl = primaryRpcUrl.replace('http://', 'ws://');
      console.log(`[WebSocketConfig] Converted HTTP to WS for chain ${chainId}: ${wsUrl.substring(0, 50)}...`);
      return wsUrl;
    }

    console.warn(`[WebSocketConfig] Could not convert RPC URL to WebSocket for chain ${chainId}: ${primaryRpcUrl}`);
    return null;
  } catch (error) {
    console.error(`[WebSocketConfig] Error getting WebSocket URL for chain ${chainId}:`, error);
    return null;
  }
}

/**
 * Check if WebSocket is enabled globally and for a specific chain
 * 
 * @param chainId - Chain ID to check
 * @returns true if WebSocket is enabled and available for this chain
 */
export async function isWebSocketEnabledForChain(chainId: number): Promise<boolean> {
  // Check global WebSocket enabled flag
  if (!blockchainConfig.websocket.enabled) {
    return false;
  }

  // Check if chain has WebSocket URL available
  const wsUrl = await getChainWebSocketUrl(chainId);
  return wsUrl !== null;
}

/**
 * Get all chains that support WebSocket
 * 
 * @returns Array of chain IDs that have WebSocket URLs available
 */
export async function getWebSocketEnabledChains(): Promise<number[]> {
  if (!blockchainConfig.websocket.enabled) {
    return [];
  }

  try {
    const chains = await prisma.chain.findMany({
      select: { chainId: true, rpcUrl: true }
    });

    const enabledChains: number[] = [];

    for (const chain of chains) {
      if (!chain.rpcUrl) continue;

      const rpcUrls = chain.rpcUrl.split(',').map(url => url.trim());
      const hasWebSocket = rpcUrls.some(url => 
        url.startsWith('ws://') || 
        url.startsWith('wss://') ||
        url.startsWith('http://') || 
        url.startsWith('https://')
      );

      if (hasWebSocket) {
        enabledChains.push(chain.chainId);
      }
    }

    return enabledChains;
  } catch (error) {
    console.error('[WebSocketConfig] Error getting WebSocket enabled chains:', error);
    return [];
  }
}
