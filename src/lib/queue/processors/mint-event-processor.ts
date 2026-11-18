import { Job } from 'bull';
import { MintEventJob } from '../queue-config';
import { prisma, withRetry, withDbLimit } from '../../../config/database';
import { ActivityType } from '@prisma/client';
import { AlchemyNFTService } from '../../alchemy-nft-service';
import { AlchemySpamDetector } from '../../alchemy-spam-detector';
import { EventEmitter } from '../../websocket/event-emitter';
import { ethers } from 'ethers';

/**
 * Mint Event Processor
 * Processes mint events from the queue
 */
export class MintEventProcessor {
  private alchemyService?: AlchemyNFTService;
  private spamDetector?: AlchemySpamDetector;
  private eventEmitter?: EventEmitter;

  constructor(
    alchemyService?: AlchemyNFTService,
    spamDetector?: AlchemySpamDetector,
    eventEmitter?: EventEmitter
  ) {
    this.alchemyService = alchemyService;
    this.spamDetector = spamDetector;
    this.eventEmitter = eventEmitter;
  }

  /**
   * Process a mint event job
   */
  async process(job: Job<MintEventJob>): Promise<void> {
    const { chainId, launchpadAddress, from, to, tokenId, txHash, blockNumber, logIndex, timestamp } =
      job.data;

    console.log(
      `🎨 Processing mint: Chain ${chainId}, Launchpad ${launchpadAddress}, Token ${tokenId}`
    );

    try {
      // Update job progress
      await job.progress(10);

      // Check for duplicate (only skip if BOTH activity AND NFT exist)
      const isDuplicate = await this.checkDuplicate(chainId, txHash, tokenId, launchpadAddress);
      if (isDuplicate) {
        console.log(`⏭️ Skipping duplicate mint: ${txHash}-${tokenId} (both activity and NFT exist)`);
        return;
      }

      await job.progress(20);

      // Get launchpad info
      const launchpad = await this.getLaunchpadInfo(chainId, launchpadAddress);
      if (!launchpad) {
        throw new Error(`Launchpad not found: ${launchpadAddress}`);
      }

      await job.progress(30);

      // Check if NFT already exists
      const existingNFT = await withDbLimit(async () => {
        return prisma.nFT.findUnique({
          where: {
            contractAddress_tokenId_chainId: {
              contractAddress: launchpadAddress.toLowerCase(),
              tokenId,
              chainId,
            },
          },
        });
      });

      // Create NFT record only if it doesn't exist
      let nft = existingNFT;
      if (!existingNFT) {
        nft = await this.createNFTRecord(
          chainId,
          launchpadAddress,
          tokenId,
          to,
          txHash,
          blockNumber,
          timestamp
        );
        console.log(`✅ NFT record CREATED for token #${tokenId}`);
      } else {
        console.log(`ℹ️ NFT record already exists for token #${tokenId}, skipping NFT creation`);
      }

      await job.progress(50);

      // Fetch metadata if Alchemy is available and NFT exists
      if (this.alchemyService && nft) {
        await this.fetchAndStoreMetadata(nft.id, chainId, launchpadAddress, tokenId);
      }

      await job.progress(70);

      // Check if activity already exists
      const existingActivity = await withDbLimit(async () => {
        return prisma.activity.findFirst({
          where: {
            chainId,
            txHash,
            type: ActivityType.MINT_OCCURRED,
            launchpadId: launchpad.id,
            metadata: {
              path: ['tokenId'],
              equals: tokenId,
            },
          },
        });
      });

      // Create activity record only if it doesn't exist
      if (!existingActivity) {
        await this.createActivityRecord(
          chainId,
          launchpad.id,
          launchpadAddress,
          to,
          tokenId,
          txHash,
          blockNumber
        );
        console.log(`✅ Activity record CREATED for token #${tokenId}`);
      } else {
        console.log(`ℹ️ Activity record already exists for token #${tokenId}, skipping activity creation`);
      }

      await job.progress(90);

      // Get active phase price for volume calculation
      const activePhase = await this.getActivePhasePrice(launchpad.id, timestamp);
      const mintPrice = activePhase?.price || '0';

      // Create mint record in mints table (has its own duplicate check)
      const mintResult = await this.createMintRecord(
        launchpad.id,
        to,
        tokenId,
        txHash,
        blockNumber,
        mintPrice // Pass the actual mint price from active phase
      );

      // Only update stats if this is a NEW mint record (not duplicate)
      if (mintResult.isNew) {
        // Update active phase if exists
        await this.updateActivePhase(launchpad.id, timestamp);

        // Update launchpad stats
        await this.updateLaunchpadStats(launchpad.id, mintResult.price);

        // Update factory stats
        await this.updateFactoryStats(launchpad.factoryId);

        // Update launchpad analytics
        await this.updateLaunchpadAnalytics(launchpad.id, mintResult.price);
      } else {
        console.log(`ℹ️ Skipping stats update for duplicate mint token #${tokenId}`);
      }

      // Update NFT contract stats (always update - counts unique NFTs)
      await this.updateNFTContractStats(chainId, launchpadAddress);

      // Update NFT collection analytics (always update - counts unique holders)
      await this.updateNFTCollectionAnalytics(chainId, launchpadAddress);

      // Emit WebSocket event
      if (this.eventEmitter) {
        await this.emitMintEvent(chainId, launchpadAddress, to, tokenId, txHash);
      }

      await job.progress(100);

      console.log(`✅ Mint processed: Token ${tokenId} minted to ${to}`);
    } catch (error) {
      console.error(`❌ Error processing mint event:`, error);
      throw error; // Let Bull handle retry
    }
  }

