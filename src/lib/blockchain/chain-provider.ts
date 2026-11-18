/**
 * One shared FailoverJsonRpcProvider per chain.
 *
 * Every component that reads the chain (poller, NFT sync, phase lookups,
 * admin validation, ...) uses this provider, so they all get RPC failover and
 * the endpoint health state is shared instead of each opening its own
 * single-URL provider.
 */

import { FailoverJsonRpcProvider } from './failover-provider';
import { getChainConfig } from '../../config/chains';

const providers = new Map<number, FailoverJsonRpcProvider>();

/**
 * @param rpcUrls optional comma-separated list (used the first time a chain's provider is created)
 */
export function getChainProvider(chainId: number, rpcUrls?: string | string[]): FailoverJsonRpcProvider {
  const existing = providers.get(chainId);
  if (existing) return existing;

  const list = Array.isArray(rpcUrls)
    ? rpcUrls
    : (rpcUrls || getChainConfig(chainId)?.rpcUrl || '').split(',');

  const provider = new FailoverJsonRpcProvider(list, chainId, {
    requestTimeoutMs: parseInt(process.env.RPC_TIMEOUT_MS || '15000', 10),
    maxLagBlocks: parseInt(process.env.RPC_MAX_LAG_BLOCKS || '30', 10),
  });
  providers.set(chainId, provider);
  return provider;
}
