/**
 * Activity Event Handler
 * 
 * Handles launchpad administrative and operational events:
 * - Phase management (added, updated, removed, activated, deactivated)
 * - Configuration updates (reveal, treasury, royalty, metadata URI)
 * - Contract state (pause, unpause)
 * - Access control (role granted, role revoked)
 * - Fee updates (platform fee, creation fee)
 * 
 * Requirements: 4.1-4.10, 5.1-5.4, 6.1-6.3, 7.1-7.4, 8.1-8.4, 9.1-9.4, 10.1-10.4, 11.1-11.4
 */

import { BaseEventHandler, HandlerContext } from './base-handler';
import { prisma } from '../../../config/database';
import { ActivityType, PhaseType, LaunchpadStatus } from '@prisma/client';
import { ethers } from 'ethers';

/**
 * Safely convert price string to BigInt
 * Handles both wei format (integer) and ether format (decimal)
 */
function safePriceToBigInt(price: string, context: string = 'price'): bigint {
  try {
    if (price.includes('.')) {
      console.warn(`⚠️ ${context} in decimal format (${price}), converting to wei`);
      return BigInt(ethers.parseEther(price).toString());
    }
    return BigInt(price);
  } catch (error) {
    console.error(`❌ Failed to convert ${context} "${price}" to BigInt:`, error);
    return BigInt(0);
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Phase Management Event Data
 */
export interface PhaseAddedData {
  chainId: number;
  launchpadAddress: string;
  phaseIndex: number;
  name: string;
  phaseType: PhaseType;
  startTime: Date;
  endTime?: Date;
  price: string;
  maxMintPerWallet?: number;
  totalLimit?: number;
  merkleRoot?: string;
  txHash: string;
  blockNumber: number;
}

export interface PhaseUpdatedData extends PhaseAddedData {
  // Same fields as PhaseAddedData
}

export interface PhaseRemovedData {
  chainId: number;
  launchpadAddress: string;
  phaseIndex: number;
  txHash: string;
  blockNumber: number;
}

export interface PhaseActivatedData {
  chainId: number;
  launchpadAddress: string;
  phaseIndex: number;
  txHash: string;
  blockNumber: number;
}

export interface PhaseDeactivatedData extends PhaseActivatedData {
  // Same fields as PhaseActivatedData
}

/**
 * Configuration Event Data
 */
export interface RevealData {
  chainId: number;
  launchpadAddress: string;
  newBaseURI: string;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
}

export interface TreasuryUpdateData {
  chainId: number;
  launchpadAddress: string;
  oldTreasury: string;
  newTreasury: string;
  txHash: string;
  blockNumber: number;
}

export interface RoyaltyUpdateData {
  chainId: number;
  launchpadAddress: string;
  oldRecipient: string;
  newRecipient: string;
  oldPercentage: number;
  newPercentage: number;
  txHash: string;
  blockNumber: number;
}

export interface MetadataUpdateData {
  chainId: number;
  launchpadAddress: string;
  tokenId?: string; // Optional - if null, applies to all tokens
  newURI: string;
  updateType: 'BASE_URI' | 'CONTRACT_URI' | 'TOKEN_URI';
  txHash: string;
  blockNumber: number;
}

/**
 * Contract State Event Data
 */
export interface PauseData {
  chainId: number;
  launchpadAddress: string;
  txHash: string;
  blockNumber: number;
}

export interface UnpauseData extends PauseData {
  // Same fields as PauseData
}

/**
 * Access Control Event Data
 */
export interface RoleGrantedData {
  chainId: number;
  launchpadAddress: string;
  role: string;
  account: string;
  sender: string;
  txHash: string;
  blockNumber: number;
}

export interface RoleRevokedData extends RoleGrantedData {
  // Same fields as RoleGrantedData
}

/**
 * Fee Update Event Data
 */
export interface FeeUpdateData {
  chainId: number;
  factoryAddress: string;
  oldFee: string;
  newFee: string;
  feeType: 'PLATFORM_FEE' | 'CREATION_FEE';
  txHash: string;
  blockNumber: number;
}

// ============================================================================
// Activity Event Handler Class
// ============================================================================

/**
 * Activity Event Handler
 * Processes launchpad administrative and operational events
 */
export class ActivityEventHandler extends BaseEventHandler {
  constructor(context: HandlerContext) {
    super(context);
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Fetch launchpad with validation
   * Returns null if launchpad not found (with warning logged)
   */
  protected async fetchLaunchpadWithValidation(
    contractAddress: string,
    autoSync: boolean = true
  ): Promise<any | null> {
    const launchpad = await this.fetchLaunchpad(contractAddress, autoSync);
    
    if (!launchpad) {
      console.warn(`⚠️ Launchpad not found: ${contractAddress}`);
      return null;
    }

    return launchpad;
  }

  /**
   * Validate phase data
   */
  protected validatePhaseData(phaseData: PhaseAddedData): void {
    this.validateEventData(phaseData, [
      'chainId',
      'launchpadAddress',
      'phaseIndex',
      'name',
      'phaseType',
      'startTime',
      'price',
      'txHash',
      'blockNumber'
    ]);

    // Validate phase index is non-negative
    if (phaseData.phaseIndex < 0) {
      throw new Error(`Invalid phase index: ${phaseData.phaseIndex}`);
    }

    // Validate price is non-negative
    try {
      const price = safePriceToBigInt(phaseData.price, 'phase price');
      if (price < 0n) {
        throw new Error(`Invalid price: ${phaseData.price}`);
      }
    } catch (error) {
      throw new Error(`Invalid price format: ${phaseData.price}`);
    }

    // Validate maxMintPerWallet if provided
    if (phaseData.maxMintPerWallet !== undefined && phaseData.maxMintPerWallet < 0) {
      throw new Error(`Invalid maxMintPerWallet: ${phaseData.maxMintPerWallet}`);
    }

    // Validate totalLimit if provided
    if (phaseData.totalLimit !== undefined && phaseData.totalLimit < 0) {
      throw new Error(`Invalid totalLimit: ${phaseData.totalLimit}`);
    }
  }

  /**
   * Create activity record for phase events
   */
  protected async createPhaseActivity(
    launchpadId: string,
    factoryId: string,
    type: ActivityType,
    actor: string,
    description: string,
    txHash: string,
    blockNumber: number,
    metadata?: any
  ): Promise<void> {
    await this.writeActivityWithRetry({
      chainId: this.context.chainId,
      factoryId,
      launchpadId,
      type,
      actor,
      description,
      txHash,
      blockNumber,
      metadata: metadata || {}
    });
  }

  // ==========================================================================
  // Phase Management Event Handlers
  // ==========================================================================

  /**
   * Handle phase added event
   * Requirements: 4.1, 4.2
   * 
   * Inserts new record into launchpad_phases table and creates activity record
   */
  async handlePhaseAdded(phaseData: PhaseAddedData): Promise<void> {
    try {
      // Validate event data
      this.validatePhaseData(phaseData);

      console.log(
        `📋 Processing phase added: ${phaseData.launchpadAddress} phase ${phaseData.phaseIndex}`
      );

      // Normalize address
      const normalizedAddress = phaseData.launchpadAddress.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        phaseData.txHash,
        ActivityType.PHASE_CREATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate phase added event, skipping: ${phaseData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Check if phase already exists
        const existingPhase = await tx.launchpadPhase.findUnique({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseData.phaseIndex
            }
          }
        });

        if (existingPhase) {
          console.log(
            `⚠️ Phase already exists: ${launchpad.id} phase ${phaseData.phaseIndex}`
          );
          return;
        }

        // Insert new phase record (Requirement 4.1)
        await tx.launchpadPhase.create({
          data: {
            launchpadId: launchpad.id,
            phaseIndex: phaseData.phaseIndex,
            name: phaseData.name,
            phaseType: phaseData.phaseType,
            startTime: phaseData.startTime,
            endTime: phaseData.endTime || null,
            price: phaseData.price,
            maxMintPerWallet: phaseData.maxMintPerWallet || null,
            totalLimit: phaseData.totalLimit || null,
            merkleRoot: phaseData.merkleRoot || null,
            isActive: true,
            mintedCount: 0
          }
        });

        // Create activity record (Requirement 4.2)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.PHASE_CREATED,
            actor: launchpad.creator, // Use launchpad creator as actor
            description: `Phase "${phaseData.name}" (index ${phaseData.phaseIndex}) added`,
            txHash: phaseData.txHash,
            blockNumber: phaseData.blockNumber,
            metadata: {
              phaseIndex: phaseData.phaseIndex,
              phaseName: phaseData.name,
              phaseType: phaseData.phaseType,
              price: phaseData.price,
              maxMintPerWallet: phaseData.maxMintPerWallet,
              totalLimit: phaseData.totalLimit
            }
          }
        });
      });

      console.log(
        `✅ Phase added: ${phaseData.name} (index ${phaseData.phaseIndex}) for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handlePhaseAdded', error, phaseData);
      throw error;
    }
  }

  /**
   * Handle phase updated event
   * Requirements: 4.3, 4.4
   * 
   * Updates existing launchpad_phases record and creates activity record
   */
  async handlePhaseUpdated(phaseData: PhaseUpdatedData): Promise<void> {
    try {
      // Validate event data
      this.validatePhaseData(phaseData);

      console.log(
        `📝 Processing phase updated: ${phaseData.launchpadAddress} phase ${phaseData.phaseIndex}`
      );

      // Normalize address
      const normalizedAddress = phaseData.launchpadAddress.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        phaseData.txHash,
        ActivityType.PHASE_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate phase updated event, skipping: ${phaseData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Find existing phase
        const existingPhase = await tx.launchpadPhase.findUnique({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseData.phaseIndex
            }
          }
        });

        if (!existingPhase) {
          console.warn(
            `⚠️ Phase not found for update: ${launchpad.id} phase ${phaseData.phaseIndex}`
          );
          return;
        }

        // Update phase record (Requirement 4.3)
        await tx.launchpadPhase.update({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseData.phaseIndex
            }
          },
          data: {
            name: phaseData.name,
            phaseType: phaseData.phaseType,
            startTime: phaseData.startTime,
            endTime: phaseData.endTime || null,
            price: phaseData.price,
            maxMintPerWallet: phaseData.maxMintPerWallet || null,
            totalLimit: phaseData.totalLimit || null,
            merkleRoot: phaseData.merkleRoot || null
          }
        });

        // Create activity record (Requirement 4.4)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.PHASE_UPDATED,
            actor: launchpad.creator,
            description: `Phase "${phaseData.name}" (index ${phaseData.phaseIndex}) updated`,
            txHash: phaseData.txHash,
            blockNumber: phaseData.blockNumber,
            metadata: {
              phaseIndex: phaseData.phaseIndex,
              phaseName: phaseData.name,
              phaseType: phaseData.phaseType,
              price: phaseData.price,
              maxMintPerWallet: phaseData.maxMintPerWallet,
              totalLimit: phaseData.totalLimit
            }
          }
        });
      });

      console.log(
        `✅ Phase updated: ${phaseData.name} (index ${phaseData.phaseIndex}) for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handlePhaseUpdated', error, phaseData);
      throw error;
    }
  }

  /**
   * Handle phase removed event
   * Requirements: 4.5, 4.6
   * 
   * Deletes or marks inactive the launchpad_phases record and creates activity record
   */
  async handlePhaseRemoved(phaseData: PhaseRemovedData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(phaseData, [
        'chainId',
        'launchpadAddress',
        'phaseIndex',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `🗑️ Processing phase removed: ${phaseData.launchpadAddress} phase ${phaseData.phaseIndex}`
      );

      // Normalize address
      const normalizedAddress = phaseData.launchpadAddress.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        phaseData.txHash,
        ActivityType.PHASE_UPDATED, // Using PHASE_UPDATED for removal
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate phase removed event, skipping: ${phaseData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Find existing phase
        const existingPhase = await tx.launchpadPhase.findUnique({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseData.phaseIndex
            }
          }
        });

        if (!existingPhase) {
          console.warn(
            `⚠️ Phase not found for removal: ${launchpad.id} phase ${phaseData.phaseIndex}`
          );
          return;
        }

        // Mark phase as inactive instead of deleting (Requirement 4.5)
        // This preserves historical data and relationships
        await tx.launchpadPhase.update({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseData.phaseIndex
            }
          },
          data: {
            isActive: false
          }
        });

        // Create activity record (Requirement 4.6)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.PHASE_UPDATED,
            actor: launchpad.creator,
            description: `Phase "${existingPhase.name}" (index ${phaseData.phaseIndex}) removed`,
            txHash: phaseData.txHash,
            blockNumber: phaseData.blockNumber,
            metadata: {
              phaseIndex: phaseData.phaseIndex,
              phaseName: existingPhase.name,
              action: 'removed'
            }
          }
        });
      });

      console.log(
        `✅ Phase removed: phase ${phaseData.phaseIndex} for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handlePhaseRemoved', error, phaseData);
      throw error;
    }
  }

  /**
   * Handle phase activated event
   * Requirements: 4.7, 4.8
   * 
   * Sets isActive to true for the phase and creates activity record
   */
  async handlePhaseActivated(phaseData: PhaseActivatedData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(phaseData, [
        'chainId',
        'launchpadAddress',
        'phaseIndex',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `✅ Processing phase activated: ${phaseData.launchpadAddress} phase ${phaseData.phaseIndex}`
      );

      // Normalize address
      const normalizedAddress = phaseData.launchpadAddress.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        phaseData.txHash,
        ActivityType.PHASE_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate phase activated event, skipping: ${phaseData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Find existing phase
        const existingPhase = await tx.launchpadPhase.findUnique({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseData.phaseIndex
            }
          }
        });

        if (!existingPhase) {
          console.warn(
            `⚠️ Phase not found for activation: ${launchpad.id} phase ${phaseData.phaseIndex}`
          );
          return;
        }

        // Set isActive to true (Requirement 4.7)
        await tx.launchpadPhase.update({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseData.phaseIndex
            }
          },
          data: {
            isActive: true
          }
        });

        // Create activity record (Requirement 4.8)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.PHASE_UPDATED,
            actor: launchpad.creator,
            description: `Phase "${existingPhase.name}" (index ${phaseData.phaseIndex}) activated`,
            txHash: phaseData.txHash,
            blockNumber: phaseData.blockNumber,
            metadata: {
              phaseIndex: phaseData.phaseIndex,
              phaseName: existingPhase.name,
              action: 'activated'
            }
          }
        });
      });

      console.log(
        `✅ Phase activated: phase ${phaseData.phaseIndex} for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handlePhaseActivated', error, phaseData);
      throw error;
    }
  }

  /**
   * Handle phase deactivated event
   * Requirements: 4.9, 4.10
   * 
   * Sets isActive to false for the phase and creates activity record
   */
  async handlePhaseDeactivated(phaseData: PhaseDeactivatedData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(phaseData, [
        'chainId',
        'launchpadAddress',
        'phaseIndex',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `⏸️ Processing phase deactivated: ${phaseData.launchpadAddress} phase ${phaseData.phaseIndex}`
      );

      // Normalize address
      const normalizedAddress = phaseData.launchpadAddress.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        phaseData.txHash,
        ActivityType.PHASE_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate phase deactivated event, skipping: ${phaseData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Find existing phase
        const existingPhase = await tx.launchpadPhase.findUnique({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseData.phaseIndex
            }
          }
        });

        if (!existingPhase) {
          console.warn(
            `⚠️ Phase not found for deactivation: ${launchpad.id} phase ${phaseData.phaseIndex}`
          );
          return;
        }

        // Set isActive to false (Requirement 4.9)
        await tx.launchpadPhase.update({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseData.phaseIndex
            }
          },
          data: {
            isActive: false
          }
        });

        // Create activity record (Requirement 4.10)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.PHASE_UPDATED,
            actor: launchpad.creator,
            description: `Phase "${existingPhase.name}" (index ${phaseData.phaseIndex}) deactivated`,
            txHash: phaseData.txHash,
            blockNumber: phaseData.blockNumber,
            metadata: {
              phaseIndex: phaseData.phaseIndex,
              phaseName: existingPhase.name,
              action: 'deactivated'
            }
          }
        });
      });

      console.log(
        `✅ Phase deactivated: phase ${phaseData.phaseIndex} for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handlePhaseDeactivated', error, phaseData);
      throw error;
    }
  }

  // ==========================================================================
  // Configuration Event Handlers
  // ==========================================================================

  /**
   * Handle reveal event
   * Requirements: 5.1, 5.2, 5.3, 5.4
   * 
   * Updates launchpad baseURI, queues metadata refresh jobs for all minted tokens,
   * updates updatedAt timestamp, and creates activity record
   */
  async handleReveal(revealData: RevealData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(revealData, [
        'chainId',
        'launchpadAddress',
        'newBaseURI',
        'txHash',
        'blockNumber',
        'timestamp'
      ]);

      console.log(
        `🎭 Processing reveal event: ${revealData.launchpadAddress}`
      );

      // Normalize address
      const normalizedAddress = revealData.launchpadAddress.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        revealData.txHash,
        ActivityType.METADATA_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate reveal event, skipping: ${revealData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Update launchpad baseURI and updatedAt (Requirements 5.2, 5.4)
        await tx.launchpad.update({
          where: { id: launchpad.id },
          data: {
            baseURI: revealData.newBaseURI,
            updatedAt: new Date()
          }
        });

        // Create activity record (Requirement 5.1)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.METADATA_UPDATED,
            actor: launchpad.creator,
            description: `Collection revealed with new base URI`,
            txHash: revealData.txHash,
            blockNumber: revealData.blockNumber,
            metadata: {
              oldBaseURI: launchpad.baseURI,
              newBaseURI: revealData.newBaseURI,
              action: 'reveal'
            }
          }
        });
      });

      // Queue metadata refresh jobs for all minted tokens (Requirement 5.3)
      // This is done outside the transaction to avoid blocking
      try {
        const mintedNFTs = await prisma.nFT.findMany({
          where: {
            contractAddress: normalizedAddress,
            chainId: this.context.chainId
          },
          select: {
            tokenId: true
          }
        });

        console.log(
          `📋 Queueing metadata refresh for ${mintedNFTs.length} tokens`
        );

        // Import queue manager dynamically to avoid circular dependencies
        const { getQueueManager } = await import('../../queue/queue-manager');
        const queueManager = getQueueManager();

        // Queue metadata refresh for each minted token
        for (const nft of mintedNFTs) {
          await queueManager.addNFTMetadataJob({
            chainId: this.context.chainId,
            contractAddress: normalizedAddress,
            tokenId: nft.tokenId,
            forceRefresh: true
          });
        }

        console.log(
          `✅ Queued ${mintedNFTs.length} metadata refresh jobs`
        );
      } catch (error) {
        console.error('⚠️ Failed to queue metadata refresh jobs:', error);
        // Don't throw - the reveal was successful, metadata refresh is best-effort
      }

      console.log(
        `✅ Reveal processed for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handleReveal', error, revealData);
      throw error;
    }
  }

  /**
   * Handle treasury update event
   * Requirements: 6.1, 6.2, 6.3
   * 
   * Updates launchpad treasury field, stores old and new treasury addresses
   * in activity metadata, and creates activity record
   */
  async handleTreasuryUpdate(treasuryData: TreasuryUpdateData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(treasuryData, [
        'chainId',
        'launchpadAddress',
        'oldTreasury',
        'newTreasury',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `💰 Processing treasury update: ${treasuryData.launchpadAddress}`
      );

      // Normalize addresses
      const normalizedAddress = treasuryData.launchpadAddress.toLowerCase();
      const normalizedOldTreasury = treasuryData.oldTreasury.toLowerCase();
      const normalizedNewTreasury = treasuryData.newTreasury.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        treasuryData.txHash,
        ActivityType.LAUNCHPAD_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate treasury update event, skipping: ${treasuryData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Update launchpad treasury field (Requirement 6.1)
        await tx.launchpad.update({
          where: { id: launchpad.id },
          data: {
            treasury: normalizedNewTreasury,
            updatedAt: new Date()
          }
        });

        // Create activity record with old and new treasury addresses (Requirements 6.2, 6.3)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.LAUNCHPAD_UPDATED,
            actor: launchpad.creator,
            description: `Treasury updated from ${this.truncateAddress(normalizedOldTreasury)} to ${this.truncateAddress(normalizedNewTreasury)}`,
            txHash: treasuryData.txHash,
            blockNumber: treasuryData.blockNumber,
            metadata: {
              oldTreasury: normalizedOldTreasury,
              newTreasury: normalizedNewTreasury,
              action: 'treasury_update'
            }
          }
        });
      });

      console.log(
        `✅ Treasury updated for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handleTreasuryUpdate', error, treasuryData);
      throw error;
    }
  }

  /**
   * Handle royalty update event
   * Requirements: 7.1, 7.2, 7.3, 7.4
   * 
   * Updates launchpad royaltyRecipient and royaltyPercentage fields,
   * stores old and new royalty settings in activity metadata, and creates activity record
   */
  async handleRoyaltyUpdate(royaltyData: RoyaltyUpdateData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(royaltyData, [
        'chainId',
        'launchpadAddress',
        'oldRecipient',
        'newRecipient',
        'oldPercentage',
        'newPercentage',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `👑 Processing royalty update: ${royaltyData.launchpadAddress}`
      );

      // Normalize addresses
      const normalizedAddress = royaltyData.launchpadAddress.toLowerCase();
      const normalizedOldRecipient = royaltyData.oldRecipient.toLowerCase();
      const normalizedNewRecipient = royaltyData.newRecipient.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        royaltyData.txHash,
        ActivityType.LAUNCHPAD_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate royalty update event, skipping: ${royaltyData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Update launchpad royalty fields (Requirements 7.1, 7.2)
        await tx.launchpad.update({
          where: { id: launchpad.id },
          data: {
            royaltyRecipient: normalizedNewRecipient,
            royaltyPercentage: royaltyData.newPercentage,
            updatedAt: new Date()
          }
        });

        // Create activity record with old and new royalty settings (Requirements 7.3, 7.4)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.LAUNCHPAD_UPDATED,
            actor: launchpad.creator,
            description: `Royalty updated: recipient ${this.truncateAddress(normalizedNewRecipient)}, percentage ${royaltyData.newPercentage}%`,
            txHash: royaltyData.txHash,
            blockNumber: royaltyData.blockNumber,
            metadata: {
              oldRecipient: normalizedOldRecipient,
              newRecipient: normalizedNewRecipient,
              oldPercentage: royaltyData.oldPercentage,
              newPercentage: royaltyData.newPercentage,
              action: 'royalty_update'
            }
          }
        });
      });

      console.log(
        `✅ Royalty updated for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handleRoyaltyUpdate', error, royaltyData);
      throw error;
    }
  }

  /**
   * Handle metadata URI update event
   * Requirements: 8.1, 8.2, 8.3, 8.4
   * 
   * Updates launchpad baseURI or contractURI field based on updateType,
   * queues metadata refresh jobs for affected tokens, handles single token vs all tokens refresh,
   * and creates activity record
   */
  async handleMetadataURIUpdate(metadataData: MetadataUpdateData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(metadataData, [
        'chainId',
        'launchpadAddress',
        'newURI',
        'updateType',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `🔗 Processing metadata URI update: ${metadataData.launchpadAddress} (${metadataData.updateType})`
      );

      // Normalize address
      const normalizedAddress = metadataData.launchpadAddress.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        metadataData.txHash,
        ActivityType.METADATA_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate metadata URI update event, skipping: ${metadataData.txHash}`);
        return;
      }

      // Determine which field to update based on updateType
      let updateData: any = { updatedAt: new Date() };
      let oldValue: string | null = null;

      if (metadataData.updateType === 'BASE_URI') {
        oldValue = launchpad.baseURI;
        updateData.baseURI = metadataData.newURI;
      } else if (metadataData.updateType === 'CONTRACT_URI') {
        oldValue = launchpad.contractURI;
        updateData.contractURI = metadataData.newURI;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Update launchpad URI field (Requirement 8.1)
        await tx.launchpad.update({
          where: { id: launchpad.id },
          data: updateData
        });

        // Create activity record (Requirement 8.2)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.METADATA_UPDATED,
            actor: launchpad.creator,
            description: `${metadataData.updateType} updated${metadataData.tokenId ? ` for token ${metadataData.tokenId}` : ''}`,
            txHash: metadataData.txHash,
            blockNumber: metadataData.blockNumber,
            metadata: {
              updateType: metadataData.updateType,
              oldURI: oldValue,
              newURI: metadataData.newURI,
              tokenId: metadataData.tokenId,
              action: 'metadata_uri_update'
            }
          }
        });
      });

      // Queue metadata refresh jobs for affected tokens (Requirements 8.3, 8.4)
      // This is done outside the transaction to avoid blocking
      try {
        const { getQueueManager } = await import('../../queue/queue-manager');
        const queueManager = getQueueManager();

        if (metadataData.tokenId) {
          // Single token update (Requirement 8.4)
          console.log(
            `📋 Queueing metadata refresh for token ${metadataData.tokenId}`
          );

          await queueManager.addNFTMetadataJob({
            chainId: this.context.chainId,
            contractAddress: normalizedAddress,
            tokenId: metadataData.tokenId,
            forceRefresh: true
          });

          console.log(`✅ Queued metadata refresh for token ${metadataData.tokenId}`);
        } else {
          // All tokens update (Requirement 8.3)
          const mintedNFTs = await prisma.nFT.findMany({
            where: {
              contractAddress: normalizedAddress,
              chainId: this.context.chainId
            },
            select: {
              tokenId: true
            }
          });

          console.log(
            `📋 Queueing metadata refresh for ${mintedNFTs.length} tokens`
          );

          for (const nft of mintedNFTs) {
            await queueManager.addNFTMetadataJob({
              chainId: this.context.chainId,
              contractAddress: normalizedAddress,
              tokenId: nft.tokenId,
              forceRefresh: true
            });
          }

          console.log(
            `✅ Queued ${mintedNFTs.length} metadata refresh jobs`
          );
        }
      } catch (error) {
        console.error('⚠️ Failed to queue metadata refresh jobs:', error);
        // Don't throw - the URI update was successful, metadata refresh is best-effort
      }

      console.log(
        `✅ Metadata URI updated for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handleMetadataURIUpdate', error, metadataData);
      throw error;
    }
  }

  /**
   * Handle paused event
   * Requirements: 9.1, 9.2
   * 
   * Updates launchpad status to PAUSED and creates activity record
   */
  async handlePaused(pauseData: PauseData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(pauseData, [
        'chainId',
        'launchpadAddress',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `⏸️ Processing paused event: ${pauseData.launchpadAddress}`
      );

      // Normalize address
      const normalizedAddress = pauseData.launchpadAddress.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        pauseData.txHash,
        ActivityType.LAUNCHPAD_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate paused event, skipping: ${pauseData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Update launchpad status to PAUSED (Requirement 9.1)
        await tx.launchpad.update({
          where: { id: launchpad.id },
          data: {
            status: LaunchpadStatus.PAUSED,
            updatedAt: new Date()
          }
        });

        // Create activity record (Requirement 9.2)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.LAUNCHPAD_UPDATED,
            actor: launchpad.creator,
            description: `Launchpad paused`,
            txHash: pauseData.txHash,
            blockNumber: pauseData.blockNumber,
            metadata: {
              action: 'paused',
              previousStatus: launchpad.status
            }
          }
        });
      });

      console.log(
        `✅ Launchpad paused: ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handlePaused', error, pauseData);
      throw error;
    }
  }

  /**
   * Handle unpaused event
   * Requirements: 9.3, 9.4
   * 
   * Updates launchpad status to ACTIVE and creates activity record
   */
  async handleUnpaused(unpauseData: UnpauseData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(unpauseData, [
        'chainId',
        'launchpadAddress',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `▶️ Processing unpaused event: ${unpauseData.launchpadAddress}`
      );

      // Normalize address
      const normalizedAddress = unpauseData.launchpadAddress.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        unpauseData.txHash,
        ActivityType.LAUNCHPAD_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate unpaused event, skipping: ${unpauseData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Update launchpad status to ACTIVE (Requirement 9.3)
        await tx.launchpad.update({
          where: { id: launchpad.id },
          data: {
            status: LaunchpadStatus.ACTIVE,
            updatedAt: new Date()
          }
        });

        // Create activity record (Requirement 9.4)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.LAUNCHPAD_UPDATED,
            actor: launchpad.creator,
            description: `Launchpad unpaused`,
            txHash: unpauseData.txHash,
            blockNumber: unpauseData.blockNumber,
            metadata: {
              action: 'unpaused',
              previousStatus: launchpad.status
            }
          }
        });
      });

      console.log(
        `✅ Launchpad unpaused: ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handleUnpaused', error, unpauseData);
      throw error;
    }
  }

  // ==========================================================================
  // Access Control Event Handlers
  // ==========================================================================

  /**
   * Handle role granted event
   * Requirements: 10.1, 10.2
   * 
   * Stores role and account information in activity metadata and creates activity record
   */
  async handleRoleGranted(roleData: RoleGrantedData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(roleData, [
        'chainId',
        'launchpadAddress',
        'role',
        'account',
        'sender',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `🔑 Processing role granted: ${roleData.role} to ${roleData.account} on ${roleData.launchpadAddress}`
      );

      // Normalize addresses
      const normalizedAddress = roleData.launchpadAddress.toLowerCase();
      const normalizedAccount = roleData.account.toLowerCase();
      const normalizedSender = roleData.sender.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        roleData.txHash,
        ActivityType.LAUNCHPAD_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate role granted event, skipping: ${roleData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Create activity record with role and account information (Requirements 10.1, 10.2)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.LAUNCHPAD_UPDATED,
            actor: normalizedSender,
            description: `Role "${roleData.role}" granted to ${this.truncateAddress(normalizedAccount)}`,
            txHash: roleData.txHash,
            blockNumber: roleData.blockNumber,
            metadata: {
              action: 'role_granted',
              role: roleData.role,
              account: normalizedAccount,
              sender: normalizedSender
            }
          }
        });
      });

      console.log(
        `✅ Role granted: ${roleData.role} to ${this.truncateAddress(normalizedAccount)} on ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handleRoleGranted', error, roleData);
      throw error;
    }
  }

  /**
   * Handle role revoked event
   * Requirements: 10.3, 10.4
   * 
   * Stores role and account information in activity metadata and creates activity record
   */
  async handleRoleRevoked(roleData: RoleRevokedData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(roleData, [
        'chainId',
        'launchpadAddress',
        'role',
        'account',
        'sender',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `🔓 Processing role revoked: ${roleData.role} from ${roleData.account} on ${roleData.launchpadAddress}`
      );

      // Normalize addresses
      const normalizedAddress = roleData.launchpadAddress.toLowerCase();
      const normalizedAccount = roleData.account.toLowerCase();
      const normalizedSender = roleData.sender.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        roleData.txHash,
        ActivityType.LAUNCHPAD_UPDATED,
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate role revoked event, skipping: ${roleData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Create activity record with role and account information (Requirements 10.3, 10.4)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.LAUNCHPAD_UPDATED,
            actor: normalizedSender,
            description: `Role "${roleData.role}" revoked from ${this.truncateAddress(normalizedAccount)}`,
            txHash: roleData.txHash,
            blockNumber: roleData.blockNumber,
            metadata: {
              action: 'role_revoked',
              role: roleData.role,
              account: normalizedAccount,
              sender: normalizedSender
            }
          }
        });
      });

      console.log(
        `✅ Role revoked: ${roleData.role} from ${this.truncateAddress(normalizedAccount)} on ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handleRoleRevoked', error, roleData);
      throw error;
    }
  }

  // ==========================================================================
  // Fee Update Event Handlers
  // ==========================================================================

  /**
   * Handle platform fee update event
   * Requirements: 11.1, 11.2
   * 
   * Updates launchpad_factories platformFeePercentage field and creates activity record
   */
  async handlePlatformFeeUpdate(feeData: FeeUpdateData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(feeData, [
        'chainId',
        'factoryAddress',
        'oldFee',
        'newFee',
        'feeType',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `💵 Processing platform fee update: ${feeData.factoryAddress}`
      );

      // Normalize address
      const normalizedAddress = feeData.factoryAddress.toLowerCase();

      // Fetch factory
      const factory = await prisma.launchpadFactory.findUnique({
        where: {
          contractAddress: normalizedAddress
        }
      });

      if (!factory) {
        console.warn(`⚠️ Factory not found: ${normalizedAddress}`);
        throw new Error(`Factory not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        feeData.txHash,
        ActivityType.LAUNCHPAD_UPDATED,
        undefined // No launchpad ID for factory events
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate platform fee update event, skipping: ${feeData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Update factory platformFeePercentage (Requirement 11.1)
        await tx.launchpadFactory.update({
          where: {
            contractAddress: normalizedAddress
          },
          data: {
            platformFeePercentage: parseFloat(feeData.newFee),
            updatedAt: new Date()
          }
        });

        // Create activity record (Requirement 11.2)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: factory.id,
            launchpadId: null, // Factory-level event
            type: ActivityType.LAUNCHPAD_UPDATED,
            actor: factory.owner || '0x0000000000000000000000000000000000000000',
            description: `Platform fee updated from ${feeData.oldFee}% to ${feeData.newFee}%`,
            txHash: feeData.txHash,
            blockNumber: feeData.blockNumber,
            metadata: {
              action: 'platform_fee_update',
              oldFee: feeData.oldFee,
              newFee: feeData.newFee,
              feeType: feeData.feeType
            }
          }
        });
      });

      console.log(
        `✅ Platform fee updated for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handlePlatformFeeUpdate', error, feeData);
      throw error;
    }
  }

  /**
   * Handle creation fee update event
   * Requirements: 11.3, 11.4
   * 
   * Updates launchpad_factories creationFee field and creates activity record
   */
  async handleCreationFeeUpdate(feeData: FeeUpdateData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(feeData, [
        'chainId',
        'factoryAddress',
        'oldFee',
        'newFee',
        'feeType',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `💵 Processing creation fee update: ${feeData.factoryAddress}`
      );

      // Normalize address
      const normalizedAddress = feeData.factoryAddress.toLowerCase();

      // Fetch factory
      const factory = await prisma.launchpadFactory.findUnique({
        where: {
          contractAddress: normalizedAddress
        }
      });

      if (!factory) {
        console.warn(`⚠️ Factory not found: ${normalizedAddress}`);
        throw new Error(`Factory not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        feeData.txHash,
        ActivityType.LAUNCHPAD_UPDATED,
        undefined // No launchpad ID for factory events
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate creation fee update event, skipping: ${feeData.txHash}`);
        return;
      }

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Update factory creationFee (Requirement 11.3)
        await tx.launchpadFactory.update({
          where: {
            contractAddress: normalizedAddress
          },
          data: {
            creationFee: feeData.newFee,
            updatedAt: new Date()
          }
        });

        // Create activity record (Requirement 11.4)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: factory.id,
            launchpadId: null, // Factory-level event
            type: ActivityType.LAUNCHPAD_UPDATED,
            actor: factory.owner || '0x0000000000000000000000000000000000000000',
            description: `Creation fee updated from ${feeData.oldFee} to ${feeData.newFee}`,
            txHash: feeData.txHash,
            blockNumber: feeData.blockNumber,
            metadata: {
              action: 'creation_fee_update',
              oldFee: feeData.oldFee,
              newFee: feeData.newFee,
              feeType: feeData.feeType
            }
          }
        });
      });

      console.log(
        `✅ Creation fee updated for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handleCreationFeeUpdate', error, feeData);
      throw error;
    }
  }
}
