/**
 * Marketplace Event Handlers
 * 
 * Handles marketplace events from various NFT marketplaces:
 * - Sale events (OrderFulfilled, OrdersMatched, TakerAsk/Bid, BuyListing)
 * - Listing events
 * - Offer events
 * - Cancellation events
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import { prisma } from '../../../config/database';
import { Marketplace, ListingStatus, OfferStatus } from '@prisma/client';
import { BaseEventHandler, HandlerContext } from './base-handler';
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

// Event data interfaces

export interface SaleEventData {
  chainId: number;
  marketplace: Marketplace;
  contractAddress: string;
  tokenId: string;
  buyer: string;
  seller: string;
  price: string;
  currency: string;
  quantity?: string;
  fees?: {
    sellerFee?: { amount: string; currency: string };
    protocolFee?: { amount: string; currency: string };
    royaltyFee?: { amount: string; currency: string };
  };
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  logIndex: number;
  bundleIndex?: number;
  taker: 'buyer' | 'seller';
}

export interface ListingEventData {
  chainId: number;
  marketplace: Marketplace;
  contractAddress: string;
  tokenId: string;
  seller: string;
  price: string;
  currency: string;
  quantity?: string;
  startTime: Date;
  endTime?: Date;
  expirationTime?: Date;
  txHash: string;
  blockNumber: number;
}

export interface OfferEventData {
  chainId: number;
  marketplace: Marketplace;
  contractAddress: string;
  tokenId: string;
  offerer: string;
  price: string;
  currency: string;
  quantity?: string;
  offerTime: Date;
  expirationTime?: Date;
  txHash: string;
  blockNumber: number;
}

export interface CancellationEventData {
  chainId: number;
  marketplace: Marketplace;
  orderHash?: string;
  contractAddress?: string;
  tokenId?: string;
  seller?: string;
  offerer?: string;
  txHash: string;
  blockNumber: number;
  type: 'listing' | 'offer';
}

/**
 * Marketplace Event Handler
 * Processes marketplace events and updates database
 */
export class MarketplaceEventHandler extends BaseEventHandler {
  constructor(context: HandlerContext) {
    super(context);
  }

