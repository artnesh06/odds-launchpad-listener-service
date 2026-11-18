/**
 * Event Type Definitions for OddsLaunchpad Contract Events
 * 
 * This file contains all TypeScript interfaces for contract events
 * organized by phase and category.
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface EventConfig {
  eventName: string;
  enabled: boolean;
  priority: 'high' | 'medium' | 'low';
  phase: 1 | 2 | 3 | 4;
}

export interface ActivityListenerConfig {
  chainId: number;
  rpcUrl: string;
  rpcUrls?: string[]; // Optional: Multiple RPC URLs for failover (comma-separated in DB)
  factoryAddress: string;
  launchpadAddresses?: string[];
  enabledEvents?: string[]; // Optional: Allow selective event enabling
  errorThreshold?: number; // Number of errors before alerting (default: 10)
  retryAttempts?: number; // Database retry attempts (default: 3)
}

// ============================================================================
// Error Handling Types
// ============================================================================

export interface ErrorCounter {
  eventType: string;
  count: number;
  lastError: Date;
  threshold: number;
}

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ErrorLogData {
  eventType: string;
  eventData: any;
  error: any;
  severity: ErrorSeverity;
  timestamp: Date;
  chainId: number;
  txHash?: string;
  blockNumber?: number;
}

// ============================================================================
// Existing Events (Backward Compatibility)
// ============================================================================

export interface CollectionCreatedEvent {
  launchpadAddress: string;
  creator: string;
  name: string;
  symbol: string;
  totalSupply: bigint;
  timestamp: bigint;
  txHash: string;
  blockNumber: number;
}

export interface MintEvent {
  from: string;
  to: string;
  tokenId: bigint;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  launchpadAddress: string;
}

// ============================================================================
// Phase 1: User-Facing Events
// ============================================================================

export interface BurnedEvent {
  owner: string;
  tokenId: bigint;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface AirdroppedEvent {
  operator: string;
  recipientCount: bigint;
  totalQuantity: bigint;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface PhaseAddedEvent {
  phaseId: bigint;
  name: string;
  startTime: bigint;
  endTime: bigint;
  price: bigint;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface PhaseUpdatedEvent {
  phaseId: bigint;
  name: string;
  startTime: bigint;
  endTime: bigint;
  price: bigint;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface PhaseRemovedEvent {
  phaseId: bigint;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface RevealedEvent {
  baseURI: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

// ============================================================================
// Phase 2: Administrative Events
// ============================================================================

export interface TreasuryUpdatedEvent {
  oldTreasury: string;
  newTreasury: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface WithdrawnEvent {
  recipient: string;
  amount: bigint;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface OwnershipTransferredEvent {
  previousOwner: string;
  newOwner: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface PlatformFeeToggledEvent {
  enabled: boolean;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface PlatformFlatFeeUpdatedEvent {
  newFee: bigint;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface RoyaltyUpdatedEvent {
  recipient: string;
  percentage: bigint;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

// ============================================================================
// Phase 3: Metadata Events
// ============================================================================

export interface BaseURIUpdatedEvent {
  newBaseURI: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface ContractURIUpdatedEvent {
  newContractURI: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface ExternalLinkUpdatedEvent {
  newExternalLink: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

// ============================================================================
// Phase 4: Security Events
// ============================================================================

export interface PausedEvent {
  account: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface UnpausedEvent {
  account: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface TransferLockUpdatedEvent {
  enabled: boolean;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface RoleGrantedEvent {
  role: string;
  account: string;
  sender: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

export interface RoleRevokedEvent {
  role: string;
  account: string;
  sender: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}