  /**
   * Check if mint already exists
   * Returns true only if BOTH activity AND NFT record exist
   */
  private async checkDuplicate(
    chainId: number,
    txHash: string,
    tokenId: string,
    launchpadAddress: string
  ): Promise<boolean> {
    return withDbLimit(async () => {
      // Check if activity exists
      const existingActivity = await prisma.activity.findFirst({
        where: {
          chainId,
          txHash,
          type: ActivityType.MINT_OCCURRED,
          launchpadId: launchpadAddress,
          metadata: {
            path: ['tokenId'],
            equals: tokenId,
          },
        },
      });

      // Check if NFT record exists
      const existingNFT = await prisma.nFT.findUnique({
        where: {
          contractAddress_tokenId_chainId: {
            contractAddress: launchpadAddress.toLowerCase(),
            tokenId,
            chainId,
          },
        },
      });

      // Only skip if BOTH exist
      const shouldSkip = !!existingActivity && !!existingNFT;
      
      if (existingActivity && !existingNFT) {
        console.log(`⚠️ Activity exists but NFT missing for token #${tokenId}, will create NFT record`);
      }

      return shouldSkip;
    });
  }

  /**
   * Get launchpad information
   */
  private async getLaunchpadInfo(chainId: number, address: string) {
    return withDbLimit(async () => {
      return prisma.launchpad.findUnique({
        where: {
          contractAddress: address.toLowerCase(),
        },
        select: {
          id: true,
          name: true,
          symbol: true,
          factoryId: true,
        },
      });
    });
  }