  /**
   * Handle sale event
   * Requirements: 4.2, 4.4, 12.1, 12.2, 12.3, 12.4, 12.5
   * Property 16: Complete Sale Data Storage
   * Property 12: Marketplace Sale Ownership Transfer
   */
  async handleSaleEvent(saleData: SaleEventData): Promise<void> {
    try {
      // Validate required fields
      this.validateEventData(saleData, [
        'chainId',
        'marketplace',
        'contractAddress',
        'tokenId',
        'buyer',
        'seller',
        'price',
        'currency',
        'txHash',
        'blockNumber',
        'blockTimestamp',
        'logIndex',
        'taker'
      ]);

      console.log(
        `💰 Processing sale: ${saleData.marketplace} - ${saleData.contractAddress} #${saleData.tokenId}`
      );

      // Ensure NFT contract exists
      await this.ensureNFTContract(saleData.chainId, saleData.contractAddress);

      // Check for duplicate sale
      const existingSale = await prisma.marketplaceSale.findUnique({
        where: {
          txHash_logIndex_bundleIndex: {
            txHash: saleData.txHash,
            logIndex: saleData.logIndex,
            bundleIndex: saleData.bundleIndex || 0
          }
        }
      });

      if (existingSale) {
        console.log(`⚠️ Sale already recorded: ${saleData.txHash}:${saleData.logIndex}`);
        return;
      }

      // Process all database operations in a transaction
      await prisma.$transaction(async (tx) => {
        // Find associated listing if exists
        const listing = await tx.marketplaceListing.findFirst({
          where: {
            chainId: saleData.chainId,
            marketplace: saleData.marketplace,
            contractAddress: saleData.contractAddress.toLowerCase(),
            tokenId: saleData.tokenId,
            seller: saleData.seller.toLowerCase(),
            status: ListingStatus.ACTIVE
          },
          orderBy: {
            createdAt: 'desc'
          }
        });

        // Create sale record with all required fields
        const sale = await tx.marketplaceSale.create({
          data: {
            chainId: saleData.chainId,
            marketplace: saleData.marketplace,
            contractAddress: saleData.contractAddress.toLowerCase(),
            tokenId: saleData.tokenId,
            buyer: saleData.buyer.toLowerCase(),
            seller: saleData.seller.toLowerCase(),
            price: saleData.price,
            currency: saleData.currency,
            quantity: saleData.quantity || '1',
            sellerFeeAmount: saleData.fees?.sellerFee?.amount,
            sellerFeeCurrency: saleData.fees?.sellerFee?.currency,
            protocolFeeAmount: saleData.fees?.protocolFee?.amount,
            protocolFeeCurrency: saleData.fees?.protocolFee?.currency,
            royaltyFeeAmount: saleData.fees?.royaltyFee?.amount,
            royaltyFeeCurrency: saleData.fees?.royaltyFee?.currency,
            txHash: saleData.txHash,
            blockNumber: saleData.blockNumber,
            blockTimestamp: saleData.blockTimestamp,
            logIndex: saleData.logIndex,
            bundleIndex: saleData.bundleIndex || 0,
            taker: saleData.taker,
            listingId: listing?.id
          }
        });

        // Update listing status to SOLD if listing exists
        if (listing) {
          await tx.marketplaceListing.update({
            where: { id: listing.id },
            data: {
              status: ListingStatus.SOLD,
              saleTxHash: saleData.txHash,
              saleBlock: saleData.blockNumber
            }
          });
          console.log(`✅ Updated listing ${listing.id} to SOLD`);
        }

        // Update ownership on sale (Requirements 12.1, 12.2)
        await this.updateOwnershipOnSale(tx, saleData);

        // Create transfer record for sale (Requirement 12.3)
        await this.createSaleTransferRecord(tx, saleData);

        // Update analytics with sale data (Requirements 12.4, 12.5)
        await this.updateAnalyticsWithSale(tx, saleData);
      });

      console.log(
        `✅ Sale recorded: ${saleData.marketplace} - ${this.truncateAddress(saleData.buyer)} bought #${saleData.tokenId} for ${this.formatPrice(saleData.price)} ${saleData.currency}`
      );

    } catch (error) {
      await this.logEventError('MarketplaceSale', error, saleData);
      throw error;
    }
  }

