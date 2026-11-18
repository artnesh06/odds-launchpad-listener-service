import { Job } from 'bull';
import { MarketplaceEventJob } from '../queue-config';
import { prisma, withRetry, withDbLimit } from '../../../config/database';
import { Marketplace, ListingStatus } from '@prisma/client';

/**
 * Marketplace Event Processor
 * Processes marketplace events (sales, listings, offers)
 */
export class MarketplaceEventProcessor {
  /**
   * Process marketplace event job
   */
  async process(job: Job<MarketplaceEventJob>): Promise<void> {
    const { chainId, marketplace, eventType, contractAddress, tokenId, data, txHash, blockNumber, timestamp } =
      job.data;

    console.log(`🏪 Processing ${eventType} event from ${marketplace}`);

    try {
      await job.progress(20);

      switch (eventType) {
        case 'sale':
          await this.processSale(chainId, marketplace, contractAddress, tokenId, data, txHash, blockNumber, timestamp);
          break;
        case 'listing':
          await this.processListing(chainId, marketplace, contractAddress, tokenId, data, txHash, blockNumber, timestamp);
          break;
        case 'offer':
          await this.processOffer(chainId, marketplace, contractAddress, tokenId, data, txHash, blockNumber, timestamp);
          break;
        case 'cancel':
          await this.processCancel(chainId, marketplace, contractAddress, tokenId, data, txHash, blockNumber);
          break;
        default:
          throw new Error(`Unknown event type: ${eventType}`);
      }

      await job.progress(100);
      console.log(`✅ ${eventType} event processed`);
    } catch (error) {
      console.error(`❌ Error processing marketplace event:`, error);
      throw error;
    }
  }

  /**
   * Process sale event
   */
  private async processSale(
    chainId: number,
    marketplace: string,
    contractAddress: string,
    tokenId: string,
    data: any,
    txHash: string,
    blockNumber: number,
    timestamp: Date
  ): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        // Create sale record
        await prisma.marketplaceSale.create({
          data: {
            chainId,
            marketplace: marketplace as Marketplace,
            contractAddress: contractAddress.toLowerCase(),
            tokenId,
            buyer: data.buyer.toLowerCase(),
            seller: data.seller.toLowerCase(),
            price: data.price,
            currency: data.currency || 'ETH',
            quantity: data.quantity || '1',
            sellerFeeAmount: data.sellerFeeAmount,
            sellerFeeCurrency: data.sellerFeeCurrency,
            protocolFeeAmount: data.protocolFeeAmount,
            protocolFeeCurrency: data.protocolFeeCurrency,
            royaltyFeeAmount: data.royaltyFeeAmount,
            royaltyFeeCurrency: data.royaltyFeeCurrency,
            txHash,
            blockNumber,
            blockTimestamp: timestamp,
            logIndex: data.logIndex || 0,
            bundleIndex: data.bundleIndex || 0,
            taker: data.taker || 'buyer',
          },
        });

        // Update listing if exists
        if (data.listingId) {
          await prisma.marketplaceListing.update({
            where: { id: data.listingId },
            data: {
              status: ListingStatus.SOLD,
              saleTxHash: txHash,
              saleBlock: blockNumber,
            },
          });
        }

        // Update collection analytics
        await this.updateCollectionAnalytics(chainId, contractAddress, data.price);
      });
    });
  }

  /**
   * Process listing event
   */
  private async processListing(
    chainId: number,
    marketplace: string,
    contractAddress: string,
    tokenId: string,
    data: any,
    txHash: string,
    blockNumber: number,
    timestamp: Date
  ): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        await prisma.marketplaceListing.create({
          data: {
            chainId,
            marketplace: marketplace as Marketplace,
            contractAddress: contractAddress.toLowerCase(),
            tokenId,
            seller: data.seller.toLowerCase(),
            price: data.price,
            currency: data.currency || 'ETH',
            quantity: data.quantity || '1',
            startTime: timestamp,
            expirationTime: data.expirationTime ? new Date(data.expirationTime) : null,
            status: ListingStatus.ACTIVE,
            listingTxHash: txHash,
            listingBlock: blockNumber,
          },
        });
      });
    });
  }

  /**
   * Process offer event
   */
  private async processOffer(
    chainId: number,
    marketplace: string,
    contractAddress: string,
    tokenId: string,
    data: any,
    txHash: string,
    blockNumber: number,
    timestamp: Date
  ): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        await prisma.marketplaceOffer.create({
          data: {
            chainId,
            marketplace: marketplace as Marketplace,
            contractAddress: contractAddress.toLowerCase(),
            tokenId,
            offerer: data.offerer.toLowerCase(),
            price: data.price,
            currency: data.currency || 'WETH',
            quantity: data.quantity || '1',
            offerTime: timestamp,
            expirationTime: data.expirationTime ? new Date(data.expirationTime) : null,
            status: 'ACTIVE',
            offerTxHash: txHash,
            offerBlock: blockNumber,
          },
        });
      });
    });
  }

  /**
   * Process cancel event
   */
  private async processCancel(
    chainId: number,
    marketplace: string,
    contractAddress: string,
    tokenId: string,
    data: any,
    txHash: string,
    blockNumber: number
  ): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        // Update listing status
        await prisma.marketplaceListing.updateMany({
          where: {
            chainId,
            marketplace: marketplace as Marketplace,
            contractAddress: contractAddress.toLowerCase(),
            tokenId,
            status: ListingStatus.ACTIVE,
          },
          data: {
            status: ListingStatus.CANCELLED,
            cancelTxHash: txHash,
            cancelBlock: blockNumber,
          },
        });

        // Update offer status
        await prisma.marketplaceOffer.updateMany({
          where: {
            chainId,
            marketplace: marketplace as Marketplace,
            contractAddress: contractAddress.toLowerCase(),
            tokenId,
            status: 'ACTIVE',
          },
          data: {
            status: 'CANCELLED',
            cancelTxHash: txHash,
            cancelBlock: blockNumber,
          },
        });
      });
    });
  }

  /**
   * Update collection analytics
   */
  private async updateCollectionAnalytics(
    chainId: number,
    contractAddress: string,
    salePrice: string
  ): Promise<void> {
    await withDbLimit(async () => {
      const analytics = await prisma.nFTCollectionAnalytics.findUnique({
        where: {
          contractAddress_chainId: {
            contractAddress: contractAddress.toLowerCase(),
            chainId,
          },
        },
      });

      if (analytics) {
        // Update existing analytics
        await prisma.nFTCollectionAnalytics.update({
          where: {
            contractAddress_chainId: {
              contractAddress: contractAddress.toLowerCase(),
              chainId,
            },
          },
          data: {
            totalSales: { increment: 1 },
            sales24h: { increment: 1 },
            lastSalePrice: salePrice,
            calculatedAt: new Date(),
          },
        });
      } else {
        // Create new analytics
        await prisma.nFTCollectionAnalytics.create({
          data: {
            chainId,
            contractAddress: contractAddress.toLowerCase(),
            totalSales: 1,
            sales24h: 1,
            lastSalePrice: salePrice,
          },
        });
      }
    });
  }
}
