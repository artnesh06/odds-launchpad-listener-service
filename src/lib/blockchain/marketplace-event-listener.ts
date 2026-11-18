/**
 * Marketplace Event Listener
 * 
 * Listens to marketplace-specific events from various NFT marketplaces:
 * - OpenSea Seaport (OrderFulfilled, OrderCancelled)
 * - Blur (OrdersMatched, OrderCancelled)
 * - LooksRare (TakerAsk, TakerBid)
 * - Magic Eden (BuyListingERC721, SellOfferERC721)
 * 
 * Requirements: 4.1, 4.2, 4.4, 13.1, 13.2, 13.3, 13.4, 13.5
 */

import { ethers } from 'ethers';
import { Marketplace } from '@prisma/client';
import { getMarketplaceContractsForChain, type MarketplaceContractConfig } from '../../config/marketplace-contracts';
import { ProviderService } from './services/provider-service';
import { ErrorTrackingService } from './services/error-tracking-service';
import { EventListenerRegistry } from './services/event-listener-registry';
import { delay } from './utils/validation-helpers';

// OpenSea Seaport ABI fragments
const SEAPORT_ABI = [
  'event OrderFulfilled(bytes32 orderHash, address indexed offerer, address indexed zone, address recipient, tuple(uint8 itemType, address token, uint256 identifier, uint256 amount)[] offer, tuple(uint8 itemType, address token, uint256 identifier, uint256 amount, address recipient)[] consideration)',
  'event OrderCancelled(bytes32 orderHash, address indexed offerer, address indexed zone)',
  'event CounterIncremented(uint256 newCounter, address indexed offerer)'
];

// Blur ABI fragments
const BLUR_ABI = [
  'event OrdersMatched(address indexed maker, address indexed taker, tuple(address trader, uint8 side, address matchingPolicy, address collection, uint256 tokenId, uint256 amount, address paymentToken, uint256 price, uint256 listingTime, uint256 expirationTime, tuple(uint16 rate, address recipient)[] fees, uint256 salt, bytes extraParams, bytes extraSignature) sell, bytes32 sellHash, tuple(address trader, uint8 side, address matchingPolicy, address collection, uint256 tokenId, uint256 amount, address paymentToken, uint256 price, uint256 listingTime, uint256 expirationTime, tuple(uint16 rate, address recipient)[] fees, uint256 salt, bytes extraParams, bytes extraSignature) buy, bytes32 buyHash)',
  'event OrderCancelled(bytes32 hash)'
];

// LooksRare ABI fragments
const LOOKSRARE_ABI = [
  'event TakerAsk(bytes32 orderHash, uint256 orderNonce, address indexed taker, address indexed maker, address indexed strategy, address currency, address collection, uint256 tokenId, uint256 amount, uint256 price)',
  'event TakerBid(bytes32 orderHash, uint256 orderNonce, address indexed taker, address indexed maker, address indexed strategy, address currency, address collection, uint256 tokenId, uint256 amount, uint256 price)'
];

// Magic Eden ABI fragments
const MAGIC_EDEN_ABI = [
  'event BuyListingERC721(address indexed buyer, address indexed seller, address indexed contractAddress, uint256 tokenId, uint256 quantity, uint256 totalPrice)',
  'event SellOfferERC721(address indexed seller, address indexed buyer, address indexed contractAddress, uint256 tokenId, uint256 quantity, uint256 totalPrice)'
];

export interface MarketplaceEventListenerConfig {
  chainId: number;
  rpcUrl: string;
  rpcUrls?: string[]; // Optional: Multiple RPC URLs for failover
  marketplaces: Marketplace[]; // Which marketplaces to listen to
  errorThreshold?: number;
  retryAttempts?: number;
}

export class MarketplaceEventListener {
  private providerService: ProviderService;
  private errorTrackingService: ErrorTrackingService;
  private eventListenerRegistry: EventListenerRegistry;
  private provider: ethers.JsonRpcProvider | ethers.WebSocketProvider;
  private contracts: Map<string, { contract: ethers.Contract; config: MarketplaceContractConfig }> = new Map();
  private config: MarketplaceEventListenerConfig;
  private isRunning: boolean = false;
  private maxDatabaseRetries: number;

