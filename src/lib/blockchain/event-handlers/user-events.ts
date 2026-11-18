/**
 * User-Facing Event Handlers (Phase 1)
 * 
 * Handlers untuk events yang directly impact user experience:
 * - Burned: NFT burning events
 * - Airdropped: Batch airdrop events
 * - PhaseAdded: New mint phase creation
 * - PhaseUpdated: Mint phase updates
 * - PhaseRemoved: Mint phase removal
 * - Revealed: Collection reveal events
 */

import { prisma } from '../../../config/database';
import { getChainProvider } from '../chain-provider';
import { ActivityType } from '@prisma/client';
import { BaseEventHandler } from './base-handler';
import { ethers } from 'ethers';
import {
  BurnedEvent,
  AirdroppedEvent,
  PhaseAddedEvent,
  PhaseUpdatedEvent,
  PhaseRemovedEvent,
  RevealedEvent
} from '../event-types';

/**
 * Safely convert price to wei format string
 * Handles bigint, string (wei or ether format), and other types
 */
function convertPriceToWei(price: any): string {
  if (typeof price === 'bigint') {
    return price.toString();
  }
  
  if (typeof price === 'string') {
    // Check if string contains decimal (ether format)
    if (price.includes('.')) {
      console.error(`❌ CRITICAL: Price received in ether format (${price}), converting to wei`);
      return ethers.parseEther(price).toString();
    }
    // Validate it's a valid BigInt string
    BigInt(price);
    return price;
  }
  
  // Try to convert to BigInt
  const priceStr = String(price);
  return BigInt(priceStr).toString();
}

export class UserEventHandler extends BaseEventHandler {
  /**
   * Handle Burned event
   */
  async handleBurnedEvent(event: BurnedEvent): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(event, ['owner', 'tokenId', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`🔥 Burn detected: Token #${event.tokenId} by ${event.owner}`);

      // Check for duplicate activities
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.BURN_OCCURRED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Burn already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data from database including metadata
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Truncate owner address
      const ownerShort = this.truncateAddress(event.owner);

      // Create activity record with ActivityType.BURN_OCCURRED
      await this.writeActivityWithRetry({
        chainId: this.context.chainId,
        factoryId: launchpad.factoryId,
        launchpadId: launchpad.id,
        type: ActivityType.BURN_OCCURRED,
        actor: event.owner,
        description: `Burned by ${ownerShort}`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          tokenId: event.tokenId.toString(),
          owner: event.owner,
          ownerShort,
          collectionName: launchpad.name,
          collectionSymbol: launchpad.symbol,
          collectionImage: launchpad.metadata?.image || null
        }
      });

      // Update collection supply count on burn
      // Delete the mint record first, then recalculate mintedCount from actual mints
      await prisma.$transaction(async (tx) => {
        // Delete mint record if exists
        await tx.mint.deleteMany({
          where: {
            launchpadId: launchpad.id,
            tokenId: Number(event.tokenId)
          }
        });

        // Calculate actual mintedCount from remaining mints (same as sync-collection.ts)
        const actualMintCount = await tx.mint.count({
          where: { launchpadId: launchpad.id }
        });

        // Update mintedCount to actual count
        await tx.launchpad.update({
          where: { id: launchpad.id },
          data: {
            mintedCount: actualMintCount
          }
        });
      });

      console.log(`✅ Burn activity recorded: ${event.txHash}`);

