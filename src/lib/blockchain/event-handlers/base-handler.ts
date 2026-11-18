/**
 * Base Event Handler
 * 
 * Base class untuk semua event handlers dengan shared functionality
 */

import { prisma } from '../../../config/database';
import { ActivityType } from '@prisma/client';
import { 
  validateEventData, 
  isDuplicateActivity,
  logEventError 
} from '../validation-utils';
import { ErrorCounter, ErrorSeverity } from '../event-types';

export interface ActivityData {
  chainId: number;
  factoryId: string;
  launchpadId: string;
  type: ActivityType;
  actor: string;
  description: string;
  txHash: string;
  blockNumber: number;
  metadata: any;
}

export interface HandlerContext {
  chainId: number;
  retryAttempts: number;
  errorCounters: Map<string, ErrorCounter>;
  errorThreshold: number;
  sendAdminAlert: (alertData: any) => void;
  ensureLaunchpadRegistered?: (launchpadAddress: string) => Promise<void>;
  autoSyncLaunchpad?: (launchpadAddress: string) => Promise<any>;
  eventEmitter?: any; // EventEmitter from websocket module (optional to avoid circular dependency)
}

/**
 * Base class untuk event handlers
 */
export abstract class BaseEventHandler {
  protected context: HandlerContext;

  constructor(context: HandlerContext) {
    this.context = context;
  }

  /**
   * Validate event data
   */
  protected validateEventData(event: any, requiredFields: string[]): void {
    validateEventData(event, requiredFields);
  }

  /**
   * Check for duplicate activity
   */
  protected async isDuplicateActivity(
    txHash: string,
    eventType: ActivityType,
    launchpadAddress?: string
  ): Promise<boolean> {
    return isDuplicateActivity(txHash, eventType, launchpadAddress);
  }

  /**
   * Log event error
   */
  protected async logEventError(
    eventType: string,
    error: any,
    eventData: any,
    severity: ErrorSeverity = 'medium'
  ): Promise<void> {
    return logEventError(
      eventType,
      error,
      eventData,
      severity,
      this.context.chainId,
      this.context.errorCounters,
      this.context.errorThreshold,
      this.context.sendAdminAlert
    );
  }

  /**
   * Fetch launchpad from database
   * If not found and autoSyncLaunchpad is available, attempt to sync from blockchain
   */
  protected async fetchLaunchpad(contractAddress: string, autoSync: boolean = true) {
    // Ensure launchpad is registered in listener (if callback provided)
    if (this.context.ensureLaunchpadRegistered) {
      await this.context.ensureLaunchpadRegistered(contractAddress);
    }

    let launchpad = await prisma.launchpad.findUnique({
      where: { contractAddress },
      include: {
        metadata: true,
        factory: true
      }
    });

    // If not found and auto-sync is enabled, try to sync from blockchain
    if (!launchpad && autoSync && this.context.autoSyncLaunchpad) {
      console.warn(`⚠️ Launchpad not found in database: ${contractAddress}, attempting auto-sync...`);
      try {
        launchpad = await this.context.autoSyncLaunchpad(contractAddress);
        if (launchpad) {
          console.log(`✅ Launchpad auto-synced: ${contractAddress}`);
        }
      } catch (error) {
        console.error(`❌ Failed to auto-sync launchpad ${contractAddress}:`, error);
      }
    }

    if (!launchpad) {
      console.warn(`⚠️ Launchpad not available: ${contractAddress}`);
      return null;
    }

    return launchpad;
  }

  /**
   * Truncate Ethereum address for display
   */
  protected truncateAddress(address: string): string {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  /**
   * Write activity to database with retry logic
   */
  protected async writeActivityWithRetry(activityData: ActivityData): Promise<void> {
    let attempt = 0;
    const maxRetries = this.context.retryAttempts;

    while (attempt < maxRetries) {
      try {
        await prisma.activity.create({
          data: activityData
        });
        return; // Success
      } catch (error) {
        attempt++;

        if (attempt >= maxRetries) {
          console.error(`❌ Failed to write activity after ${maxRetries} attempts:`, error);
          throw error;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⚠️ Retry attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        await this.sleep(delay);
      }
    }
  }

  /**
   * Upsert activity to database with retry logic
   * Updates if exists (by txHash and type), creates if not exists
   */
  protected async upsertActivityWithRetry(
    activityData: ActivityData,
    launchpadAddress?: string
  ): Promise<void> {
    let attempt = 0;
    const maxRetries = this.context.retryAttempts;

    while (attempt < maxRetries) {
      try {
        // Check if activity already exists
        const whereClause: any = {
          txHash: activityData.txHash,
          type: activityData.type
        };

        // Add launchpad filter if provided
        if (launchpadAddress) {
          whereClause.launchpad = {
            contractAddress: launchpadAddress
          };
        }

        const existing = await prisma.activity.findFirst({
          where: whereClause
        });

        if (existing) {
          // Update existing activity
          await prisma.activity.update({
            where: { id: existing.id },
            data: activityData
          });
          console.log(`🔄 Activity updated: ${activityData.txHash}`);
        } else {
          // Create new activity
          await prisma.activity.create({
            data: activityData
          });
          console.log(`📝 Activity created: ${activityData.txHash}`);
        }
        
        return; // Success
      } catch (error) {
        attempt++;

        if (attempt >= maxRetries) {
          console.error(`❌ Failed to upsert activity after ${maxRetries} attempts:`, error);
          throw error;
        }

        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⚠️ Retry attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        await this.sleep(delay);
      }
    }
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format wei to ETH
   */
  protected formatWeiToEth(wei: bigint): string {
    return (Number(wei) / 1e18).toFixed(4);
  }
}