  constructor(config: MarketplaceEventListenerConfig) {
    this.config = config;
    this.maxDatabaseRetries = config.retryAttempts ?? 3;

    // Initialize provider using ProviderService
    const marketplaceCount = config.marketplaces.length;
    this.providerService = new ProviderService(config.rpcUrl, config.chainId, marketplaceCount);
    this.provider = this.providerService.getProvider();

    // Initialize error tracking using ErrorTrackingService
    const errorThreshold = config.errorThreshold ?? 10;
    this.errorTrackingService = new ErrorTrackingService(config.chainId, errorThreshold);

    // Initialize event listener registry using EventListenerRegistry
    const setupDelay = this.providerService.getSetupDelay(marketplaceCount);
    this.eventListenerRegistry = new EventListenerRegistry(config.chainId, setupDelay);

    // Initialize marketplace contracts
    this.initializeContracts();
  }

  /**
   * Initialize marketplace contracts based on configuration
   */
  private initializeContracts(): void {
    const chainContracts = getMarketplaceContractsForChain(this.config.chainId);
    
    for (const contractConfig of chainContracts) {
      // Only initialize contracts for requested marketplaces
      if (!this.config.marketplaces.includes(contractConfig.marketplace)) {
        continue;
      }

      const abi = this.getABIForMarketplace(contractConfig.marketplace);
      if (!abi) {
        console.warn(`⚠️ No ABI found for marketplace ${contractConfig.marketplace}`);
        continue;
      }

      // Validate address before creating contract (prevents ENS resolution on non-ENS chains)
      if (!ethers.isAddress(contractConfig.address)) {
        console.warn(`⚠️ Invalid marketplace contract address: ${contractConfig.address}`);
        continue;
      }

      const contract = new ethers.Contract(contractConfig.address, abi, this.provider);
      
      this.contracts.set(contractConfig.address.toLowerCase(), {
        contract,
        config: contractConfig
      });
    }
    
    console.log(`✅ Initialized ${this.contracts.size} marketplace contracts for chain ${this.config.chainId}`);
  }

  /**
   * Get ABI for a specific marketplace
   */
  private getABIForMarketplace(marketplace: Marketplace): string[] | null {
    switch (marketplace) {
      case Marketplace.SEAPORT:
      case Marketplace.OPENSEA:
        return SEAPORT_ABI;
      case Marketplace.BLUR:
        return BLUR_ABI;
      case Marketplace.LOOKSRARE:
        return LOOKSRARE_ABI;
      case Marketplace.MAGIC_EDEN:
        return MAGIC_EDEN_ABI;
      default:
        return null;
    }
  }

  /**
   * Start listening to all marketplace events
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(`⚠️ Marketplace Event Listener for chain ${this.config.chainId} is already running`);
      return;
    }

    try {
      console.log(`🎧 Starting Marketplace Event Listener for chain ${this.config.chainId}`);
      
      // Test connection using ProviderService
      await this.providerService.testConnection();
      
      this.isRunning = true;

      // Get current block for filtering old events
      const currentBlock = await this.provider.getBlockNumber();

      // Set up listeners for all contracts with rate limiting
      let index = 0;
      for (const [address, contractData] of this.contracts) {
        if (index > 0) {
          const setupDelay = this.providerService.getSetupDelay(this.contracts.size);
          await delay(setupDelay);
        }

        try {
          await this.setupContractListeners(address, contractData, currentBlock);
        } catch (error) {
          console.error(`❌ Error setting up listeners for ${address}:`, error);
          // Continue with other contracts even if one fails
        }

        index++;
      }

      console.log(`✅ Marketplace Event Listener started for chain ${this.config.chainId}`);
    } catch (error) {
      console.error(`❌ Failed to start Marketplace Event Listener for chain ${this.config.chainId}:`, error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop listening to all marketplace events
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log(`⚠️ Marketplace Event Listener for chain ${this.config.chainId} is not running`);
      return;
    }

    try {
      console.log(`🛑 Stopping Marketplace Event Listener for chain ${this.config.chainId}`);

      // Remove all listeners from all contracts
      this.contracts.forEach((contractData) => {
        contractData.contract.removeAllListeners();
      });

      // Close connection using ProviderService
      await this.providerService.destroy();

      this.isRunning = false;
      console.log(`✅ Marketplace Event Listener stopped for chain ${this.config.chainId}`);
    } catch (error) {
      console.error(`❌ Error stopping Marketplace Event Listener for chain ${this.config.chainId}:`, error);
      throw error;
    }
  }

  /**
   * Setup event listeners for a specific marketplace contract
   */
  private async setupContractListeners(
    contractAddress: string,
    contractData: { contract: ethers.Contract; config: MarketplaceContractConfig },
    currentBlock: number
  ): Promise<void> {
    const { contract, config } = contractData;

    console.log(`🔍 Setting up listeners for ${config.marketplace} (${config.version}) at ${contractAddress}`);

    switch (config.marketplace) {
      case Marketplace.SEAPORT:
      case Marketplace.OPENSEA:
        await this.setupSeaportListeners(contract, config, currentBlock);
        break;
      case Marketplace.BLUR:
        await this.setupBlurListeners(contract, config, currentBlock);
        break;
      case Marketplace.LOOKSRARE:
        await this.setupLooksRareListeners(contract, config, currentBlock);
        break;
      case Marketplace.MAGIC_EDEN:
        await this.setupMagicEdenListeners(contract, config, currentBlock);
        break;
      default:
        console.warn(`⚠️ Unknown marketplace: ${config.marketplace}`);
    }
  }

