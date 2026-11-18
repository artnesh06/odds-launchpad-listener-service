/**
 * Administrative Event Handlers (Phase 2)
 * 
 * Handlers untuk administrative actions dan financial operations:
 * - TreasuryUpdated: Treasury address changes
 * - Withdrawn: Fund withdrawals
 * - OwnershipTransferred: Ownership changes
 * - PlatformFeeToggled: Platform fee enable/disable
 * - PlatformFlatFeeUpdated: Platform fee amount updates
 * - RoyaltyUpdated: Royalty configuration changes
 */

import { prisma } from '../../../config/database';
import { ActivityType } from '@prisma/client';
import { ethers } from 'ethers';
import { BaseEventHandler } from './base-handler';
import {
  TreasuryUpdatedEvent,
  WithdrawnEvent,
  OwnershipTransferredEvent,
  PlatformFeeToggledEvent,
  PlatformFlatFeeUpdatedEvent,
  RoyaltyUpdatedEvent
} from '../event-types';

export class AdminEventHandler extends BaseEventHandler {
  /**
   * Handle TreasuryUpdated event
   */
  async handleTreasuryUpdatedEvent(event: TreasuryUpdatedEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['oldTreasury', 'newTreasury', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`💰 Treasury updated: ${event.oldTreasury} → ${event.newTreasury} for ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.TREASURY_UPDATED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Treasury update already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Truncate treasury addresses
      const oldTreasuryShort = this.truncateAddress(event.oldTreasury);
      const newTreasuryShort = this.truncateAddress(event.newTreasury);

      // Create activity with ActivityType.TREASURY_UPDATED
      await this.writeActivityWithRetry({
        chainId: this.context.chainId,
        factoryId: launchpad.factoryId,
        launchpadId: launchpad.id,
        type: ActivityType.TREASURY_UPDATED,
        actor: launchpad.creator,
        description: `Treasury updated to ${newTreasuryShort}`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          oldTreasury: event.oldTreasury,
          oldTreasuryShort,
          newTreasury: event.newTreasury,
          newTreasuryShort,
          collectionName: launchpad.name
        }
      });

      console.log(`✅ Treasury update activity recorded: ${event.txHash}`);

    } catch (error) {
      console.error(`❌ Error handling treasury updated event:`, error);
      await this.logEventError('TreasuryUpdated', error, event, 'medium');
    }
  }

  /**
   * Handle Withdrawn event
   */
  async handleWithdrawnEvent(event: WithdrawnEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['recipient', 'amount', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`💸 Withdrawal detected: ${event.amount} wei to ${event.recipient} from ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.EMERGENCY_WITHDRAW,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Withdrawal already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Truncate recipient address
      const recipientShort = this.truncateAddress(event.recipient);

      // Convert amount from wei to ETH for display
      const amountInEth = ethers.formatEther(event.amount);

      // Create activity with ActivityType.EMERGENCY_WITHDRAW
      await this.writeActivityWithRetry({
        chainId: this.context.chainId,
        factoryId: launchpad.factoryId,
        launchpadId: launchpad.id,
        type: ActivityType.EMERGENCY_WITHDRAW,
        actor: event.recipient,
        description: `Withdrawn ${amountInEth} ETH to ${recipientShort}`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          recipient: event.recipient,
          recipientShort,
          amount: event.amount.toString(),
          amountInEth,
          collectionName: launchpad.name
        }
      });

      console.log(`✅ Withdrawal activity recorded: ${event.txHash}`);

    } catch (error) {
      console.error(`❌ Error handling withdrawn event:`, error);
      await this.logEventError('Withdrawn', error, event, 'medium');
    }
  }

  /**
   * Handle OwnershipTransferred event
   */
  async handleOwnershipTransferredEvent(event: OwnershipTransferredEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['previousOwner', 'newOwner', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`👑 Ownership transferred: ${event.previousOwner} → ${event.newOwner} for ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.OWNERSHIP_TRANSFERRED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Ownership transfer already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Truncate addresses
      const previousOwnerShort = this.truncateAddress(event.previousOwner);
      const newOwnerShort = this.truncateAddress(event.newOwner);

      // Use a transaction to ensure atomic update with activity creation
      await prisma.$transaction(async (tx) => {
        // Update Launchpad record with new owner address
        await tx.launchpad.update({
          where: { id: launchpad.id },
          data: {
            creator: event.newOwner
          }
        });

        // Create activity with ActivityType.OWNERSHIP_TRANSFERRED
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: ActivityType.OWNERSHIP_TRANSFERRED,
            actor: event.newOwner,
            description: `Ownership transferred to ${newOwnerShort}`,
            txHash: event.txHash,
            blockNumber: event.blockNumber,
            metadata: {
              previousOwner: event.previousOwner,
              previousOwnerShort,
              newOwner: event.newOwner,
              newOwnerShort,
              collectionName: launchpad.name
            }
          }
        });
      });

      console.log(`✅ Ownership transfer activity recorded and owner updated: ${event.txHash}`);

    } catch (error) {
      console.error(`❌ Error handling ownership transferred event:`, error);
      await this.logEventError('OwnershipTransferred', error, event, 'medium');
    }
  }

  /**
   * Handle PlatformFeeToggled event
   */
  async handlePlatformFeeToggledEvent(event: PlatformFeeToggledEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['enabled', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`💰 Platform fee toggled: ${event.enabled ? 'enabled' : 'disabled'} for ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.FEE_UPDATED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Platform fee toggle already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Create activity with ActivityType.FEE_UPDATED
      await this.writeActivityWithRetry({
        chainId: this.context.chainId,
        factoryId: launchpad.factoryId,
        launchpadId: launchpad.id,
        type: ActivityType.FEE_UPDATED,
        actor: launchpad.creator,
        description: `Platform fee ${event.enabled ? 'enabled' : 'disabled'}`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          enabled: event.enabled,
          collectionName: launchpad.name
        }
      });

      console.log(`✅ Platform fee toggle activity recorded: ${event.txHash}`);

    } catch (error) {
      console.error(`❌ Error handling platform fee toggled event:`, error);
      await this.logEventError('PlatformFeeToggled', error, event, 'medium');
    }
  }

  /**
   * Handle PlatformFlatFeeUpdated event
   */
  async handlePlatformFlatFeeUpdatedEvent(event: PlatformFlatFeeUpdatedEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['newFee', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`💰 Platform flat fee updated: ${event.newFee} wei for ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.FEE_UPDATED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Platform flat fee update already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Convert fee from wei to ETH for display
      const newFeeInEth = ethers.formatEther(event.newFee);

      // Create activity with ActivityType.FEE_UPDATED
      await this.writeActivityWithRetry({
        chainId: this.context.chainId,
        factoryId: launchpad.factoryId,
        launchpadId: launchpad.id,
        type: ActivityType.FEE_UPDATED,
        actor: launchpad.creator,
        description: `Platform flat fee updated to ${newFeeInEth} ETH`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          newFee: event.newFee.toString(),
          newFeeInEth,
          collectionName: launchpad.name
        }
      });

      console.log(`✅ Platform flat fee update activity recorded: ${event.txHash}`);

    } catch (error) {
      console.error(`❌ Error handling platform flat fee updated event:`, error);
      await this.logEventError('PlatformFlatFeeUpdated', error, event, 'medium');
    }
  }

  /**
   * Handle RoyaltyUpdated event
   */
  async handleRoyaltyUpdatedEvent(event: RoyaltyUpdatedEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['recipient', 'percentage', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`👑 Royalty updated: ${event.percentage}% to ${event.recipient} for ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.ROYALTY_UPDATED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Royalty update already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Truncate recipient address
      const recipientShort = this.truncateAddress(event.recipient);

      // Create activity with ActivityType.ROYALTY_UPDATED
      await this.writeActivityWithRetry({
        chainId: this.context.chainId,
        factoryId: launchpad.factoryId,
        launchpadId: launchpad.id,
        type: ActivityType.ROYALTY_UPDATED,
        actor: launchpad.creator,
        description: `Royalty updated to ${event.percentage}% for ${recipientShort}`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          recipient: event.recipient,
          recipientShort,
          percentage: event.percentage.toString(),
          collectionName: launchpad.name
        }
      });

      console.log(`✅ Royalty update activity recorded: ${event.txHash}`);

    } catch (error) {
      console.error(`❌ Error handling royalty updated event:`, error);
      await this.logEventError('RoyaltyUpdated', error, event, 'medium');
    }
  }
}