  /**
   * Handle listing event
   * Requirements: 4.1, 4.4
   * Property 15: Complete Listing Data Storage
   */
  async handleListingEvent(listingData: ListingEventData): Promise<void> {
    try {
      // Validate required fields
      this.validateEventData(listingData, [
        'chainId',
        'marketplace',
        'contractAddress',
        'tokenId',
        'seller',
        'price',
        'currency',
        'startTime',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `📝 Processing listing: ${listingData.marketplace} - ${listingData.contractAddress} #${listingData.tokenId}`
      );

      // Ensure NFT contract exists
      await this.ensureNFTContract(listingData.chainId, listingData.contractAddress);

      // Check for existing active listing
      const existingListing = await prisma.marketplaceListing.findFirst({
        where: {
          chainId: listingData.chainId,
          marketplace: listingData.marketplace,
          contractAddress: listingData.contractAddress.toLowerCase(),
          tokenId: listingData.tokenId,
          seller: listingData.seller.toLowerCase(),
          status: ListingStatus.ACTIVE
        }
      });

      if (existingListing) {
        console.log(`⚠️ Active listing already exists for ${listingData.contractAddress} #${listingData.tokenId}`);
        return;
      }

      // Create listing record with all required fields
      await prisma.marketplaceListing.create({
        data: {
          chainId: listingData.chainId,
          marketplace: listingData.marketplace,
          contractAddress: listingData.contractAddress.toLowerCase(),
          tokenId: listingData.tokenId,
          seller: listingData.seller.toLowerCase(),
          price: listingData.price,
          currency: listingData.currency,
          quantity: listingData.quantity || '1',
          startTime: listingData.startTime,
          endTime: listingData.endTime,
          expirationTime: listingData.expirationTime,
          status: ListingStatus.ACTIVE,
          listingTxHash: listingData.txHash,
          listingBlock: listingData.blockNumber
        }
      });

      console.log(
        `✅ Listing created: ${listingData.marketplace} - ${this.truncateAddress(listingData.seller)} listed #${listingData.tokenId} for ${this.formatPrice(listingData.price)} ${listingData.currency}`
      );

    } catch (error) {
      await this.logEventError('MarketplaceListing', error, listingData);
      throw error;
    }
  }

  /**
   * Handle offer event
   * Requirements: 4.3, 4.4
   * Property 17: Complete Offer Data Storage
   */
  async handleOfferEvent(offerData: OfferEventData): Promise<void> {
    try {
      // Validate required fields
      this.validateEventData(offerData, [
        'chainId',
        'marketplace',
        'contractAddress',
        'tokenId',
        'offerer',
        'price',
        'currency',
        'offerTime',
        'txHash',
        'blockNumber'
      ]);

      console.log(
        `💵 Processing offer: ${offerData.marketplace} - ${offerData.contractAddress} #${offerData.tokenId}`
      );

      // Check for existing active offer
      const existingOffer = await prisma.marketplaceOffer.findFirst({
        where: {
          chainId: offerData.chainId,
          marketplace: offerData.marketplace,
          contractAddress: offerData.contractAddress.toLowerCase(),
          tokenId: offerData.tokenId,
          offerer: offerData.offerer.toLowerCase(),
          status: OfferStatus.ACTIVE
        }
      });

      if (existingOffer) {
        console.log(`⚠️ Active offer already exists for ${offerData.contractAddress} #${offerData.tokenId}`);
        return;
      }

      // Create offer record with all required fields
      await prisma.marketplaceOffer.create({
        data: {
          chainId: offerData.chainId,
          marketplace: offerData.marketplace,
          contractAddress: offerData.contractAddress.toLowerCase(),
          tokenId: offerData.tokenId,
          offerer: offerData.offerer.toLowerCase(),
          price: offerData.price,
          currency: offerData.currency,
          quantity: offerData.quantity || '1',
          offerTime: offerData.offerTime,
          expirationTime: offerData.expirationTime,
          status: OfferStatus.ACTIVE,
          offerTxHash: offerData.txHash,
          offerBlock: offerData.blockNumber
        }
      });

      console.log(
        `✅ Offer created: ${offerData.marketplace} - ${this.truncateAddress(offerData.offerer)} offered ${this.formatPrice(offerData.price)} ${offerData.currency} for #${offerData.tokenId}`
      );

    } catch (error) {
      await this.logEventError('MarketplaceOffer', error, offerData);
      throw error;
    }
  }

  /**
   * Handle cancellation event
   * Requirements: 4.4
   * Property 18: Cancellation Status Update
   */
  async handleCancellationEvent(cancellationData: CancellationEventData): Promise<void> {
    try {
      // Validate required fields
      this.validateEventData(cancellationData, [
        'chainId',
        'marketplace',
        'txHash',
        'blockNumber',
        'type'
      ]);

      console.log(
        `❌ Processing cancellation: ${cancellationData.marketplace} - ${cancellationData.type}`
      );

      if (cancellationData.type === 'listing') {
        await this.handleListingCancellation(cancellationData);
      } else if (cancellationData.type === 'offer') {
        await this.handleOfferCancellation(cancellationData);
      }

    } catch (error) {
      await this.logEventError('MarketplaceCancellation', error, cancellationData);
      throw error;
    }
  }

  /**
   * Handle listing cancellation
   */
  private async handleListingCancellation(cancellationData: CancellationEventData): Promise<void> {
    // Find active listing to cancel
    const whereClause: any = {
      chainId: cancellationData.chainId,
      marketplace: cancellationData.marketplace,
      status: ListingStatus.ACTIVE
    };

    if (cancellationData.contractAddress && cancellationData.tokenId) {
      whereClause.contractAddress = cancellationData.contractAddress.toLowerCase();
      whereClause.tokenId = cancellationData.tokenId;
    }

    if (cancellationData.seller) {
      whereClause.seller = cancellationData.seller.toLowerCase();
    }

    const listings = await prisma.marketplaceListing.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });

    if (listings.length === 0) {
      console.log(`⚠️ No active listing found to cancel`);
      return;
    }

    // Update all matching listings to CANCELLED
    const updatePromises = listings.map(listing =>
      prisma.marketplaceListing.update({
        where: { id: listing.id },
        data: {
          status: ListingStatus.CANCELLED,
          cancelTxHash: cancellationData.txHash,
          cancelBlock: cancellationData.blockNumber
        }
      })
    );

    await Promise.all(updatePromises);

    console.log(
      `✅ Cancelled ${listings.length} listing(s): ${cancellationData.marketplace}`
    );
  }

  /**
   * Handle offer cancellation
   */
  private async handleOfferCancellation(cancellationData: CancellationEventData): Promise<void> {
    // Find active offer to cancel
    const whereClause: any = {
      chainId: cancellationData.chainId,
      marketplace: cancellationData.marketplace,
      status: OfferStatus.ACTIVE
    };

    if (cancellationData.contractAddress && cancellationData.tokenId) {
      whereClause.contractAddress = cancellationData.contractAddress.toLowerCase();
      whereClause.tokenId = cancellationData.tokenId;
    }

    if (cancellationData.offerer) {
      whereClause.offerer = cancellationData.offerer.toLowerCase();
    }

    const offers = await prisma.marketplaceOffer.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });

    if (offers.length === 0) {
      console.log(`⚠️ No active offer found to cancel`);
      return;
    }

    // Update all matching offers to CANCELLED
    const updatePromises = offers.map(offer =>
      prisma.marketplaceOffer.update({
        where: { id: offer.id },
        data: {
          status: OfferStatus.CANCELLED,
          cancelTxHash: cancellationData.txHash,
          cancelBlock: cancellationData.blockNumber
        }
      })
    );

    await Promise.all(updatePromises);

    console.log(
      `✅ Cancelled ${offers.length} offer(s): ${cancellationData.marketplace}`
    );
  }

  /**
   * Update NFT ownership on marketplace sale
   * Requirements: 12.1, 12.2
   * 
   * Marks seller's ownership as isCurrent=false and creates new ownership for buyer
   */
  private async updateOwnershipOnSale(
    tx: any,
    saleData: SaleEventData
  ): Promise<void> {
    // Find the NFT
    const nft = await tx.nFT.findUnique({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress: saleData.contractAddress.toLowerCase(),
          tokenId: saleData.tokenId,
          chainId: saleData.chainId
        }
      }
    });

    if (!nft) {
      console.log(`⚠️ NFT not found for sale: ${saleData.contractAddress} #${saleData.tokenId}`);
      return;
    }

    // Mark seller's ownership as not current (Requirement 12.1)
    await tx.nFTOwnership.updateMany({
      where: {
        nftId: nft.id,
        ownerAddress: saleData.seller.toLowerCase(),
        isCurrent: true
      },
      data: {
        isCurrent: false
      }
    });

    // Create new ownership record for buyer (Requirement 12.2)
    await tx.nFTOwnership.create({
      data: {
        nftId: nft.id,
        ownerAddress: saleData.buyer.toLowerCase(),
        balance: saleData.quantity || '1',
        acquiredAt: saleData.blockTimestamp,
        acquiredBlock: saleData.blockNumber,
        acquiredTxHash: saleData.txHash,
        isCurrent: true
      }
    });

    console.log(
      `✅ Updated ownership: ${this.truncateAddress(saleData.seller)} → ${this.truncateAddress(saleData.buyer)}`
    );
  }

  /**
   * Create transfer record for marketplace sale
   * Requirement: 12.3
   * 
   * Creates nft_transfers record with transferType SALE
   */
  private async createSaleTransferRecord(
    tx: any,
    saleData: SaleEventData
  ): Promise<void> {
    // Find the NFT
    const nft = await tx.nFT.findUnique({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress: saleData.contractAddress.toLowerCase(),
          tokenId: saleData.tokenId,
          chainId: saleData.chainId
        }
      }
    });

    if (!nft) {
      console.log(`⚠️ NFT not found for transfer record: ${saleData.contractAddress} #${saleData.tokenId}`);
      return;
    }

    // Check if transfer record already exists (idempotency)
    const existingTransfer = await tx.nFTTransfer.findUnique({
      where: {
        txHash_logIndex: {
          txHash: saleData.txHash,
          logIndex: saleData.logIndex
        }
      }
    });

    if (existingTransfer) {
      console.log(`⚠️ Transfer record already exists: ${saleData.txHash}:${saleData.logIndex}`);
      return;
    }

    // Create transfer record with SALE type (Requirement 12.3)
    await tx.nFTTransfer.create({
      data: {
        chainId: saleData.chainId,
        nftId: nft.id,
        fromAddress: saleData.seller.toLowerCase(),
        toAddress: saleData.buyer.toLowerCase(),
        quantity: saleData.quantity || '1',
        txHash: saleData.txHash,
        blockNumber: saleData.blockNumber,
        blockTimestamp: saleData.blockTimestamp,
        logIndex: saleData.logIndex,
        transferType: 'SALE'
      }
    });

    console.log(
      `✅ Created SALE transfer record: ${saleData.txHash}:${saleData.logIndex}`
    );
  }

  /**
   * Update collection analytics with sale data
   * Requirements: 12.4, 12.5
   * 
   * Updates nft_collection_analytics with totalSales, sales24h, lastSalePrice, volume metrics
   */
  private async updateAnalyticsWithSale(
    tx: any,
    saleData: SaleEventData
  ): Promise<void> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Get current analytics or create if doesn't exist
    const currentAnalytics = await tx.nFTCollectionAnalytics.findUnique({
      where: {
        contractAddress_chainId: {
          contractAddress: saleData.contractAddress.toLowerCase(),
          chainId: saleData.chainId
        }
      }
    });

    // Calculate sales in time windows
    const sales24h = await tx.marketplaceSale.count({
      where: {
        contractAddress: saleData.contractAddress.toLowerCase(),
        chainId: saleData.chainId,
        blockTimestamp: {
          gte: oneDayAgo
        }
      }
    });

    const sales7d = await tx.marketplaceSale.count({
      where: {
        contractAddress: saleData.contractAddress.toLowerCase(),
        chainId: saleData.chainId,
        blockTimestamp: {
          gte: sevenDaysAgo
        }
      }
    });

    const sales30d = await tx.marketplaceSale.count({
      where: {
        contractAddress: saleData.contractAddress.toLowerCase(),
        chainId: saleData.chainId,
        blockTimestamp: {
          gte: thirtyDaysAgo
        }
      }
    });

    // Calculate volume in time windows
    const salesData24h = await tx.marketplaceSale.findMany({
      where: {
        contractAddress: saleData.contractAddress.toLowerCase(),
        chainId: saleData.chainId,
        blockTimestamp: {
          gte: oneDayAgo
        }
      },
      select: {
        price: true
      }
    });

    const salesData7d = await tx.marketplaceSale.findMany({
      where: {
        contractAddress: saleData.contractAddress.toLowerCase(),
        chainId: saleData.chainId,
        blockTimestamp: {
          gte: sevenDaysAgo
        }
      },
      select: {
        price: true
      }
    });

    const salesData30d = await tx.marketplaceSale.findMany({
      where: {
        contractAddress: saleData.contractAddress.toLowerCase(),
        chainId: saleData.chainId,
        blockTimestamp: {
          gte: thirtyDaysAgo
        }
      },
      select: {
        price: true
      }
    });

    // Calculate volumes
    const volume24h = salesData24h.reduce((sum: bigint, sale: { price: string }) => {
      return sum + safePriceToBigInt(sale.price, 'sale price');
    }, BigInt(0)).toString();

    const volume7d = salesData7d.reduce((sum: bigint, sale: { price: string }) => {
      return sum + safePriceToBigInt(sale.price, 'sale price');
    }, BigInt(0)).toString();

    const volume30d = salesData30d.reduce((sum: bigint, sale: { price: string }) => {
      return sum + safePriceToBigInt(sale.price, 'sale price');
    }, BigInt(0)).toString();

    // Calculate total volume
    const allSales = await tx.marketplaceSale.findMany({
      where: {
        contractAddress: saleData.contractAddress.toLowerCase(),
        chainId: saleData.chainId
      },
      select: {
        price: true
      }
    });

    const totalVolume = allSales.reduce((sum: bigint, sale: { price: string }) => {
      return sum + safePriceToBigInt(sale.price, 'sale price');
    }, BigInt(0)).toString();

    // Calculate average sale price
    const totalSales = allSales.length;
    const avgSalePrice = totalSales > 0
      ? (BigInt(totalVolume) / BigInt(totalSales)).toString()
      : '0';

    // Find highest sale
    const highestSale = allSales.reduce((max: string, sale: { price: string }) => {
      const salePrice = safePriceToBigInt(sale.price, 'sale price');
      const maxPrice = safePriceToBigInt(max, 'max price');
      return salePrice > maxPrice ? sale.price : max;
    }, '0');

    // Upsert analytics (Requirement 12.5)
    await tx.nFTCollectionAnalytics.upsert({
      where: {
        contractAddress_chainId: {
          contractAddress: saleData.contractAddress.toLowerCase(),
          chainId: saleData.chainId
        }
      },
      create: {
        chainId: saleData.chainId,
        contractAddress: saleData.contractAddress.toLowerCase(),
        totalVolume,
        volume24h,
        volume7d,
        volume30d,
        totalSales,
        sales24h,
        sales7d,
        sales30d,
        lastSalePrice: saleData.price,
        avgSalePrice,
        highestSale,
        uniqueHolders: currentAnalytics?.uniqueHolders || 0,
        totalSupply: currentAnalytics?.totalSupply || 0,
        calculatedAt: now
      },
      update: {
        totalVolume,
        volume24h,
        volume7d,
        volume30d,
        totalSales,
        sales24h,
        sales7d,
        sales30d,
        lastSalePrice: saleData.price,
        avgSalePrice,
        highestSale,
        calculatedAt: now
      }
    });

    console.log(
      `✅ Updated analytics: totalSales=${totalSales}, totalVolume=${this.formatPrice(totalVolume)}`
    );
  }

  /**
   * Ensure NFT contract exists in database
   */
  private async ensureNFTContract(chainId: number, contractAddress: string): Promise<void> {
    const contract = await prisma.nFTContract.findUnique({
      where: {
        address_chainId: {
          address: contractAddress.toLowerCase(),
          chainId
        }
      }
    });

    if (!contract) {
      // Create minimal contract record
      await prisma.nFTContract.create({
        data: {
          chainId,
          address: contractAddress.toLowerCase()
        }
      });
      console.log(`✅ Created NFT contract record: ${contractAddress}`);
    }
  }

  /**
   * Format price for display
   */
  private formatPrice(price: string): string {
    try {
      const priceNum = safePriceToBigInt(price, 'format price');
      const ethValue = Number(priceNum) / 1e18;
      return ethValue.toFixed(4);
    } catch {
      return price;
    }
  }
}