  /**
   * Create NFT record
   */
  private async createNFTRecord(
    chainId: number,
    contractAddress: string,
    tokenId: string,
    owner: string,
    txHash: string,
    blockNumber: number,
    timestamp: Date
  ) {
    return withRetry(async () => {
      return withDbLimit(async () => {
        // Upsert NFT
        const nft = await prisma.nFT.upsert({
          where: {
            contractAddress_tokenId_chainId: {
              contractAddress: contractAddress.toLowerCase(),
              tokenId,
              chainId,
            },
          },
          create: {
            chainId,
            contractAddress: contractAddress.toLowerCase(),
            tokenId,
            tokenType: 'ERC721',
            mintAddress: owner.toLowerCase(),
            mintBlockNumber: blockNumber,
            mintTimestamp: timestamp,
            mintTransactionHash: txHash,
            timeLastUpdated: timestamp,
          },
          update: {
            timeLastUpdated: timestamp,
          },
        });

        console.log(`✅ NFT record UPSERTED for token #${tokenId} (nftId: ${nft.id})`);

        // Create ownership record (with duplicate check)
        try {
          const existingOwnership = await prisma.nFTOwnership.findFirst({
            where: {
              nftId: nft.id,
              ownerAddress: owner.toLowerCase(),
              isCurrent: true,
            },
          });

          if (!existingOwnership) {
            await prisma.nFTOwnership.create({
              data: {
                nftId: nft.id,
                ownerAddress: owner.toLowerCase(),
                balance: '1',
                acquiredAt: timestamp,
                acquiredBlock: blockNumber,
                acquiredTxHash: txHash,
                isCurrent: true,
              },
            });
            console.log(`✅ NFT ownership record CREATED for token #${tokenId}`);
          } else {
            console.log(`ℹ️ NFT ownership already exists for token #${tokenId}`);
          }
        } catch (ownershipError: any) {
          // Log but don't throw - NFT record is more important
          console.warn(`⚠️ Failed to create ownership for token #${tokenId}:`, ownershipError.message);
        }

        // Create transfer record (with duplicate check)
        try {
          // Check if transfer already exists for this tx
          const existingTransfer = await prisma.nFTTransfer.findFirst({
            where: {
              nftId: nft.id,
              txHash,
              transferType: 'MINT',
            },
          });

          if (!existingTransfer) {
            await prisma.nFTTransfer.create({
              data: {
                chainId,
                nftId: nft.id,
                fromAddress: '0x0000000000000000000000000000000000000000',
                toAddress: owner.toLowerCase(),
                quantity: '1',
                txHash,
                blockNumber,
                blockTimestamp: timestamp,
                logIndex: 0,
                transferType: 'MINT',
              },
            });
            console.log(`✅ NFT transfer record CREATED for token #${tokenId}`);
          } else {
            console.log(`ℹ️ NFT transfer already exists for token #${tokenId}`);
          }
        } catch (transferError: any) {
          // Log but don't throw - NFT record is more important
          console.warn(`⚠️ Failed to create transfer for token #${tokenId}:`, transferError.message);
        }

        return nft;
      });
    });
  }

  /**
   * Fetch and store metadata
   */
  private async fetchAndStoreMetadata(
    nftId: string,
    chainId: number,
    contractAddress: string,
    tokenId: string
  ): Promise<void> {
    if (!this.alchemyService) return;

    try {
      const metadata = await this.alchemyService.getNFTMetadata(contractAddress, tokenId);

      if (metadata) {
        await withDbLimit(async () => {
          await prisma.nFT.update({
            where: { id: nftId },
            data: {
              name: metadata.name,
              description: metadata.description,
              tokenUri: metadata.tokenUri,
              imageCachedUrl: metadata.image?.cachedUrl,
              imageThumbnailUrl: metadata.image?.thumbnailUrl,
              imagePngUrl: metadata.image?.pngUrl,
              imageContentType: metadata.image?.contentType,
              imageSize: metadata.image?.size,
              imageOriginalUrl: metadata.image?.originalUrl,
              rawMetadata: metadata.raw as any,
            },
          });

          // Store attributes
          if (metadata.raw && (metadata.raw as any).attributes && Array.isArray((metadata.raw as any).attributes)) {
            await prisma.nFTAttribute.createMany({
              data: (metadata.raw as any).attributes.map((attr: any) => ({
                nftId,
                traitType: attr.trait_type,
                value: attr.value,
                displayType: attr.display_type,
              })),
              skipDuplicates: true,
            });
          }
        });
      }

      // Check for spam
      if (this.spamDetector) {
        const isSpam = await (this.spamDetector as any).isSpam?.(contractAddress, tokenId) || false;
        if (isSpam) {
          await withDbLimit(async () => {
            await prisma.nFT.update({
              where: { id: nftId },
              data: { isSpam: true },
            });
          });
        }
      }
    } catch (error) {
      console.error(`⚠️ Failed to fetch metadata for ${contractAddress}:${tokenId}:`, error);
      // Don't throw - metadata fetch is not critical
    }
  }

