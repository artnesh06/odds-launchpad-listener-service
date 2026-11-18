/**
 * Type definitions for Activity Listener
 * Centralized type definitions to improve maintainability
 */

import { ActivityType } from '@prisma/client';

export interface EventConfig {
  eventName: string;
  enabled: boolean;
  priority: 'high' | 'medium' | 'low';
  phase: 1 | 2 | 3 | 4;
}

export interface ActivityListenerConfig {
  chainId: number;
  rpcUrl: string;
  factoryAddress: string;
  launchpadAddresses?: string[];
  enabledEvents?: string[];
  errorThreshold?: number;
  retryAttempts?: number;
}

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

// Event interfaces
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

export interface ContractDeployedEvent {
  contractAddress: string;
  template: string;
  deployer: string;
  nonce: bigint;
  txHash: string;
  blockNumber: number;
}

export interface MintEvent {
  from: string;
  to: string;
  tokenId: bigint;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
  logIndex?: number; // Optional for backward compatibility
}

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

export interface RevealedEvent {
  baseURI: string;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}

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
