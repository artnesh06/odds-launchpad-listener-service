/**
 * Metadata Event Handlers (Phase 3)
 * 
 * Handlers for metadata URI updates:
 * - BaseURIUpdated: Base URI changes for token metadata
 * - ContractURIUpdated: Contract-level metadata URI changes
 * - ExternalLinkUpdated: External link updates
 */

import { ActivityType } from '@prisma/client';
import { prisma } from '../../../config/database';
import { BaseEventHandler } from './base-handler';
import {
  BaseURIUpdatedEvent,
  ContractURIUpdatedEvent,
  ExternalLinkUpdatedEvent
} from '../event-types';

export class MetadataEventHandler extends BaseEventHandler {
  /**
   * Handle BaseURIUpdated event
   */
  async handleBaseURIUpdatedEvent(event: BaseURIUpdatedEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['newBaseURI', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`🔗 Base URI updated: ${event.newBaseURI} for ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.METADATA_UPDATED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Base URI update already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Create activity with ActivityType.METADATA_UPDATED
      // Format metadata with updateType: 'baseURI' and newValue
      await this.writeActivityWithRetry({
        chainId: this.context.chainId,
        factoryId: launchpad.factoryId,
        launchpadId: launchpad.id,
        type: ActivityType.METADATA_UPDATED,
        actor: launchpad.creator,
        description: `Base URI updated`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          updateType: 'baseURI',
          newValue: event.newBaseURI,
          collectionName: launchpad.name,
          collectionSymbol: launchpad.symbol
        }
      });

      console.log(`✅ Base URI update activity recorded: ${event.txHash}`);

    } catch (error) {
      console.error(`❌ Error handling base URI updated event:`, error);
      await this.logEventError('BaseURIUpdated', error, event, 'low');
    }
  }

  /**
   * Handle ContractURIUpdated event
   */
  async handleContractURIUpdatedEvent(event: ContractURIUpdatedEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['newContractURI', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`📄 Contract URI updated: ${event.newContractURI} for ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.METADATA_UPDATED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ Contract URI update already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Update launchpad contractURI in database
      await prisma.launchpad.update({
        where: { id: launchpad.id },
        data: { contractURI: event.newContractURI }
      });

      // Create activity with ActivityType.METADATA_UPDATED
      // Format metadata with updateType: 'contractURI' and newValue
      await this.writeActivityWithRetry({
        chainId: this.context.chainId,
        factoryId: launchpad.factoryId,
        launchpadId: launchpad.id,
        type: ActivityType.METADATA_UPDATED,
        actor: launchpad.creator,
        description: `Contract URI updated`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          updateType: 'contractURI',
          newValue: event.newContractURI,
          collectionName: launchpad.name,
          collectionSymbol: launchpad.symbol
        }
      });

      console.log(`✅ Contract URI update activity recorded: ${event.txHash}`);

    } catch (error) {
      console.error(`❌ Error handling contract URI updated event:`, error);
      await this.logEventError('ContractURIUpdated', error, event, 'low');
    }
  }

  /**
   * Handle ExternalLinkUpdated event
   */
  async handleExternalLinkUpdatedEvent(event: ExternalLinkUpdatedEvent): Promise<void> {
    try {
      // Extract and validate event data
      this.validateEventData(event, ['newExternalLink', 'txHash', 'blockNumber', 'launchpadAddress']);

      console.log(`🌐 External link updated: ${event.newExternalLink} for ${event.launchpadAddress}`);

      // Check for duplicates
      const isDuplicate = await this.isDuplicateActivity(
        event.txHash,
        ActivityType.METADATA_UPDATED,
        event.launchpadAddress
      );

      if (isDuplicate) {
        console.log(`⚠️ External link update already processed: ${event.txHash}`);
        return;
      }

      // Fetch launchpad data
      const launchpad = await this.fetchLaunchpad(event.launchpadAddress);
      if (!launchpad) return;

      // Create activity with ActivityType.METADATA_UPDATED
      // Format metadata with updateType: 'externalLink' and newValue
      await this.writeActivityWithRetry({
        chainId: this.context.chainId,
        factoryId: launchpad.factoryId,
        launchpadId: launchpad.id,
        type: ActivityType.METADATA_UPDATED,
        actor: launchpad.creator,
        description: `External link updated`,
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        metadata: {
          updateType: 'externalLink',
          newValue: event.newExternalLink,
          collectionName: launchpad.name,
          collectionSymbol: launchpad.symbol
        }
      });

      console.log(`✅ External link update activity recorded: ${event.txHash}`);

    } catch (error) {
      console.error(`❌ Error handling external link updated event:`, error);
      await this.logEventError('ExternalLinkUpdated', error, event, 'low');
    }
  }
}