  /**
   * Setup OpenSea Seaport event listeners
   * Requirements: 4.1, 4.2, 4.4, 13.1
   */
  private async setupSeaportListeners(
    contract: ethers.Contract,
    config: MarketplaceContractConfig,
    currentBlock: number
  ): Promise<void> {
    // Listen to OrderFulfilled events (sales)
    const orderFulfilledFilter = contract.filters.OrderFulfilled();

    contract.on(orderFulfilledFilter, async (
      orderHash: string,
      offerer: string,
      zone: string,
      recipient: string,
      offer: any[],
      consideration: any[],
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid OrderFulfilled event data`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        const block = await this.provider.getBlock(event.blockNumber);
        if (!block) {
          console.warn(`⚠️ Could not fetch block ${event.blockNumber}`);
          return;
        }

        console.log(`🛒 Seaport OrderFulfilled: ${orderHash.substring(0, 10)}... at block ${event.blockNumber}`);
        
        // TODO: Process sale event in task 6
        // await this.handleSeaportSale({
        //   orderHash,
        //   offerer,
        //   recipient,
        //   offer,
        //   consideration,
        //   txHash: event.transactionHash,
        //   blockNumber: event.blockNumber,
        //   blockTimestamp: new Date(block.timestamp * 1000),
        //   logIndex: event.index
        // });

      } catch (error) {
        console.error(`❌ Error processing Seaport OrderFulfilled event:`, error);
        await this.logError('Seaport_OrderFulfilled', error, { 
          config, 
          txHash: event.transactionHash,
          blockNumber: event.blockNumber 
        });
      }
    });

    // Listen to OrderCancelled events
    const orderCancelledFilter = contract.filters.OrderCancelled();

    contract.on(orderCancelledFilter, async (
      orderHash: string,
      offerer: string,
      zone: string,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid OrderCancelled event data`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        console.log(`❌ Seaport OrderCancelled: ${orderHash.substring(0, 10)}... at block ${event.blockNumber}`);
        
        // TODO: Process cancellation event in task 6
        // await this.handleSeaportCancellation({
        //   orderHash,
        //   offerer,
        //   txHash: event.transactionHash,
        //   blockNumber: event.blockNumber
        // });

      } catch (error) {
        console.error(`❌ Error processing Seaport OrderCancelled event:`, error);
        await this.logError('Seaport_OrderCancelled', error, { 
          config, 
          txHash: event.transactionHash,
          blockNumber: event.blockNumber 
        });
      }
    });

