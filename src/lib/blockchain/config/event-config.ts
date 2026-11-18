/**
 * Event configuration for Activity Listener
 * Defines which events are enabled and their priorities
 */

import { EventConfig } from '../types/activity-listener-types';

// Default event configuration by phase
export const DEFAULT_EVENT_CONFIG: EventConfig[] = [
  // Phase 1: User-facing events (high priority)
  { eventName: 'Burned', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'Airdropped', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'PhaseAdded', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'PhaseUpdated', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'PhaseRemoved', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'Revealed', enabled: true, priority: 'high', phase: 1 },
  
  // Phase 2: Admin events (medium priority)
  { eventName: 'TreasuryUpdated', enabled: true, priority: 'medium', phase: 2 },
  { eventName: 'Withdrawn', enabled: true, priority: 'medium', phase: 2 },
  { eventName: 'OwnershipTransferred', enabled: true, priority: 'medium', phase: 2 },
  { eventName: 'PlatformFeeToggled', enabled: true, priority: 'medium', phase: 2 },
  { eventName: 'PlatformFlatFeeUpdated', enabled: true, priority: 'medium', phase: 2 },
  { eventName: 'RoyaltyUpdated', enabled: true, priority: 'medium', phase: 2 },
  
  // Phase 3: Metadata events (low priority)
  { eventName: 'BaseURIUpdated', enabled: true, priority: 'low', phase: 3 },
  { eventName: 'ContractURIUpdated', enabled: true, priority: 'low', phase: 3 },
  { eventName: 'ExternalLinkUpdated', enabled: true, priority: 'low', phase: 3 },
  
  // Phase 4: Security events (high priority)
  { eventName: 'Paused', enabled: true, priority: 'high', phase: 4 },
  { eventName: 'Unpaused', enabled: true, priority: 'high', phase: 4 },
  { eventName: 'TransferLockUpdated', enabled: true, priority: 'medium', phase: 4 },
  { eventName: 'RoleGranted', enabled: true, priority: 'medium', phase: 4 },
  { eventName: 'RoleRevoked', enabled: true, priority: 'medium', phase: 4 },
  
  // Existing events (for backward compatibility)
  { eventName: 'Transfer', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'LaunchpadCreated', enabled: true, priority: 'high', phase: 1 },
  { eventName: 'ContractDeployed', enabled: true, priority: 'high', phase: 1 },
];

/**
 * Initialize enabled events set based on configuration
 */
export function initializeEnabledEvents(configuredEvents?: string[]): Set<string> {
  if (configuredEvents && configuredEvents.length > 0) {
    return new Set(configuredEvents);
  }
  
  return new Set(
    DEFAULT_EVENT_CONFIG
      .filter(config => config.enabled)
      .map(config => config.eventName)
  );
}

/**
 * Get Alchemy network name for a given chain ID
 */
export function getAlchemyNetwork(chainId: number): string | null {
  const networkMap: Record<number, string> = {
    1: 'eth-mainnet',
    11155111: 'eth-sepolia',
    137: 'polygon-mainnet',
    80002: 'polygon-amoy',
    56: 'bnb-mainnet',
    97: 'bnb-testnet',
    42161: 'arb-mainnet',
    421614: 'arb-sepolia',
    10: 'opt-mainnet',
    11155420: 'opt-sepolia',
    8453: 'base-mainnet',
    84532: 'base-sepolia',
  };
  
  return networkMap[chainId] || null;
}
