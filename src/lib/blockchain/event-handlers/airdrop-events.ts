/**
 * Airdrop Event Handler
 * 
 * Handles batch NFT distribution events (airdrops)
 * 
 * Requirements: 3.1-3.5
 */

import { BaseEventHandler, HandlerContext } from './base-handler';
import { prisma } from '../../../config/database';
import { ActivityType } from '@prisma/client';
import { AlchemyNFTService } from '../../alchemy-nft-service';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Airdrop Event Data
 */
export interface AirdropData {
  chainId: number;
  launchpadAddress: string;
  recipients: string[];
  tokenIds: string[];
  txHash: string;
  blockNumber: number;
  timestamp: Date;
}

// ============================================================================
// Airdrop Event Handler Class
// ============================================================================

/**
 * Airdrop Event Handler
 * Processes batch NFT distribution events
 */
export class AirdropEventHandler extends BaseEventHandler {
  private alchemyService: AlchemyNFTService;

  constructor(context: HandlerContext, alchemyService: AlchemyNFTService) {
    super(context);
    this.alchemyService = alchemyService;
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
   * Validate airdrop data
   */
  protected validateAirdropData(airdropData: AirdropData): void {
    this.validateEventData(airdropData, [
      'chainId',
      'launchpadAddress',
      'recipients',
      'tokenIds',
      'txHash',
      'blockNumber',
      'timestamp'
    ]);

    // Validate arrays are not empty
    if (!Array.isArray(airdropData.recipients) || airdropData.recipients.length === 0) {
      throw new Error('Recipients array is empty or invalid');
    }

    if (!Array.isArray(airdropData.tokenIds) || airdropData.tokenIds.length === 0) {
      throw new Error('TokenIds array is empty or invalid');
    }

    // Validate arrays have matching lengths
    if (airdropData.recipients.length !== airdropData.tokenIds.length) {
      throw new Error(
        `Recipients and tokenIds arrays must have the same length: ${airdropData.recipients.length} vs ${airdropData.tokenIds.length}`
      );
    }
  }

  // ==========================================================================
  // Airdrop Event Handler
  // ==========================================================================

  /**
   * Handle airdrop event
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
   * 
   * Creates batch NFT records for all recipients, creates batch nft_ownership records,
   * creates batch nft_transfers records with transferType MINT, marks all NFTs with isAirdrop=true,
   * creates activity record with type AIRDROP, and updates nft_collection_analytics uniqueHolders
   */
  async handleAirdrop(airdropData: AirdropData): Promise<void> {
    try {
      // Validate event data
      this.validateAirdropData(airdropData);

      console.log(
        `🎁 Processing airdrop event: ${airdropData.launchpadAddress} (${airdropData.recipients.length} recipients)`
      );

      // Normalize address
      const normalizedAddress = airdropData.launchpadAddress.toLowerCase();

      // Fetch launchpad
      const launchpad = await this.fetchLaunchpadWithValidation(normalizedAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${normalizedAddress}`);
      }

      // Check for duplicate activity
      const isDuplicate = await this.isDuplicateActivity(
        airdropData.txHash,
        'AIRDROP_OCCURRED',
        launchpad.id
      );

      if (isDuplicate) {
        console.log(`⚠️ Duplicate airdrop event, skipping: ${airdropData.txHash}`);
        return;
      }

      // Normalize recipient addresses
      const normalizedRecipients = airdropData.recipients.map(addr => addr.toLowerCase());

      // Process in transaction
      await prisma.$transaction(async (tx) => {
        // Fetch or create NFT contract record
        let nftContract = await tx.nFTContract.findUnique({
          where: {
            address_chainId: {
              address: normalizedAddress,
              chainId: this.context.chainId
            }
          }
        });

        if (!nftContract) {
          // Create NFT contract record if it doesn't exist
          nftContract = await tx.nFTContract.create({
            data: {
              address: normalizedAddress,
              chainId: this.context.chainId,
              name: launchpad.name,
              symbol: launchpad.symbol || 'NFT',
              tokenType: 'ERC721', // Default to ERC721
              totalSupply: '0'
            }
          });
        }

        // Create batch NFT records for all recipients (Requirement 3.2)
        const nftRecords = [];
        for (let i = 0; i < airdropData.tokenIds.length; i++) {
          const tokenId = airdropData.tokenIds[i];
          const recipient = normalizedRecipients[i];

          // Check if NFT already exists
          const existingNFT = await tx.nFT.findUnique({
            where: {
              contractAddress_tokenId_chainId: {
                contractAddress: normalizedAddress,
                tokenId: tokenId,
                chainId: this.context.chainId
              }
            }
          });

          if (!existingNFT) {
            const nft = await tx.nFT.create({
              data: {
                contractAddress: normalizedAddress,
                tokenId: tokenId,
                chainId: this.context.chainId,
                tokenType: 'ERC721',
                isAirdrop: true, // Mark as airdrop (Requirement 3.2)
                mintTimestamp: airdropData.timestamp,
                mintBlockNumber: airdropData.blockNumber,
                mintTransactionHash: airdropData.txHash,
                mintAddress: recipient
              }
            });
            nftRecords.push(nft);
          } else {
            // Update existing NFT to mark as airdrop
            await tx.nFT.update({
              where: {
                contractAddress_tokenId_chainId: {
                  contractAddress: normalizedAddress,
                  tokenId: tokenId,
                  chainId: this.context.chainId
                }
              },
              data: {
                isAirdrop: true
              }
            });
            nftRecords.push(existingNFT);
          }
        }

        // Create batch nft_ownership records (Requirement 3.3)
        for (let i = 0; i < nftRecords.length; i++) {
          const nft = nftRecords[i];
          const recipient = normalizedRecipients[i];

          // Mark any existing ownership as not current
          await tx.nFTOwnership.updateMany({
            where: {
              nftId: nft.id,
              isCurrent: true
            },
            data: {
              isCurrent: false
            }
          });

          // Create new ownership record
          await tx.nFTOwnership.create({
            data: {
              nftId: nft.id,
              ownerAddress: recipient,
              acquiredAt: airdropData.timestamp,
              acquiredBlock: airdropData.blockNumber,
              acquiredTxHash: airdropData.txHash,
              isCurrent: true
            }
          });
        }

        // Create batch nft_transfers records with transferType MINT (Requirement 3.4)
        for (let i = 0; i < nftRecords.length; i++) {
          const nft = nftRecords[i];
          const recipient = normalizedRecipients[i];
          const tokenId = airdropData.tokenIds[i];

          await tx.nFTTransfer.create({
            data: {
              chainId: this.context.chainId,
              nftId: nft.id,
              fromAddress: '0x0000000000000000000000000000000000000000', // Zero address for mint
              toAddress: recipient,
              transferType: 'MINT',
              quantity: '1',
              txHash: airdropData.txHash,
              blockNumber: airdropData.blockNumber,
              blockTimestamp: airdropData.timestamp,
              logIndex: i // Use index as logIndex for batch
            }
          });
        }

        // Create activity record with type AIRDROP (Requirement 3.1)
        await tx.activity.create({
          data: {
            chainId: this.context.chainId,
            factoryId: launchpad.factoryId,
            launchpadId: launchpad.id,
            type: 'AIRDROP_OCCURRED',
            actor: launchpad.creator,
            description: `Airdropped ${airdropData.tokenIds.length} NFTs to ${airdropData.recipients.length} recipients`,
            txHash: airdropData.txHash,
            blockNumber: airdropData.blockNumber,
            metadata: {
              recipientCount: airdropData.recipients.length,
              tokenCount: airdropData.tokenIds.length,
              recipients: normalizedRecipients,
              tokenIds: airdropData.tokenIds
            }
          }
        });

        // Update nft_collection_analytics uniqueHolders (Requirement 3.5)
        // Calculate unique holders from current ownership
        const uniqueHoldersResult = await tx.nFTOwnership.findMany({
          where: {
            nft: {
              contractAddress: normalizedAddress,
              chainId: this.context.chainId
            },
            isCurrent: true
          },
          select: {
            ownerAddress: true
          },
          distinct: ['ownerAddress']
        });

        const uniqueHolders = uniqueHoldersResult.length;

        // Upsert collection analytics
        await tx.nFTCollectionAnalytics.upsert({
          where: {
            contractAddress_chainId: {
              contractAddress: normalizedAddress,
              chainId: this.context.chainId
            }
          },
          create: {
            contractAddress: normalizedAddress,
            chainId: this.context.chainId,
            uniqueHolders: uniqueHolders,
            totalSupply: nftRecords.length,
            totalVolume: '0',
            floorPrice: null,
            calculatedAt: new Date()
          },
          update: {
            uniqueHolders: uniqueHolders,
            calculatedAt: new Date()
          }
        });
      });

      console.log(
        `✅ Airdrop processed: ${airdropData.tokenIds.length} NFTs to ${airdropData.recipients.length} recipients for ${this.truncateAddress(normalizedAddress)}`
      );
    } catch (error) {
      await this.logEventError('handleAirdrop', error, airdropData);
      throw error;
    }
  }
}