    console.log(`✅ Listening to Seaport events for ${config.address}`);
  }

  /**
   * Setup Blur marketplace event listeners
   * Requirements: 4.1, 4.2, 4.4, 13.2
   */
  private async setupBlurListeners(
    contract: ethers.Contract,
    config: MarketplaceContractConfig,
    currentBlock: number
  ): Promise<void> {
    // Listen to OrdersMatched events (sales)
    const ordersMatchedFilter = contract.filters.OrdersMatched();

    contract.on(ordersMatchedFilter, async (
      maker: string,
      taker: string,
      sell: any,
      sellHash: string,
      buy: any,
      buyHash: string,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid OrdersMatched event data`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        const block = await this.provider.getBlock(event.blockNumber);
        if (!block) {
          console.warn(`⚠️ Could not fetch block ${event.blockNumber}`);
          return;
        }

        console.log(`🛒 Blur OrdersMatched: ${maker} <-> ${taker} at block ${event.blockNumber}`);
        
        // TODO: Process sale event in task 6
        // await this.handleBlurSale({
        //   maker,
        //   taker,
        //   sell,
        //   buy,
        //   txHash: event.transactionHash,
        //   blockNumber: event.blockNumber,
        //   blockTimestamp: new Date(block.timestamp * 1000),
        //   logIndex: event.index
        // });

      } catch (error) {
        console.error(`❌ Error processing Blur OrdersMatched event:`, error);
        await this.logError('Blur_OrdersMatched', error, { 
          config, 
          txHash: event.transactionHash,
          blockNumber: event.blockNumber 
        });
      }
    });

    // Listen to OrderCancelled events
    const orderCancelledFilter = contract.filters.OrderCancelled();

    contract.on(orderCancelledFilter, async (
      hash: string,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid OrderCancelled event data`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        console.log(`❌ Blur OrderCancelled: ${hash.substring(0, 10)}... at block ${event.blockNumber}`);
        
        // TODO: Process cancellation event in task 6
        // await this.handleBlurCancellation({
        //   hash,
        //   txHash: event.transactionHash,
        //   blockNumber: event.blockNumber
        // });

      } catch (error) {
        console.error(`❌ Error processing Blur OrderCancelled event:`, error);
        await this.logError('Blur_OrderCancelled', error, { 
          config, 
          txHash: event.transactionHash,
          blockNumber: event.blockNumber 
        });
      }
    });

    console.log(`✅ Listening to Blur events for ${config.address}`);
  }

  /**
   * Setup LooksRare marketplace event listeners
   * Requirements: 4.1, 4.2, 13.3
   */
  private async setupLooksRareListeners(
    contract: ethers.Contract,
    config: MarketplaceContractConfig,
    currentBlock: number
  ): Promise<void> {
    // Listen to TakerAsk events (seller accepts bid)
    const takerAskFilter = contract.filters.TakerAsk();

    contract.on(takerAskFilter, async (
      orderHash: string,
      orderNonce: bigint,
      taker: string,
      maker: string,
      strategy: string,
      currency: string,
      collection: string,
      tokenId: bigint,
      amount: bigint,
      price: bigint,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid TakerAsk event data`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        const block = await this.provider.getBlock(event.blockNumber);
        if (!block) {
          console.warn(`⚠️ Could not fetch block ${event.blockNumber}`);
          return;
        }

        console.log(`🛒 LooksRare TakerAsk: ${collection} #${tokenId} at block ${event.blockNumber}`);
        
        // TODO: Process sale event in task 6
        // await this.handleLooksRareSale({
        //   orderHash,
        //   taker,
        //   maker,
        //   collection,
        //   tokenId: tokenId.toString(),
        //   amount: amount.toString(),
        //   price: price.toString(),
        //   currency,
        //   isTakerAsk: true,
        //   txHash: event.transactionHash,
        //   blockNumber: event.blockNumber,
        //   blockTimestamp: new Date(block.timestamp * 1000),
        //   logIndex: event.index
        // });

      } catch (error) {
        console.error(`❌ Error processing LooksRare TakerAsk event:`, error);
        await this.logError('LooksRare_TakerAsk', error, { 
          config, 
          txHash: event.transactionHash,
          blockNumber: event.blockNumber 
        });
      }
    });

    // Listen to TakerBid events (buyer accepts listing)
    const takerBidFilter = contract.filters.TakerBid();

    contract.on(takerBidFilter, async (
      orderHash: string,
      orderNonce: bigint,
      taker: string,
      maker: string,
      strategy: string,
      currency: string,
      collection: string,
      tokenId: bigint,
      amount: bigint,
      price: bigint,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid TakerBid event data`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        const block = await this.provider.getBlock(event.blockNumber);
        if (!block) {
          console.warn(`⚠️ Could not fetch block ${event.blockNumber}`);
          return;
        }

        console.log(`🛒 LooksRare TakerBid: ${collection} #${tokenId} at block ${event.blockNumber}`);
        
        // TODO: Process sale event in task 6
        // await this.handleLooksRareSale({
        //   orderHash,
        //   taker,
        //   maker,
        //   collection,
        //   tokenId: tokenId.toString(),
        //   amount: amount.toString(),
        //   price: price.toString(),
        //   currency,
        //   isTakerAsk: false,
        //   txHash: event.transactionHash,
        //   blockNumber: event.blockNumber,
        //   blockTimestamp: new Date(block.timestamp * 1000),
        //   logIndex: event.index
        // });

      } catch (error) {
        console.error(`❌ Error processing LooksRare TakerBid event:`, error);
        await this.logError('LooksRare_TakerBid', error, { 
          config, 
          txHash: event.transactionHash,
          blockNumber: event.blockNumber 
        });
      }
    });

    console.log(`✅ Listening to LooksRare events for ${config.address}`);
  }

  /**
   * Setup Magic Eden marketplace event listeners
   * Requirements: 4.1, 4.2, 13.4
   */
  private async setupMagicEdenListeners(
    contract: ethers.Contract,
    config: MarketplaceContractConfig,
    currentBlock: number
  ): Promise<void> {
    // Listen to BuyListingERC721 events
    const buyListingFilter = contract.filters.BuyListingERC721();

    contract.on(buyListingFilter, async (
      buyer: string,
      seller: string,
      contractAddress: string,
      tokenId: bigint,
      quantity: bigint,
      totalPrice: bigint,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid BuyListingERC721 event data`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        const block = await this.provider.getBlock(event.blockNumber);
        if (!block) {
          console.warn(`⚠️ Could not fetch block ${event.blockNumber}`);
          return;
        }

        console.log(`🛒 Magic Eden BuyListing: ${contractAddress} #${tokenId} at block ${event.blockNumber}`);
        
        // TODO: Process sale event in task 6
        // await this.handleMagicEdenSale({
        //   buyer,
        //   seller,
        //   contractAddress,
        //   tokenId: tokenId.toString(),
        //   quantity: quantity.toString(),
        //   totalPrice: totalPrice.toString(),
        //   isBuyListing: true,
        //   txHash: event.transactionHash,
        //   blockNumber: event.blockNumber,
        //   blockTimestamp: new Date(block.timestamp * 1000),
        //   logIndex: event.index
        // });

      } catch (error) {
        console.error(`❌ Error processing Magic Eden BuyListingERC721 event:`, error);
        await this.logError('MagicEden_BuyListingERC721', error, { 
          config, 
          txHash: event.transactionHash,
          blockNumber: event.blockNumber 
        });
      }
    });

    // Listen to SellOfferERC721 events
    const sellOfferFilter = contract.filters.SellOfferERC721();

    contract.on(sellOfferFilter, async (
      seller: string,
      buyer: string,
      contractAddress: string,
      tokenId: bigint,
      quantity: bigint,
      totalPrice: bigint,
      event: ethers.EventLog
    ) => {
      try {
        if (!event || !event.blockNumber || !event.transactionHash) {
          console.warn(`⚠️ Invalid SellOfferERC721 event data`);
          return;
        }

        if (event.blockNumber < currentBlock) {
          return;
        }

        const block = await this.provider.getBlock(event.blockNumber);
        if (!block) {
          console.warn(`⚠️ Could not fetch block ${event.blockNumber}`);
          return;
        }

        console.log(`🛒 Magic Eden SellOffer: ${contractAddress} #${tokenId} at block ${event.blockNumber}`);
        
        // TODO: Process sale event in task 6
        // await this.handleMagicEdenSale({
        //   buyer,
        //   seller,
        //   contractAddress,
        //   tokenId: tokenId.toString(),
        //   quantity: quantity.toString(),
        //   totalPrice: totalPrice.toString(),
        //   isBuyListing: false,
        //   txHash: event.transactionHash,
        //   blockNumber: event.blockNumber,
        //   blockTimestamp: new Date(block.timestamp * 1000),
        //   logIndex: event.index
        // });

      } catch (error) {
        console.error(`❌ Error processing Magic Eden SellOfferERC721 event:`, error);
        await this.logError('MagicEden_SellOfferERC721', error, { 
          config, 
          txHash: event.transactionHash,
          blockNumber: event.blockNumber 
        });
      }
    });

    console.log(`✅ Listening to Magic Eden events for ${config.address}`);
  }

  /**
   * Log error with context using ErrorTrackingService
   */
  private async logError(eventType: string, error: any, context: any): Promise<void> {
    try {
      await this.errorTrackingService.logEventError(eventType, error, context, 'medium');
    } catch (logErr) {
      console.error('Failed to log error:', logErr);
    }
  }

  /**
   * Get listener status
   */
  getStatus(): {
    chainId: number;
    isRunning: boolean;
    contractCount: number;
    contracts: Array<{ address: string; marketplace: Marketplace; version: string }>;
  } {
    const contracts = Array.from(this.contracts.values()).map(({ config }) => ({
      address: config.address,
      marketplace: config.marketplace,
      version: config.version
    }));

    return {
      chainId: this.config.chainId,
      isRunning: this.isRunning,
      contractCount: this.contracts.size,
      contracts
    };
  }
}