      // Emit to WebSocket clients
      try {
        if (this.context.eventEmitter) {
          this.context.eventEmitter.emitBurnEvent({
            contractAddress: event.launchpadAddress,
            chainId: this.context.chainId,
            owner: event.owner,
            tokenId: event.tokenId.toString(),
            timestamp: new Date(),
            transactionHash: event.txHash
          });
        }
      } catch (wsError) {
        // Log but don't throw - WebSocket errors shouldn't break the listener
        console.error(`⚠️ Failed to emit burn event to WebSocket:`, wsError);
      }

    } catch (error) {
      console.error(`❌ Error handling burned event:`, error);
      await this.logEventError('Burned', error, event, 'high');
    }
  }

  /**
   * Handle Airdropped event
   */
  async handleAirdroppedEvent(event: AirdroppedEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['operator', 'recipientCount', 'totalQuantity', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`🎁 Airdrop detected: ${event.totalQuantity} NFTs to ${event.recipientCount} recipients by ${event.operator}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.AIRDROP_OCCURRED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Airdrop already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data from database
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Truncate operator address
      const operatorShort = this.truncateAddress(event.operator);

      // Create activity with ActivityType.AIRDROP_OCCURRED
      await this.writeActivityWithRetry({
        chainId: this.context.chainId,
        factoryId: launchpad.factoryId,
        launchpadId: launchpad.id,
        type: ActivityType.AIRDROP_OCCURRED,
        actor: event.operator,
        description: `Airdropped by ${operatorShort}`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          operator: event.operator,
          operatorShort,
          recipientCount: event.recipientCount.toString(),
          totalQuantity: event.totalQuantity.toString(),
          collectionName: launchpad.name,
          collectionSymbol: launchpad.symbol,
          collectionImage: launchpad.metadata?.image || null
        }
      });

      console.log(`✅ Airdrop activity recorded: ${event.txHash}`);

      // Emit to WebSocket clients
      try {
        if (this.context.eventEmitter) {
          this.context.eventEmitter.emitAirdropEvent({
            contractAddress: event.launchpadAddress,
            chainId: this.context.chainId,
            operator: event.operator,
            recipients: [], // Recipients not available in event
            totalQuantity: event.totalQuantity,
            timestamp: new Date(),
            transactionHash: event.txHash
          });
        }
      } catch (wsError) {
        // Log but don't throw - WebSocket errors shouldn't break the listener
        console.error(`⚠️ Failed to emit airdrop event to WebSocket:`, wsError);
      }

    } catch (error) {
      console.error(`❌ Error handling airdropped event:`, error);
      await this.logEventError('Airdropped', error, event, 'high');
    }
  }

  /**
   * Handle PhaseAdded event
   * Requirements: 1.1, 1.2, 1.3, 1.5, 6.4
   */
  async handlePhaseAddedEvent(event: PhaseAddedEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['phaseId', 'name', 'startTime', 'endTime', 'price', 'maxMintPerWallet', 'totalLimit', 'txHash', 'blockNumber', 'launchpadAddress']);

      // CRITICAL: Validate price format - must be BigInt in wei, not decimal
      let priceInWei: string;
      try {
        priceInWei = convertPriceToWei(event.price);
      } catch (error) {
        console.error(`❌ Invalid price format:`, event.price, error);
        throw new Error(`Invalid price format: ${event.price}`);
      }

      // Import format helper
      const { formatPriceWithUnit } = await import('../../../utils/format-helpers');
      const formattedPrice = formatPriceWithUnit(priceInWei);

      console.log(`📅 Phase added: ${event.name} (ID: ${event.phaseId}) for ${event.launchpadAddress}`);
      console.log(`   Price: ${formattedPrice} (${priceInWei} wei)`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.PHASE_CREATED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Phase addition already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // ========================================================================
      // VALIDATION: Sequential Index Validation (Requirements 1.3, 1.5)
      // ========================================================================
      const phaseId = Number(event.phaseId);
      
      // Check for duplicate phase index (Requirement 6.4)
      const existingPhase = await prisma.launchpadPhase.findUnique({
        where: {
          launchpadId_phaseIndex: {
            launchpadId: launchpad.id,
            phaseIndex: phaseId
          }
        }
      });

      if (existingPhase) {
        console.warn(`⚠️ Duplicate phase index detected!`);
        console.warn(`   Collection: ${event.launchpadAddress}`);
        console.warn(`   Phase Index: ${phaseId}`);
        console.warn(`   Existing Phase: ${existingPhase.name}`);
        console.warn(`   New Phase: ${event.name}`);
        console.warn(`   Action: Skipping creation`);
        return; // Skip creation to prevent duplicate
      }

      // Validate phaseId is sequential (Requirements 1.3, 1.5)
      const existingPhases = await prisma.launchpadPhase.findMany({
        where: { launchpadId: launchpad.id },
        orderBy: { phaseIndex: 'desc' },
        take: 1
      });

      const expectedIndex = existingPhases.length > 0 
        ? existingPhases[0].phaseIndex + 1 
        : 0;

      if (phaseId !== expectedIndex) {
        console.warn(`⚠️ Phase index mismatch detected!`);
        console.warn(`   Expected: ${expectedIndex}, Received: ${phaseId}`);
        console.warn(`   Collection: ${event.launchpadAddress}`);
        console.warn(`   Phase: ${event.name}`);
        console.warn(`   Action: Continuing but flagging for review`);
      } else {
        console.log(`✅ Phase index validation passed: ${phaseId} matches expected ${expectedIndex}`);
      }

      // Convert timestamps to Date objects
      const startTime = new Date(Number(event.startTime) * 1000);
      const endTime = new Date(Number(event.endTime) * 1000);

      // Fetch full phase data from contract to get maxMintPerWallet and totalLimit
      // Since these fields are not in the event, we need to query the contract
      let maxMintPerWallet = 0;
      let totalLimit = 0;
      let merkleRoot = ethers.ZeroHash;
      
      try {
        const provider = getChainProvider(this.context.chainId);
        const contract = new ethers.Contract(
          event.launchpadAddress,
          ['function getMintPhase(uint256) view returns (tuple(string name, uint256 startTime, uint256 endTime, uint256 price, uint256 maxSupply, uint256 currentSupply, uint256 maxPerWallet, uint256 maxPerTransaction, bytes32 merkleRoot, bool isActive, bool requiresWhitelist))'],
          provider
        );
        
        const phaseData = await contract.getMintPhase(event.phaseId);
        maxMintPerWallet = Number(phaseData.maxPerWallet);
        totalLimit = Number(phaseData.maxSupply);
        merkleRoot = phaseData.merkleRoot;
      } catch (contractError) {
        console.warn(`⚠️ Could not fetch phase data from contract, using defaults:`, contractError);
        // Use defaults if contract call fails
        maxMintPerWallet = 0;
        totalLimit = 0;
      }

      // Determine phase type based on price and name
      let phaseType: 'PRESALE' | 'PUBLIC' | 'ALLOWLIST' | 'FREE' = 'PUBLIC';
      const nameLower = event.name.toLowerCase();
      if (BigInt(priceInWei) === BigInt(0)) {
        phaseType = 'FREE';
      } else if (nameLower.includes('presale') || nameLower.includes('pre-sale')) {
        phaseType = 'PRESALE';
      } else if (nameLower.includes('allowlist') || nameLower.includes('whitelist')) {
        phaseType = 'ALLOWLIST';
      }

      // Use a transaction to ensure atomic update with activity creation
      await prisma.$transaction(async (tx) => {
        // Create new LaunchpadPhase record when PhaseAdded event occurs
        // phaseId from contract is the phase index (0-based)
        await tx.launchpadPhase.create({
          data: {
            launchpadId: launchpad.id,
            phaseIndex: phaseId, // Use phaseId as phaseIndex from contract (Requirement 1.2)
            name: event.name,
            phaseType: phaseType,
            startTime: startTime,
            endTime: endTime,
            price: priceInWei, // Use validated price in wei
            maxMintPerWallet: maxMintPerWallet,
            totalLimit: totalLimit,
            merkleRoot: merkleRoot,
            mintedCount: 0,
            isActive: true
          }
        });

        // Create activity with ActivityType.PHASE_CREATED
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.PHASE_CREATED,
            actor: launchpad.creator,
            description: `Phase "${event.name}" added`,
            txHash: event.txHash,
            blockNumber: event.blockNumber,
            metadata: {
              phaseId: event.phaseId.toString(),
              phaseName: event.name,
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
              price: priceInWei, // Use validated price in wei
              maxMintPerWallet: maxMintPerWallet.toString(),
              totalLimit: totalLimit.toString(),
              collectionName: launchpad.name,
              collectionSymbol: launchpad.symbol,
              collectionImage: launchpad.metadata?.image || null
            }
          }
        });
      });

      console.log(`✅ Phase addition activity recorded and phase created in database: ${event.txHash}`);

      // ========================================================================
      // Emit WebSocket event for real-time updates
      // Requirements: 4.2
      // ========================================================================
      if (this.context.eventEmitter) {
        try {
          // Prepare phase event data for WebSocket
          const phaseEventData = {
            contractAddress: event.launchpadAddress,
            chainId: this.context.chainId,
            phaseId: event.phaseId.toString(),
            minted: 0, // New phase starts with 0 minted
            isActive: true,
            timestamp: new Date().toISOString(), // Convert to ISO string for validation
          };

          // Emit to WebSocket clients
          this.context.eventEmitter.emitPhaseEvent(phaseEventData);
        } catch (wsError) {
          // Log but don't throw - WebSocket errors shouldn't break the listener
          console.warn(`⚠️ Failed to emit WebSocket phase event for ${event.launchpadAddress}:`, wsError);
        }
      }

    } catch (error) {
      console.error(`❌ Error handling phase added event:`, error);
      await this.logEventError('PhaseAdded', error, event, 'high');
    }
  }

  /**
   * Handle PhaseUpdated event
   * Requirements: 2.4, 6.5
   */
  async handlePhaseUpdatedEvent(event: PhaseUpdatedEvent): Promise<void> {
    try {
      // Extract and validate event data (maxMintPerWallet and totalLimit are optional)
      this.validateEventData(event, ['phaseId', 'name', 'startTime', 'endTime', 'price', 'txHash', 'blockNumber', 'launchpadAddress']);

      // CRITICAL: Validate price format - must be BigInt in wei, not decimal
      let priceInWei: string;
      try {
        priceInWei = convertPriceToWei(event.price);
      } catch (error) {
        console.error(`❌ Invalid price format:`, event.price, error);
        throw new Error(`Invalid price format: ${event.price}`);
      }

      // Import format helper
      const { formatPriceWithUnit } = await import('../../../utils/format-helpers');
      const formattedPrice = formatPriceWithUnit(priceInWei);

      console.log(`🔄 Phase updated: ${event.name} (ID: ${event.phaseId}) for ${event.launchpadAddress}`);
      console.log(`   Price: ${formattedPrice} (${priceInWei} wei)`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.PHASE_UPDATED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Phase update already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // ========================================================================
      // VALIDATION: Existence Check (Requirement 2.4)
      // ========================================================================
      const phaseId = Number(event.phaseId);
      
      // Check if phase exists before updating
      const existingPhase = await prisma.launchpadPhase.findUnique({
        where: {
          launchpadId_phaseIndex: {
            launchpadId: launchpad.id,
            phaseIndex: phaseId
          }
        }
      });

      if (!existingPhase) {
        console.warn(`⚠️ Phase with index ${phaseId} not found for collection ${event.launchpadAddress}`);
        console.warn(`   Phase Name: ${event.name}`);
        console.warn(`   Action: Creating new phase as fallback (Requirement 6.5)`);
      } else {
        console.log(`✅ Phase existence validation passed: Phase ${phaseId} found`);
      }

      // Convert timestamps to Date objects
      const startTime = new Date(Number(event.startTime) * 1000);
      const endTime = new Date(Number(event.endTime) * 1000);

      // Fetch full phase data from contract to get maxMintPerWallet and totalLimit
      // Since these fields are not in the event, we need to query the contract
      let maxMintPerWallet: number | undefined;
      let totalLimit: number | undefined;
      let merkleRoot: string | undefined;
      
      try {
        const provider = getChainProvider(this.context.chainId);
        const contract = new ethers.Contract(
          event.launchpadAddress,
          ['function getMintPhase(uint256) view returns (tuple(string name, uint256 startTime, uint256 endTime, uint256 price, uint256 maxSupply, uint256 currentSupply, uint256 maxPerWallet, uint256 maxPerTransaction, bytes32 merkleRoot, bool isActive, bool requiresWhitelist))'],
          provider
        );
        
        const phaseData = await contract.getMintPhase(event.phaseId);
        maxMintPerWallet = Number(phaseData.maxPerWallet);
        totalLimit = Number(phaseData.maxSupply);
        merkleRoot = phaseData.merkleRoot;
      } catch (contractError) {
        console.warn(`⚠️ Could not fetch phase data from contract for update:`, contractError);
        // Leave undefined if contract call fails - will not update these fields
      }

      // Determine phase type based on price and name
      let phaseType: 'PRESALE' | 'PUBLIC' | 'ALLOWLIST' | 'FREE' = 'PUBLIC';
      const nameLower = event.name.toLowerCase();
      if (BigInt(priceInWei) === BigInt(0)) {
        phaseType = 'FREE';
      } else if (nameLower.includes('presale') || nameLower.includes('pre-sale')) {
        phaseType = 'PRESALE';
      } else if (nameLower.includes('allowlist') || nameLower.includes('whitelist')) {
        phaseType = 'ALLOWLIST';
      }

      // Use a transaction to ensure atomic update with activity creation
      await prisma.$transaction(async (tx) => {
        if (existingPhase) {
          // Update existing LaunchpadPhase record with new parameters
          // Build update data, only including optional fields if present
          const updateData: any = {
            name: event.name, // Name can also be updated
            phaseType: phaseType,
            startTime: startTime,
            endTime: endTime,
            price: priceInWei, // Use validated price in wei
          };
          if (maxMintPerWallet !== undefined) {
            updateData.maxMintPerWallet = maxMintPerWallet;
          }
          if (totalLimit !== undefined) {
            updateData.totalLimit = totalLimit;
          }
          if (merkleRoot !== undefined) {
            updateData.merkleRoot = merkleRoot;
          }
          
          await tx.launchpadPhase.update({
            where: { id: existingPhase.id },
            data: updateData
          });
          
          console.log(`✅ Updated existing phase ${phaseId}: ${event.name}`);
        } else {
          // Create if not exists (fallback - Requirement 6.5)
          // Build create data, using defaults for optional fields
          const createData: any = {
            launchpadId: launchpad.id,
            phaseIndex: phaseId,
            name: event.name,
            phaseType: phaseType,
            startTime: startTime,
            endTime: endTime,
            price: priceInWei, // Use validated price in wei
            maxMintPerWallet: maxMintPerWallet ?? 0,
            totalLimit: totalLimit ?? 0,
            merkleRoot: merkleRoot ?? ethers.ZeroHash,
            mintedCount: 0,
            isActive: true
          };
          
          await tx.launchpadPhase.create({
            data: createData
          });
          
          console.log(`✅ Created new phase ${phaseId} as fallback: ${event.name}`);
        }

        // Create activity with ActivityType.PHASE_UPDATED
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.PHASE_UPDATED,
            actor: launchpad.creator,
            description: `Phase "${event.name}" updated`,
            txHash: event.txHash,
            blockNumber: event.blockNumber,
            metadata: {
              phaseId: event.phaseId.toString(),
              phaseName: event.name,
              startTime: startTime.toISOString(),
              endTime: endTime.toISOString(),
              price: priceInWei, // Use validated price in wei
              maxMintPerWallet: maxMintPerWallet?.toString() ?? null,
              totalLimit: totalLimit?.toString() ?? null,
              collectionName: launchpad.name,
              collectionSymbol: launchpad.symbol,
              collectionImage: launchpad.metadata?.image || null
            }
          }
        });
      });

      console.log(`✅ Phase update activity recorded and phase updated in database: ${event.txHash}`);

      // ========================================================================
      // Emit WebSocket event for real-time updates
      // Requirements: 4.2
      // ========================================================================
      if (this.context.eventEmitter) {
        try {
          // Prepare phase event data for WebSocket
          const phaseEventData = {
            contractAddress: event.launchpadAddress,
            chainId: this.context.chainId,
            phaseId: event.phaseId.toString(),
            minted: existingPhase?.mintedCount ?? 0, // Use actual minted count from existing phase
            isActive: true,
            timestamp: new Date().toISOString(), // Convert to ISO string for validation
          };

          // Emit to WebSocket clients
          this.context.eventEmitter.emitPhaseEvent(phaseEventData);
        } catch (wsError) {
          // Log but don't throw - WebSocket errors shouldn't break the listener
          console.warn(`⚠️ Failed to emit WebSocket phase event for ${event.launchpadAddress}:`, wsError);
        }
      }

    } catch (error) {
      console.error(`❌ Error handling phase updated event:`, error);
      await this.logEventError('PhaseUpdated', error, event, 'high');
    }
  }

  /**
   * Handle PhaseRemoved event
   * Requirements: 2.5, 6.6
   * 
   * Marks phase as inactive when removed from contract
   */
  async handlePhaseRemovedEvent(event: PhaseRemovedEvent): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(event, ['phaseId', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`🗑️ Phase removed: ID ${event.phaseId} for ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.PHASE_UPDATED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Phase removal already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      const phaseId = Number(event.phaseId);

      // Use a transaction to ensure atomic update with activity creation
      await prisma.$transaction(async (tx) => {
        // Find existing phase
        const existingPhase = await tx.launchpadPhase.findUnique({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseId
            }
          }
        });

        if (!existingPhase) {
          console.warn(`⚠️ Phase ${phaseId} not found for removal in collection ${event.launchpadAddress}`);
          return;
        }

        // Mark phase as inactive instead of deleting (preserves historical data)
        await tx.launchpadPhase.update({
          where: {
            launchpadId_phaseIndex: {
              launchpadId: launchpad.id,
              phaseIndex: phaseId
            }
          },
          data: {
            isActive: false
          }
        });

        console.log(`✅ Marked phase ${phaseId} as inactive: ${existingPhase.name}`);

        // Create activity with ActivityType.PHASE_UPDATED
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.PHASE_UPDATED,
            actor: launchpad.creator,
            description: `Phase "${existingPhase.name}" removed`,
            txHash: event.txHash,
            blockNumber: event.blockNumber,
            metadata: {
              phaseId: event.phaseId.toString(),
              phaseName: existingPhase.name,
              action: 'removed',
              collectionName: launchpad.name,
              collectionSymbol: launchpad.symbol,
              collectionImage: launchpad.metadata?.image || null
            }
          }
        });
      });

      console.log(`✅ Phase removal activity recorded: ${event.txHash}`);

      // Emit WebSocket event for real-time updates
      if (this.context.eventEmitter) {
        try {
          const phaseEventData = {
            contractAddress: event.launchpadAddress,
            chainId: this.context.chainId,
            phaseId: event.phaseId.toString(),
            minted: 0,
            isActive: false,
            timestamp: new Date().toISOString(),
          };

          this.context.eventEmitter.emitPhaseEvent(phaseEventData);
        } catch (wsError) {
          console.warn(`⚠️ Failed to emit WebSocket phase removal event for ${event.launchpadAddress}:`, wsError);
        }
      }

    } catch (error) {
      console.error(`❌ Error handling phase removed event:`, error);
      await this.logEventError('PhaseRemoved', error, event, 'high');
    }
  }

  /**
   * Handle Revealed event
   */
  async handleRevealedEvent(event: RevealedEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['baseURI', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`🎭 Collection revealed: ${event.baseURI} for ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.COLLECTION_REVEALED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Reveal already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Use a transaction to ensure atomic update with activity creation
      await prisma.$transaction(async (tx) => {
        // Update Launchpad record to set revealed status and baseURI
        await tx.launchpad.update({
          where: { id: launchpad.id },
          data: {
            baseURI: event.baseURI,
          }
        });

        // Create activity with ActivityType.COLLECTION_REVEALED
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.COLLECTION_REVEALED,
            actor: launchpad.creator,
            description: `Collection revealed`,
            txHash: event.txHash,
            blockNumber: event.blockNumber,
            metadata: {
              baseURI: event.baseURI,
              collectionName: launchpad.name,
              collectionSymbol: launchpad.symbol,
              collectionImage: launchpad.metadata?.image || null
            }
          }
        });
      });

      console.log(`✅ Reveal activity recorded and collection revealed status updated: ${event.txHash}`);

      // Emit to WebSocket clients
      try {
        if (this.context.eventEmitter) {
          this.context.eventEmitter.emitRevealEvent({
            contractAddress: event.launchpadAddress,
            chainId: this.context.chainId,
            revealed: true,
            timestamp: new Date(),
            transactionHash: event.txHash
          });
        }
      } catch (wsError) {
        // Log but don't throw - WebSocket errors shouldn't break the listener
        console.error(`⚠️ Failed to emit reveal event to WebSocket:`, wsError);
      }

    } catch (error) {
      console.error(`❌ Error handling revealed event:`, error);
      await this.logEventError('Revealed', error, event, 'high');
    }
  }

  /**
   * Get provider URL for the current chain
   */
  private getProviderUrl(): string {
    const { getChainConfig } = require('../../../config/chains');
    const chainConfig = getChainConfig(this.context.chainId);
    if (!chainConfig) {
      throw new Error(`Chain config not found for chainId ${this.context.chainId}`);
    }
    // Convert WebSocket URL to HTTP if needed
    return chainConfig.rpcUrl.replace('wss://', 'https://').replace('ws://', 'http://');
  }
}