  /**
   * Create activity record
   */
  private async createActivityRecord(
    chainId: number,
    factoryId: string,
    launchpadId: string,
    minter: string,
    tokenId: string,
    txHash: string,
    blockNumber: number
  ): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        // Fetch NFT image to include in activity metadata
        const nft = await prisma.nFT.findUnique({
          where: {
            contractAddress_tokenId_chainId: {
              contractAddress: launchpadId.toLowerCase(),
              tokenId,
              chainId,
            },
          },
          select: {
            imageCachedUrl: true,
            imageOriginalUrl: true,
            imageThumbnailUrl: true,
          },
        });

        // Use NFT image (prioritize cached, then thumbnail, then original)
        const tokenImage = nft?.imageCachedUrl || nft?.imageThumbnailUrl || nft?.imageOriginalUrl || null;

        await prisma.activity.create({
          data: {
            chainId,
            factoryId,
            launchpadId,
            type: ActivityType.MINT_OCCURRED,
            actor: minter.toLowerCase(),
            description: `Minted token #${tokenId}`,
            txHash,
            blockNumber,
            metadata: {
              tokenId,
              minter: minter.toLowerCase(),
              tokenImage, // Add NFT individual image
              originalImage: nft?.imageOriginalUrl || null, // Add original IPFS URL
            },
          },
        });
      });
    });
  }

  /**
   * Update launchpad statistics
   */
  private async updateLaunchpadStats(launchpadId: string, mintPrice: string): Promise<void> {
    await withDbLimit(async () => {
      const currentVolume = await prisma.launchpad.findUnique({
        where: { id: launchpadId },
        select: { volume: true }
      });

      // Safe BigInt conversion - handle decimal format
      let mintPriceBigInt: bigint;
      try {
        if (mintPrice.includes('.')) {
          console.warn(`⚠️ Mint price in decimal format (${mintPrice}), converting to wei`);
          mintPriceBigInt = BigInt(ethers.parseEther(mintPrice).toString());
        } else {
          mintPriceBigInt = BigInt(mintPrice);
        }
      } catch (error) {
        console.error(`❌ Failed to convert mint price "${mintPrice}" to BigInt:`, error);
        mintPriceBigInt = BigInt(0);
      }

      const newVolume = (BigInt(currentVolume?.volume || '0') + mintPriceBigInt).toString();

      await prisma.launchpad.update({
        where: { id: launchpadId },
        data: {
          mintedCount: { increment: 1 },
          volume: newVolume,
          lastMintAt: new Date(),
        },
      });
    });
  }

  /**
   * Get active phase price at the time of mint
   * Returns the price from the active phase, excluding platform fee
   */
  private async getActivePhasePrice(launchpadId: string, timestamp: Date): Promise<{ price: string } | null> {
    return await withDbLimit(async () => {
      const activePhase = await prisma.launchpadPhase.findFirst({
        where: {
          launchpadId,
          isActive: true,
          startTime: { lte: timestamp },
          OR: [
            { endTime: null },
            { endTime: { gte: timestamp } }
          ]
        },
        select: { price: true },
        orderBy: { phaseIndex: 'asc' }
      });

      return activePhase;
    });
  }

  /**
   * Update active phase mint count
   */
  private async updateActivePhase(launchpadId: string, timestamp: Date): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        // Find active phase at the time of mint
        const activePhase = await prisma.launchpadPhase.findFirst({
          where: {
            launchpadId,
            isActive: true,
            startTime: { lte: timestamp },
            OR: [
              { endTime: null },
              { endTime: { gte: timestamp } }
            ]
          },
          orderBy: { phaseIndex: 'asc' }
        });

        if (activePhase) {
          await prisma.launchpadPhase.update({
            where: { id: activePhase.id },
            data: {
              mintedCount: { increment: 1 },
              updatedAt: new Date()
            }
          });
          console.log(`✅ Phase ${activePhase.name} mint count UPDATED`);
        } else {
          console.log(`ℹ️ No active phase found for launchpad ${launchpadId}`);
        }
      });
    });
  }

  /**
   * Update factory statistics
   */
  private async updateFactoryStats(factoryId: string): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        // Count total launchpads for this factory
        const totalLaunchpads = await prisma.launchpad.count({
          where: { factoryId }
        });

        await prisma.launchpadFactory.update({
          where: { id: factoryId },
          data: {
            totalLaunchpads,
            updatedAt: new Date()
          }
        });
        console.log(`✅ Factory stats UPDATED for factory ${factoryId}`);
      });
    });
  }

  /**
   * Create mint record in mints table
   */
  private async createMintRecord(
    launchpadId: string,
    minter: string,
    tokenId: string,
    txHash: string,
    blockNumber: number,
    price: string = '0'
  ): Promise<{ price: string; isNew: boolean }> {
    return await withRetry(async () => {
      return await withDbLimit(async () => {
        // Check if mint record already exists for this specific tokenId
        const existingMint = await prisma.mint.findUnique({
          where: { 
            launchpadId_tokenId: {
              launchpadId,
              tokenId: parseInt(tokenId)
            }
          }
        });

        if (!existingMint) {
          try {
            await prisma.mint.create({
              data: {
                launchpadId,
                minter: minter.toLowerCase(),
                tokenId: parseInt(tokenId),
                quantity: 1,
                price,
                txHash,
                blockNumber,
                createdAt: new Date()
              }
            });
            console.log(`✅ Mint record INSERTED in mints table for token #${tokenId}`);
            return { price, isNew: true };
          } catch (createError: any) {
            // Handle race condition where another process created the record
            if (createError.code === 'P2002') {
              console.log(`ℹ️ Mint record already exists (constraint) for token #${tokenId}`);
              return { price, isNew: false };
            }
            throw createError;
          }
        } else {
          console.log(`ℹ️ Mint record already exists for token #${tokenId}`);
          return { price, isNew: false };
        }
      });
    });
  }

  /**
   * Emit WebSocket event
   */
  private async emitMintEvent(
    chainId: number,
    launchpadAddress: string,
    minter: string,
    tokenId: string,
    txHash: string
  ): Promise<void> {
    if (!this.eventEmitter) return;

    try {
      // Fetch NFT image to include in the event
      const nft = await withDbLimit(async () => {
        return prisma.nFT.findUnique({
          where: {
            contractAddress_tokenId_chainId: {
              contractAddress: launchpadAddress.toLowerCase(),
              tokenId,
              chainId,
            },
          },
          select: {
            imageCachedUrl: true,
            imageOriginalUrl: true,
            imageThumbnailUrl: true,
          },
        });
      });

      // Use NFT image (prioritize cached, then thumbnail, then original)
      const imageUrl = nft?.imageCachedUrl || nft?.imageThumbnailUrl || nft?.imageOriginalUrl || undefined;

      await this.eventEmitter.emitMintEvent({
        chainId,
        contractAddress: launchpadAddress,
        minter,
        tokenId,
        transactionHash: txHash,
        quantity: 1,
        timestamp: new Date(),
        imageUrl, // Include NFT image URL
      });
    } catch (error) {
      console.error('⚠️ Failed to emit WebSocket event:', error);
      // Don't throw - WebSocket emit is not critical
    }
  }

  /**
   * Update launchpad analytics
   */
  private async updateLaunchpadAnalytics(launchpadId: string, mintPrice: string): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        const analytics = await prisma.launchpadAnalytics.findUnique({
          where: { launchpadId }
        });

        if (analytics) {
          // Calculate new average mint price
          const currentTotalVolume = BigInt(analytics.totalVolume);
          const currentTotalMints = analytics.totalMints;
          
          // Safe BigInt conversion for mintPrice
          let mintPriceBigInt: bigint;
          try {
            if (mintPrice.includes('.')) {
              console.warn(`⚠️ Mint price in decimal format (${mintPrice}), converting to wei`);
              mintPriceBigInt = BigInt(ethers.parseEther(mintPrice).toString());
            } else {
              mintPriceBigInt = BigInt(mintPrice);
            }
          } catch (error) {
            console.error(`❌ Failed to convert mint price "${mintPrice}" to BigInt:`, error);
            mintPriceBigInt = BigInt(0);
          }
          
          const newTotalVolume = currentTotalVolume + mintPriceBigInt;
          const newTotalMints = currentTotalMints + 1;
          const newAvgMintPrice = newTotalMints > 0 
            ? (newTotalVolume / BigInt(newTotalMints)).toString()
            : '0';

          await prisma.launchpadAnalytics.update({
            where: { launchpadId },
            data: {
              totalVolume: newTotalVolume.toString(),
              totalMints: newTotalMints,
              avgMintPrice: newAvgMintPrice,
              lastSalePrice: mintPrice,
              calculatedAt: new Date(),
            }
          });
          console.log(`✅ Launchpad analytics UPDATED for launchpad ${launchpadId}`);
        } else {
          // Create new analytics
          await prisma.launchpadAnalytics.create({
            data: {
              launchpadId,
              totalVolume: mintPrice,
              totalMints: 1,
              avgMintPrice: mintPrice,
              lastSalePrice: mintPrice,
              uniqueHolders: 0, // Will be calculated separately
              calculatedAt: new Date(),
            }
          });
          console.log(`✅ Launchpad analytics CREATED for launchpad ${launchpadId}`);
        }
      });
    });
  }

  /**
   * Update NFT contract statistics
   */
  private async updateNFTContractStats(chainId: number, contractAddress: string): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        const contract = await prisma.nFTContract.findUnique({
          where: {
            address_chainId: {
              address: contractAddress.toLowerCase(),
              chainId
            }
          }
        });

        if (contract) {
          const currentSupply = BigInt(contract.totalSupply || '0');
          const newSupply = (currentSupply + BigInt(1)).toString();

          await prisma.nFTContract.update({
            where: {
              address_chainId: {
                address: contractAddress.toLowerCase(),
                chainId
              }
            },
            data: {
              totalSupply: newSupply,
              updatedAt: new Date()
            }
          });
          console.log(`✅ NFT contract stats UPDATED for ${contractAddress}`);
        } else {
          // Create new contract record if not exists
          await prisma.nFTContract.create({
            data: {
              chainId,
              address: contractAddress.toLowerCase(),
              totalSupply: '1',
              tokenType: 'ERC721'
            }
          });
          console.log(`✅ NFT contract CREATED for ${contractAddress}`);
        }
      });
    });
  }

  /**
   * Update NFT collection analytics
   */
  private async updateNFTCollectionAnalytics(chainId: number, contractAddress: string): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        const analytics = await prisma.nFTCollectionAnalytics.findUnique({
          where: {
            contractAddress_chainId: {
              contractAddress: contractAddress.toLowerCase(),
              chainId
            }
          }
        });

        if (analytics) {
          await prisma.nFTCollectionAnalytics.update({
            where: {
              contractAddress_chainId: {
                contractAddress: contractAddress.toLowerCase(),
                chainId
              }
            },
            data: {
              totalSupply: { increment: 1 },
              calculatedAt: new Date(),
              updatedAt: new Date()
            }
          });
          console.log(`✅ NFT collection analytics UPDATED for ${contractAddress}`);
        } else {
          // Create new analytics if not exists
          await prisma.nFTCollectionAnalytics.create({
            data: {
              chainId,
              contractAddress: contractAddress.toLowerCase(),
              totalSupply: 1,
              calculatedAt: new Date()
            }
          });
          console.log(`✅ NFT collection analytics CREATED for ${contractAddress}`);
        }
      });
    });
  }
}
