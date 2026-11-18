import { Job } from 'bull';
import { ActivityEventJob } from '../queue-config';
import { prisma, withRetry, withDbLimit } from '../../../config/database';
import { ActivityType } from '@prisma/client';

/**
 * Activity Event Processor
 * Processes general activity events (burns, airdrops, phase updates, etc.)
 */
export class ActivityEventProcessor {
  /**
   * Process activity event job
   */
  async process(job: Job<ActivityEventJob>): Promise<void> {
    const { chainId, launchpadAddress, eventType, data, txHash, blockNumber, timestamp } = job.data;

    console.log(`📝 Processing ${eventType} activity event`);

    try {
      await job.progress(30);

      // Get launchpad info
      const launchpad = await this.getLaunchpadInfo(launchpadAddress);

      await job.progress(60);

      // Create activity record
      await this.createActivityRecord(
        chainId,
        launchpad?.factoryId,
        launchpadAddress,
        eventType,
        data,
        txHash,
        blockNumber
      );

      await job.progress(100);
      console.log(`✅ Activity event processed: ${eventType}`);
    } catch (error) {
      console.error(`❌ Error processing activity event:`, error);
      throw error;
    }
  }

  /**
   * Get launchpad information
   */
  private async getLaunchpadInfo(address?: string) {
    if (!address) return null;

    return withDbLimit(async () => {
      return prisma.launchpad.findUnique({
        where: {
          contractAddress: address.toLowerCase(),
        },
        select: {
          id: true,
          factoryId: true,
        },
      });
    });
  }

  /**
   * Create activity record
   */
  private async createActivityRecord(
    chainId: number,
    factoryId: string | undefined,
    launchpadId: string | undefined,
    eventType: string,
    data: any,
    txHash: string,
    blockNumber: number
  ): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        // Map event type to ActivityType enum
        const activityType = this.mapEventTypeToActivityType(eventType);

        // Generate description
        const description = this.generateDescription(eventType, data);

        await prisma.activity.create({
          data: {
            chainId,
            factoryId,
            launchpadId,
            type: activityType,
            actor: data.actor || data.operator || data.sender || 'system',
            description,
            txHash,
            blockNumber,
            metadata: data,
          },
        });
      });
    });
  }

  /**
   * Map event type to ActivityType enum
   */
  private mapEventTypeToActivityType(eventType: string): ActivityType {
    const mapping: Record<string, ActivityType> = {
      Burned: ActivityType.BURN_OCCURRED,
      Airdropped: ActivityType.AIRDROP_OCCURRED,
      PhaseAdded: ActivityType.PHASE_CREATED,
      PhaseUpdated: ActivityType.PHASE_UPDATED,
      Revealed: ActivityType.COLLECTION_REVEALED,
      TreasuryUpdated: ActivityType.TREASURY_UPDATED,
      Withdrawn: ActivityType.EMERGENCY_WITHDRAW,
      OwnershipTransferred: ActivityType.OWNERSHIP_TRANSFERRED,
      PlatformFeeToggled: ActivityType.FEE_UPDATED,
      PlatformFlatFeeUpdated: ActivityType.FEE_UPDATED,
      RoyaltyUpdated: ActivityType.ROYALTY_UPDATED,
      BaseURIUpdated: ActivityType.METADATA_UPDATED,
      ContractURIUpdated: ActivityType.METADATA_UPDATED,
      ExternalLinkUpdated: ActivityType.METADATA_UPDATED,
      Paused: ActivityType.CONTRACT_PAUSED,
      Unpaused: ActivityType.CONTRACT_UNPAUSED,
      TransferLockUpdated: ActivityType.TRANSFER_LOCK_UPDATED,
      RoleGranted: ActivityType.ROLE_GRANTED,
      RoleRevoked: ActivityType.ROLE_REVOKED,
    };

    return mapping[eventType] || ActivityType.LAUNCHPAD_UPDATED;
  }

  /**
   * Generate human-readable description
   */
  private generateDescription(eventType: string, data: any): string {
    switch (eventType) {
      case 'Burned':
        return `Token #${data.tokenId} burned by ${data.owner}`;
      case 'Airdropped':
        return `Airdropped ${data.totalQuantity} tokens to ${data.recipientCount} recipients`;
      case 'PhaseAdded':
        return `Phase "${data.name}" added`;
      case 'PhaseUpdated':
        return `Phase "${data.name}" updated`;
      case 'Revealed':
        return `Collection revealed with base URI: ${data.baseURI}`;
      case 'TreasuryUpdated':
        return `Treasury updated from ${data.oldTreasury} to ${data.newTreasury}`;
      case 'Withdrawn':
        return `Withdrawn ${data.amount} to ${data.recipient}`;
      case 'OwnershipTransferred':
        return `Ownership transferred from ${data.previousOwner} to ${data.newOwner}`;
      case 'RoyaltyUpdated':
        return `Royalty updated to ${data.percentage}% for ${data.recipient}`;
      case 'Paused':
        return 'Contract paused';
      case 'Unpaused':
        return 'Contract unpaused';
      default:
        return `${eventType} event occurred`;
    }
  }
}
