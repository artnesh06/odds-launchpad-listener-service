# Design Document

## Overview

This design document outlines the architecture and implementation strategy for transforming the existing NFT Activity Listener Service into a comprehensive multi-chain NFT indexer. The system will index NFT metadata, attributes, ownership, marketplace events, and provide Alchemy-compatible data structures. The design follows a modular, event-driven architecture that can scale across multiple blockchain networks and marketplace platforms.

### Key Design Goals

1. **Alchemy Compatibility**: Database schema matches Alchemy API response structure exactly
2. **Multi-Chain Support**: Seamless operation across Ethereum, Polygon, BSC, Arbitrum, Optimism, Base, and other EVM chains
3. **Marketplace Agnostic**: Support for OpenSea, Magic Eden, Blur, LooksRare, X2Y2, Rarible, and future marketplaces
4. **Performance**: Efficient indexing with minimal RPC calls and optimized database queries
5. **Reliability**: Robust error handling, retry logic, and data consistency guarantees
6. **Extensibility**: Easy to add new chains, marketplaces, and event types

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Multi-Chain RPC Providers                    │
│  (Ethereum, Polygon, BSC, Arbitrum, Optimism, Base, etc.)       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Multi-Chain Listener Manager                        │
│  - Manages listeners for each chain                              │
│  - Coordinates event processing                                  │
│  - Handles chain-specific configurations                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Event Listeners Layer                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  NFT Contract    │  │   Marketplace    │  │   Launchpad   │ │
│  │    Listeners     │  │    Listeners     │  │   Listeners   │ │
│  │  - Transfer      │  │  - OrderFulfilled│  │  - Mint       │ │
│  │  - Approval      │  │  - OrderCancelled│  │  - Burn       │ │
│  │  - ApprovalForAll│  │  - OfferAccepted │  │  - Reveal     │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Event Handlers Layer                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  NFT Event       │  │  Marketplace     │  │  Launchpad    │ │
│  │  Handler         │  │  Event Handler   │  │  Event Handler│ │
│  │  - Process NFT   │  │  - Process Sales │  │  - Process    │ │
│  │    transfers     │  │  - Process Lists │  │    mints      │ │
│  │  - Update owner  │  │  - Process Offers│  │  - Process    │ │
│  │  - Sync metadata │  │  - Update prices │  │    phases     │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Data Processing Layer                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │  Metadata        │  │  Ownership       │  │  Analytics    │ │
│  │  Processor       │  │  Tracker         │  │  Calculator   │ │
│  │  - Fetch from    │  │  - Track owners  │  │  - Volume     │ │
│  │    Alchemy       │  │  - Update counts │  │  - Floor price│ │
│  │  - Parse attrs   │  │  - History       │  │  - Holders    │ │
│  │  - Store images  │  │                  │  │  - Rarity     │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Database Layer (PostgreSQL)                   │
│  - NFT metadata, attributes, ownership                           │
│  - Marketplace events, sales, listings, offers                   │
│  - Collection analytics, floor prices                            │
│  - Activity history, transfers                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

```
1. Event Detection
   RPC Provider → Listener → Event Queue

2. Event Processing
   Event Queue → Handler → Validator → Processor

3. Data Enrichment
   Processor → Alchemy API → Metadata Enricher → Database

4. Analytics Update
   Database Trigger → Analytics Calculator → Database Update
```

## Components and Interfaces

### 1. Database Schema Extensions

#### NFT Table
Stores complete NFT metadata matching Alchemy structure:

```prisma
model NFT {
  id                String   @id @default(cuid())
  chainId           Int
  contractAddress   String
  tokenId           String
  tokenType         String   // ERC721, ERC1155
  name              String?
  description       String?
  tokenUri          String?
  
  // Image data
  imageCachedUrl    String?
  imageThumbnailUrl String?
  imagePngUrl       String?
  imageContentType  String?
  imageSize         Int?
  imageOriginalUrl  String?
  
  // Raw metadata
  rawMetadata       Json?
  rawTokenUri       String?
  
  // Timestamps
  timeLastUpdated   DateTime @default(now())
  acquiredBlockTimestamp DateTime?
  acquiredBlockNumber    Int?
  
  // Mint info
  mintAddress       String?
  mintBlockNumber   Int?
  mintTimestamp     DateTime?
  mintTransactionHash String?
  
  // Spam detection
  isSpam            Boolean  @default(false)
  isAirdrop         Boolean  @default(false)
  
  // Relations
  chain             Chain    @relation(fields: [chainId], references: [chainId])
  contract          NFTContract @relation(fields: [contractAddress, chainId], references: [address, chainId])
  attributes        NFTAttribute[]
  ownership         NFTOwnership[]
  transfers         NFTTransfer[]
  
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  @@unique([contractAddress, tokenId, chainId])
  @@index([chainId, contractAddress])
  @@index([isSpam, isAirdrop])
  @@map("nfts")
}
```

#### NFTContract Table
Stores NFT collection/contract metadata:

```prisma
model NFTContract {
  id                    String   @id @default(cuid())
  chainId               Int
  address               String
  name                  String?
  symbol                String?
  totalSupply           String?
  tokenType             String?  // ERC721, ERC1155
  contractDeployer      String?
  deployedBlockNumber   Int?
  
  // OpenSea metadata
  openSeaFloorPrice     Float?
  openSeaCollectionName String?
  openSeaCollectionSlug String?
  openSeaSafelistStatus String?
  openSeaImageUrl       String?
  openSeaDescription    String?
  openSeaExternalUrl    String?
  openSeaTwitter        String?
  openSeaDiscord        String?
  openSeaBannerImageUrl String?
  openSeaLastIngestedAt DateTime?
  
  // Relations
  chain                 Chain    @relation(fields: [chainId], references: [chainId])
  nfts                  NFT[]
  floorPrices           NFTFloorPrice[]
  analytics             NFTCollectionAnalytics?
  marketplaceListings   MarketplaceListing[]
  marketplaceSales      MarketplaceSale[]
  
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  
  @@unique([address, chainId])
  @@index([chainId])
  @@map("nft_contracts")
}
```

#### NFTAttribute Table
Stores NFT traits/attributes:

```prisma
model NFTAttribute {
  id          String   @id @default(cuid())
  nftId       String
  traitType   String
  value       String
  displayType String?  // number, date, boost_percentage, boost_number
  
  // For numeric attributes
  numericValue Float?
  
  // Rarity data
  prevalence   Float?   // Percentage of collection with this trait
  count        Int?     // Number of NFTs with this trait value
  
  // Relations
  nft         NFT      @relation(fields: [nftId], references: [id], onDelete: Cascade)
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  @@index([nftId])
  @@index([traitType, value])
  @@map("nft_attributes")
}
```

#### NFTOwnership Table
Tracks current and historical ownership:

```prisma
model NFTOwnership {
  id              String   @id @default(cuid())
  nftId           String
  ownerAddress    String
  balance         String   @default("1")  // For ERC1155
  
  // Acquisition info
  acquiredAt      DateTime
  acquiredBlock   Int
  acquiredTxHash  String
  
  // Current ownership flag
  isCurrent       Boolean  @default(true)
  
  // Relations
  nft             NFT      @relation(fields: [nftId], references: [id], onDelete: Cascade)
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([nftId, isCurrent])
  @@index([ownerAddress, isCurrent])
  @@map("nft_ownership")
}
```

#### NFTTransfer Table
Records all transfer events:

```prisma
model NFTTransfer {
  id              String   @id @default(cuid())
  chainId         Int
  nftId           String
  fromAddress     String
  toAddress       String
  quantity        String   @default("1")  // For ERC1155
  
  // Transaction info
  txHash          String
  blockNumber     Int
  blockTimestamp  DateTime
  logIndex        Int
  
  // Transfer type
  transferType    TransferType  // MINT, TRANSFER, BURN
  
  // Relations
  chain           Chain    @relation(fields: [chainId], references: [chainId])
  nft             NFT      @relation(fields: [nftId], references: [id], onDelete: Cascade)
  
  createdAt       DateTime @default(now())
  
  @@unique([txHash, logIndex])
  @@index([nftId])
  @@index([fromAddress])
  @@index([toAddress])
  @@index([blockNumber])
  @@map("nft_transfers")
}

enum TransferType {
  MINT
  TRANSFER
  BURN
}
```

#### MarketplaceListing Table
Tracks active and historical listings:

```prisma
model MarketplaceListing {
  id              String   @id @default(cuid())
  chainId         Int
  marketplace     Marketplace
  contractAddress String
  tokenId         String
  
  // Listing details
  seller          String
  price           String
  currency        String   // ETH, WETH, USDC, etc.
  quantity        String   @default("1")
  
  // Timing
  startTime       DateTime
  endTime         DateTime?
  expirationTime  DateTime?
  
  // Status
  status          ListingStatus
  
  // Transaction info
  listingTxHash   String
  listingBlock    Int
  cancelTxHash    String?
  cancelBlock     Int?
  saleTxHash      String?
  saleBlock       Int?
  
  // Relations
  chain           Chain    @relation(fields: [chainId], references: [chainId])
  contract        NFTContract @relation(fields: [contractAddress, chainId], references: [address, chainId])
  sale            MarketplaceSale?
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([chainId, marketplace, status])
  @@index([contractAddress, tokenId])
  @@index([seller])
  @@map("marketplace_listings")
}

enum Marketplace {
  OPENSEA
  SEAPORT
  MAGIC_EDEN
  BLUR
  LOOKSRARE
  X2Y2
  RARIBLE
  UNKNOWN
}

enum ListingStatus {
  ACTIVE
  SOLD
  CANCELLED
  EXPIRED
}
```

#### MarketplaceSale Table
Records all marketplace sales:

```prisma
model MarketplaceSale {
  id              String   @id @default(cuid())
  chainId         Int
  marketplace     Marketplace
  contractAddress String
  tokenId         String
  
  // Sale details
  buyer           String
  seller          String
  price           String
  currency        String
  quantity        String   @default("1")
  
  // Fees
  sellerFeeAmount String?
  sellerFeeCurrency String?
  protocolFeeAmount String?
  protocolFeeCurrency String?
  royaltyFeeAmount String?
  royaltyFeeCurrency String?
  
  // Transaction info
  txHash          String
  blockNumber     Int
  blockTimestamp  DateTime
  logIndex        Int
  bundleIndex     Int      @default(0)
  
  // Taker (who initiated)
  taker           String   // 'buyer' or 'seller'
  
  // Relations
  chain           Chain    @relation(fields: [chainId], references: [chainId])
  contract        NFTContract @relation(fields: [contractAddress, chainId], references: [address, chainId])
  listing         MarketplaceListing? @relation(fields: [listingId], references: [id])
  listingId       String?  @unique
  
  createdAt       DateTime @default(now())
  
  @@unique([txHash, logIndex, bundleIndex])
  @@index([chainId, marketplace])
  @@index([contractAddress, tokenId])
  @@index([buyer])
  @@index([seller])
  @@index([blockNumber])
  @@map("marketplace_sales")
}
```

#### MarketplaceOffer Table
Tracks offers made on NFTs:

```prisma
model MarketplaceOffer {
  id              String   @id @default(cuid())
  chainId         Int
  marketplace     Marketplace
  contractAddress String
  tokenId         String
  
  // Offer details
  offerer         String
  price           String
  currency        String
  quantity        String   @default("1")
  
  // Timing
  offerTime       DateTime
  expirationTime  DateTime?
  
  // Status
  status          OfferStatus
  
  // Transaction info
  offerTxHash     String
  offerBlock      Int
  acceptTxHash    String?
  acceptBlock     Int?
  cancelTxHash    String?
  cancelBlock     Int?
  
  // Relations
  chain           Chain    @relation(fields: [chainId], references: [chainId])
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([chainId, marketplace, status])
  @@index([contractAddress, tokenId])
  @@index([offerer])
  @@map("marketplace_offers")
}

enum OfferStatus {
  ACTIVE
  ACCEPTED
  CANCELLED
  EXPIRED
}
```

#### NFTFloorPrice Table
Tracks floor prices from multiple marketplaces:

```prisma
model NFTFloorPrice {
  id              String   @id @default(cuid())
  chainId         Int
  contractAddress String
  marketplace     Marketplace
  
  // Price data
  floorPrice      Float
  priceCurrency   String
  collectionUrl   String?
  
  // Timestamp
  retrievedAt     DateTime @default(now())
  
  // Relations
  chain           Chain    @relation(fields: [chainId], references: [chainId])
  contract        NFTContract @relation(fields: [contractAddress, chainId], references: [address, chainId])
  
  createdAt       DateTime @default(now())
  
  @@index([contractAddress, chainId, marketplace])
  @@index([retrievedAt])
  @@map("nft_floor_prices")
}
```

#### NFTRarity Table
Stores rarity calculations:

```prisma
model NFTRarity {
  id              String   @id @default(cuid())
  nftId           String   @unique
  
  // Rarity data
  strategyId      String
  strategyVersion String
  rank            Int
  score           Float
  maxRank         Int
  totalSupply     Int
  rarityScore     Float
  prevalence      Float
  
  // Percentile
  percentile      Float
  
  // Relations
  nft             NFT      @relation(fields: [nftId], references: [id], onDelete: Cascade)
  
  calculatedAt    DateTime @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@index([rank])
  @@map("nft_rarity")
}
```

#### NFTCollectionAnalytics Table
Aggregated collection statistics:

```prisma
model NFTCollectionAnalytics {
  id              String   @id @default(cuid())
  chainId         Int
  contractAddress String   @unique
  
  // Volume metrics
  totalVolume     String   @default("0")
  volume24h       String   @default("0")
  volume7d        String   @default("0")
  volume30d       String   @default("0")
  
  // Sales metrics
  totalSales      Int      @default(0)
  sales24h        Int      @default(0)
  sales7d         Int      @default(0)
  sales30d        Int      @default(0)
  
  // Price metrics
  floorPrice      String?
  avgSalePrice    String   @default("0")
  lastSalePrice   String?
  highestSale     String?
  
  // Holder metrics
  uniqueHolders   Int      @default(0)
  totalSupply     Int      @default(0)
  
  // Relations
  contract        NFTContract @relation(fields: [contractAddress, chainId], references: [address, chainId])
  
  calculatedAt    DateTime @default(now())
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@map("nft_collection_analytics")
}
```

### 2. Event Listener Components

#### NFTEventListener
Listens to standard ERC721/ERC1155 events:

```typescript
interface NFTEventListener {
  // Listen to Transfer events
  listenToTransfers(): Promise<void>;
  
  // Listen to Approval events
  listenToApprovals(): Promise<void>;
  
  // Listen to ApprovalForAll events
  listenToApprovalForAll(): Promise<void>;
  
  // Handle Transfer event
  handleTransfer(event: TransferEvent): Promise<void>;
  
  // Handle Approval event
  handleApproval(event: ApprovalEvent): Promise<void>;
  
  // Handle ApprovalForAll event
  handleApprovalForAll(event: ApprovalForAllEvent): Promise<void>;
}
```

#### MarketplaceEventListener
Listens to marketplace-specific events:

```typescript
interface MarketplaceEventListener {
  marketplace: Marketplace;
  
  // OpenSea Seaport events
  listenToOrderFulfilled(): Promise<void>;
  listenToOrderCancelled(): Promise<void>;
  
  // Blur events
  listenToOrdersMatched(): Promise<void>;
  
  // LooksRare events
  listenToTakerAsk(): Promise<void>;
  listenToTakerBid(): Promise<void>;
  
  // Magic Eden events
  listenToBuyListing(): Promise<void>;
  listenToSellOffer(): Promise<void>;
  
  // Generic handlers
  handleSale(event: SaleEvent): Promise<void>;
  handleListing(event: ListingEvent): Promise<void>;
  handleCancellation(event: CancellationEvent): Promise<void>;
  handleOffer(event: OfferEvent): Promise<void>;
}
```

### 3. Event Handler Components

#### NFTEventHandler
Processes NFT contract events:

```typescript
class NFTEventHandler extends BaseEventHandler {
  // Process transfer and update ownership
  async handleTransferEvent(event: TransferEvent): Promise<void>;
  
  // Fetch and store NFT metadata
  async syncNFTMetadata(contractAddress: string, tokenId: string): Promise<void>;
  
  // Update ownership records
  async updateOwnership(nftId: string, newOwner: string, txInfo: TxInfo): Promise<void>;
  
  // Process mint (transfer from zero address)
  async handleMint(event: TransferEvent): Promise<void>;
  
  // Process burn (transfer to zero address)
  async handleBurn(event: TransferEvent): Promise<void>;
}
```

#### MarketplaceEventHandler
Processes marketplace events:

```typescript
class MarketplaceEventHandler extends BaseEventHandler {
  marketplace: Marketplace;
  
  // Process sale event
  async handleSaleEvent(event: SaleEvent): Promise<void>;
  
  // Process listing event
  async handleListingEvent(event: ListingEvent): Promise<void>;
  
  // Process offer event
  async handleOfferEvent(event: OfferEvent): Promise<void>;
  
  // Process cancellation event
  async handleCancellationEvent(event: CancellationEvent): Promise<void>;
  
  // Update collection analytics after sale
  async updateCollectionAnalytics(contractAddress: string): Promise<void>;
  
  // Update floor price
  async updateFloorPrice(contractAddress: string): Promise<void>;
}
```

### 4. Data Processing Components

#### MetadataProcessor
Fetches and processes NFT metadata:

```typescript
interface MetadataProcessor {
  // Fetch metadata from Alchemy
  fetchFromAlchemy(contractAddress: string, tokenId: string): Promise<AlchemyNFTMetadata>;
  
  // Fetch metadata from token URI
  fetchFromTokenURI(tokenUri: string): Promise<RawMetadata>;
  
  // Parse and normalize metadata
  parseMetadata(rawMetadata: any): Promise<ParsedMetadata>;
  
  // Extract and store attributes
  extractAttributes(metadata: ParsedMetadata): Promise<NFTAttribute[]>;
  
  // Process and store images
  processImages(imageData: ImageData): Promise<ProcessedImages>;
  
  // Store complete NFT data
  storeNFTData(nftData: NFTData): Promise<void>;
}
```

#### OwnershipTracker
Tracks NFT ownership changes:

```typescript
interface OwnershipTracker {
  // Update current owner
  updateCurrentOwner(nftId: string, newOwner: string, txInfo: TxInfo): Promise<void>;
  
  // Record ownership history
  recordOwnershipHistory(nftId: string, owner: string, txInfo: TxInfo): Promise<void>;
  
  // Get current owner
  getCurrentOwner(nftId: string): Promise<string>;
  
  // Get ownership history
  getOwnershipHistory(nftId: string): Promise<OwnershipRecord[]>;
  
  // Update holder count for collection
  updateHolderCount(contractAddress: string): Promise<void>;
}
```

#### AnalyticsCalculator
Calculates collection analytics:

```typescript
interface AnalyticsCalculator {
  // Calculate total volume
  calculateVolume(contractAddress: string, timeframe: Timeframe): Promise<string>;
  
  // Calculate sales count
  calculateSalesCount(contractAddress: string, timeframe: Timeframe): Promise<number>;
  
  // Calculate average price
  calculateAveragePrice(contractAddress: string): Promise<string>;
  
  // Calculate floor price
  calculateFloorPrice(contractAddress: string): Promise<string>;
  
  // Calculate unique holders
  calculateUniqueHolders(contractAddress: string): Promise<number>;
  
  // Update all analytics
  updateAllAnalytics(contractAddress: string): Promise<void>;
}
```

#### RarityCalculator
Calculates NFT rarity:

```typescript
interface RarityCalculator {
  // Calculate attribute prevalence
  calculateAttributePrevalence(contractAddress: string): Promise<Map<string, number>>;
  
  // Calculate rarity score for NFT
  calculateRarityScore(nftId: string): Promise<number>;
  
  // Calculate rank within collection
  calculateRank(nftId: string): Promise<number>;
  
  // Update rarity for entire collection
  updateCollectionRarity(contractAddress: string): Promise<void>;
}
```

### 5. Integration Components

#### AlchemyIntegration
Integrates with Alchemy API:

```typescript
interface AlchemyIntegration {
  // Get NFT metadata
  getNFTMetadata(contractAddress: string, tokenId: string): Promise<AlchemyNFTMetadata>;
  
  // Get contract metadata
  getContractMetadata(contractAddress: string): Promise<AlchemyContractMetadata>;
  
  // Get NFTs for owner
  getNFTsForOwner(ownerAddress: string): Promise<AlchemyNFT[]>;
  
  // Get owners for contract
  getOwnersForContract(contractAddress: string): Promise<AlchemyOwner[]>;
  
  // Check if spam
  isSpamContract(contractAddress: string): Promise<boolean>;
  
  // Get floor price
  getFloorPrice(contractAddress: string): Promise<AlchemyFloorPrice>;
  
  // Get NFT sales
  getNFTSales(options: SalesOptions): Promise<AlchemySale[]>;
}
```

## Data Models

### Core Data Structures

#### NFTData
```typescript
interface NFTData {
  chainId: number;
  contractAddress: string;
  tokenId: string;
  tokenType: 'ERC721' | 'ERC1155';
  name?: string;
  description?: string;
  tokenUri?: string;
  image: ImageData;
  rawMetadata?: any;
  attributes: AttributeData[];
  ownership: OwnershipData;
  mintInfo?: MintInfo;
  isSpam: boolean;
  isAirdrop: boolean;
}
```

#### ImageData
```typescript
interface ImageData {
  cachedUrl?: string;
  thumbnailUrl?: string;
  pngUrl?: string;
  contentType?: string;
  size?: number;
  originalUrl?: string;
}
```

#### AttributeData
```typescript
interface AttributeData {
  traitType: string;
  value: string;
  displayType?: string;
  numericValue?: number;
  prevalence?: number;
  count?: number;
}
```

#### OwnershipData
```typescript
interface OwnershipData {
  currentOwner: string;
  balance: string;
  acquiredAt: Date;
  acquiredBlock: number;
  acquiredTxHash: string;
}
```

#### SaleData
```typescript
interface SaleData {
  marketplace: Marketplace;
  buyer: string;
  seller: string;
  price: string;
  currency: string;
  quantity: string;
  fees: FeeData;
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
}
```

#### FeeData
```typescript
interface FeeData {
  sellerFee?: FeeAmount;
  protocolFee?: FeeAmount;
  royaltyFee?: FeeAmount;
}

interface FeeAmount {
  amount: string;
  currency: string;
}
```

## Error Handling

### Error Types

1. **RPC Errors**: Connection failures, rate limits, timeouts
2. **Database Errors**: Connection failures, constraint violations, deadlocks
3. **API Errors**: Alchemy API failures, rate limits
4. **Validation Errors**: Invalid event data, malformed metadata
5. **Processing Errors**: Failed metadata fetch, image processing failures

### Error Handling Strategy

```typescript
class ErrorHandler {
  // Retry with exponential backoff
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T>;
  
  // Handle RPC errors
  handleRPCError(error: RPCError): Promise<void>;
  
  // Handle database errors
  handleDatabaseError(error: DatabaseError): Promise<void>;
  
  // Handle API errors
  handleAPIError(error: APIError): Promise<void>;
  
  // Log error with context
  logError(error: Error, context: ErrorContext): Promise<void>;
  
  // Send alert for critical errors
  sendAlert(error: Error, severity: Severity): Promise<void>;
}
```

### Retry Logic

```typescript
interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: ErrorType[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'CONNECTION_ERROR']
};
```

## Testing Strategy

### Unit Testing

Unit tests will verify individual components in isolation:

- **Event Handlers**: Test each handler with mock events
- **Data Processors**: Test metadata parsing, attribute extraction
- **Calculators**: Test analytics and rarity calculations
- **Validators**: Test event data validation logic

### Property-Based Testing

Property-based tests will verify universal properties across all inputs using a PBT library (fast-check for TypeScript):


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Complete NFT Data Storage
*For any* indexed NFT, all required fields (contract address, token ID, token type, name, description, token URI) must be present in the database after indexing.
**Validates: Requirements 1.1**

### Property 2: Complete Image Data Storage
*For any* NFT with image metadata, all image fields (cached URL, thumbnail URL, PNG URL, content type, size, original URL) must be stored in the database.
**Validates: Requirements 1.2**

### Property 3: Complete Attribute Storage
*For any* NFT with attributes, each attribute must be stored with trait type, value, and display type in the database.
**Validates: Requirements 1.3**

### Property 4: Metadata Update Timestamp
*For any* NFT metadata update operation, the timeLastUpdated field must be updated to a timestamp greater than or equal to the previous value.
**Validates: Requirements 1.4**

### Property 5: Raw Metadata Preservation
*For any* NFT with raw metadata, storing and then retrieving the raw metadata JSON and token URI must produce equivalent values.
**Validates: Requirements 1.5**

### Property 6: Complete Contract Data Storage
*For any* discovered NFT contract, all required fields (address, name, symbol, total supply, token type) must be present in the database.
**Validates: Requirements 2.1**

### Property 7: Deployer Information Storage
*For any* NFT contract with deployer information, the deployer address and deployed block number must be stored in the database.
**Validates: Requirements 2.2**

### Property 8: Complete OpenSea Metadata Storage
*For any* NFT contract with OpenSea metadata, all OpenSea fields (floor price, collection name, slug, safelist status, images, description, external URL, social links, last ingested timestamp) must be stored in the database.
**Validates: Requirements 2.3**

### Property 9: Contract Metadata Refresh
*For any* contract metadata refresh operation, all contract fields must be updated with the latest blockchain data.
**Validates: Requirements 2.4**

### Property 10: Ownership Update on Transfer
*For any* NFT transfer event, the owner address in the database must be updated to match the transfer recipient.
**Validates: Requirements 3.1, 11.1**

### Property 11: Ownership Query Accuracy
*For any* NFT ownership query, the returned owner address and token balance must match the current ownership records in the database.
**Validates: Requirements 3.2**

### Property 12: Multiple Token Ownership
*For any* owner with multiple tokens from the same contract, all token IDs and their balances must be stored in the database.
**Validates: Requirements 3.3**

### Property 13: Transfer Metadata Recording
*For any* ownership change, the block timestamp and block number of the transfer must be recorded in the database.
**Validates: Requirements 3.4**

### Property 14: Ownership History Preservation
*For any* NFT with multiple transfers, all previous owners must be maintained in the ownership history records.
**Validates: Requirements 3.5**

### Property 15: Complete Listing Data Storage
*For any* marketplace listing event, all listing fields (marketplace name, contract address, token ID, seller, price, currency, expiration time) must be stored in the database.
**Validates: Requirements 4.1**

### Property 16: Complete Sale Data Storage
*For any* marketplace sale event, all sale fields (buyer, seller, price, quantity, fees, block number, transaction hash) must be stored in the database.
**Validates: Requirements 4.2**

### Property 17: Complete Offer Data Storage
*For any* marketplace offer event, all offer fields (offerer, price, quantity, expiration time, status) must be stored in the database.
**Validates: Requirements 4.3**

### Property 18: Cancellation Status Update
*For any* listing or offer cancellation, the status must be updated to CANCELLED and the cancellation timestamp must be recorded.
**Validates: Requirements 4.4**

### Property 19: Spam Flag Setting
*For any* NFT identified as spam, the isSpam flag must be set to true in the database.
**Validates: Requirements 5.2**

### Property 20: Airdrop Flag Setting
*For any* NFT identified as an airdrop, the isAirdrop flag must be set to true in the database.
**Validates: Requirements 5.3**

### Property 21: Spam and Airdrop Filtering
*For any* NFT query with spam/airdrop exclusion filters, the results must not contain any NFTs with isSpam=true or isAirdrop=true.
**Validates: Requirements 5.4**

### Property 22: Spam Status Change Tracking
*For any* spam status change, both the flag and the update timestamp must be updated in the database.
**Validates: Requirements 5.5**

### Property 23: Complete Rarity Calculation
*For any* NFT rarity calculation, all rarity fields (rank, score, prevalence) must be computed and stored.
**Validates: Requirements 6.1**

### Property 24: Attribute Prevalence Calculation
*For any* collection attribute analysis, the prevalence of each attribute value must be calculated as (count of NFTs with that value) / (total NFTs in collection).
**Validates: Requirements 6.2**

### Property 25: Complete Rarity Data Storage
*For any* rarity computation, all rarity fields (strategy ID, strategy version, rank, score, max rank, total supply) must be stored in the database.
**Validates: Requirements 6.3**

### Property 26: Dual Rank Display
*For any* NFT with rarity data, both absolute rank and percentile ranking must be calculated and available.
**Validates: Requirements 6.4**

### Property 27: Rarity Recalculation on Attribute Change
*For any* collection where attributes change, the rarity scores for all affected NFTs must be recalculated.
**Validates: Requirements 6.5**

### Property 28: Complete Floor Price Storage
*For any* floor price retrieval, all floor price fields (price value, currency, marketplace name, collection URL, retrieved timestamp) must be stored.
**Validates: Requirements 7.2**

### Property 29: Lowest Floor Price Identification
*For any* collection with floor prices from multiple marketplaces, the system must correctly identify and store the lowest price.
**Validates: Requirements 7.3**

### Property 30: Floor Price History
*For any* floor price update, the previous price must be recorded in the historical tracking records.
**Validates: Requirements 7.4**

### Property 31: Chain ID Storage
*For any* processed event, the chain ID must be correctly identified and stored in the database.
**Validates: Requirements 8.2**

### Property 32: Chain Filtering
*For any* data query with chain filter, the results must only contain records matching the specified chain ID(s).
**Validates: Requirements 8.3**

### Property 33: Historical Sync Block Range
*For any* historical sync operation with start block S and end block E, all events in blocks [S, E] must be processed.
**Validates: Requirements 9.1**

### Property 34: Sync Resume Correctness
*For any* interrupted sync that processed up to block B, resuming the sync must continue from block B+1.
**Validates: Requirements 9.3**

### Property 35: Blockchain Data Precedence
*For any* conflict between existing database data and blockchain data, the blockchain data must take precedence and overwrite the database.
**Validates: Requirements 9.4**

### Property 36: Sync Completion Marker
*For any* completed sync operation, the collection must be marked as fully synced with a completion timestamp.
**Validates: Requirements 9.5**

### Property 37: Alchemy Data Mapping
*For any* metadata returned by Alchemy API, mapping to database schema and back must preserve all data fields.
**Validates: Requirements 10.2**

### Property 38: Cache Expiration Refresh
*For any* cached data past its TTL, querying the data must trigger a refresh from the source.
**Validates: Requirements 10.4**

### Property 39: Mint Event Identification
*For any* Transfer event where from address is zero address, the event must be recorded as a MINT transfer type.
**Validates: Requirements 11.2**

### Property 40: Burn Event and Supply Update
*For any* Transfer event where to address is zero address, the event must be recorded as a BURN transfer type and total supply must be decremented.
**Validates: Requirements 11.3**

### Property 41: Transfer Activity Recording
*For any* transfer event, an activity record with all transfer details must be created in the database.
**Validates: Requirements 11.4**

### Property 42: Batch Transfer Atomicity
*For any* batch of transfers, either all transfers must be processed successfully or none must be processed (atomic operation).
**Validates: Requirements 11.5**

### Property 43: Attribute Normalization
*For any* stored attributes with various input formats, the trait types and values must be normalized to a consistent format.
**Validates: Requirements 12.1**

### Property 44: Multi-Attribute Filtering
*For any* query with multiple attribute filters, the results must only contain NFTs matching all specified trait combinations.
**Validates: Requirements 12.2**

### Property 45: Attribute Formatting Preservation
*For any* attribute stored in the database, retrieving it must return the original formatting and display type.
**Validates: Requirements 12.4**

### Property 46: Numeric Attribute Storage
*For any* attribute with a numeric value, the value must be stored as a number type to enable range queries.
**Validates: Requirements 12.5**

### Property 47: Complete Analytics Calculation
*For any* collection analytics calculation, all metrics (total volume, total sales, unique holders, average sale price) must be computed.
**Validates: Requirements 14.1**

### Property 48: Time-Based Analytics
*For any* collection, analytics must be available for all specified timeframes (24h, 7d, 30d, all time).
**Validates: Requirements 14.3**

### Property 49: Holder Count Update
*For any* ownership change, the unique holder count for the collection must be updated to reflect current ownership.
**Validates: Requirements 14.4**

### Property 50: Volume Calculation Accuracy
*For any* collection, the calculated volume must equal the sum of all sale prices in the specified currency.
**Validates: Requirements 14.5**

### Property 51: Metadata Caching
*For any* NFT metadata query, the result must be cached and subsequent queries within TTL must return the cached value.
**Validates: Requirements 15.1**

### Property 52: Separate Cache Levels
*For any* system with both contract and token metadata, they must be cached separately with independent TTLs.
**Validates: Requirements 15.2**

### Property 53: Cache Invalidation
*For any* cache invalidation operation, stale entries must be removed and fresh data must be fetched on next query.
**Validates: Requirements 15.3**

### Property 54: Cache Population on Miss
*For any* cache miss, the data must be fetched from the database and the cache must be populated for subsequent requests.
**Validates: Requirements 15.5**

### Property 55: Error Logging Completeness
*For any* error that occurs, the error details, frequency, and affected components must be logged.
**Validates: Requirements 16.2**

## Performance Considerations

### Indexing Performance

1. **Batch Processing**: Process events in batches of 100-1000 to optimize database writes
2. **Parallel Processing**: Process events from different contracts in parallel
3. **Rate Limiting**: Implement rate limiting for RPC calls to avoid provider limits
4. **Connection Pooling**: Use database connection pooling for efficient resource usage

### Query Performance

1. **Database Indexes**: Create indexes on frequently queried fields
2. **Caching Strategy**: Implement multi-level caching (memory, Redis)
3. **Query Optimization**: Use database query optimization techniques
4. **Pagination**: Implement cursor-based pagination for large result sets

### Scalability

1. **Horizontal Scaling**: Design for horizontal scaling across multiple instances
2. **Load Balancing**: Distribute load across multiple RPC providers
3. **Sharding**: Consider sharding by chain ID for very large datasets
4. **Queue System**: Use message queue for event processing (optional)

## Monitoring and Observability

### Metrics to Track

1. **Indexing Metrics**
   - Events processed per second
   - Current block number vs latest block
   - Sync lag (blocks behind)
   - Events per contract

2. **Performance Metrics**
   - RPC call latency
   - Database query latency
   - Cache hit rate
   - Memory usage

3. **Error Metrics**
   - Error rate by type
   - Failed RPC calls
   - Failed database operations
   - Failed metadata fetches

4. **Business Metrics**
   - Total NFTs indexed
   - Total contracts indexed
   - Total sales recorded
   - Total volume tracked

### Alerting

1. **Critical Alerts**
   - Indexer stopped
   - Database connection lost
   - RPC connection lost
   - High error rate (>5%)

2. **Warning Alerts**
   - Sync lag > 100 blocks
   - Cache hit rate < 80%
   - Memory usage > 80%
   - Slow queries detected

3. **Info Alerts**
   - New chain added
   - New marketplace detected
   - Large batch processed
   - Sync completed

## Security Considerations

### Data Validation

1. **Input Validation**: Validate all event data before processing
2. **Address Validation**: Verify Ethereum addresses are valid
3. **Signature Verification**: Verify event signatures match expected format
4. **SQL Injection Prevention**: Use parameterized queries

### Access Control

1. **API Authentication**: Require authentication for write operations
2. **Rate Limiting**: Implement rate limiting on public endpoints
3. **CORS Configuration**: Configure CORS appropriately
4. **Admin Access**: Restrict admin operations to authorized users

### Data Privacy

1. **PII Handling**: Do not store personally identifiable information
2. **Data Encryption**: Encrypt sensitive data at rest
3. **Secure Communication**: Use HTTPS for all API calls
4. **Audit Logging**: Log all administrative actions

## Deployment Strategy

### Development Environment

1. **Local Setup**: Docker Compose with PostgreSQL, Redis
2. **Test Data**: Seed database with test NFT data
3. **Mock Services**: Mock Alchemy API for testing
4. **Hot Reload**: Use tsx watch for development

### Staging Environment

1. **Testnet Indexing**: Index from testnets (Sepolia, Amoy)
2. **Limited Chains**: Start with 1-2 chains
3. **Performance Testing**: Load test with realistic data
4. **Integration Testing**: Test with real RPC providers

### Production Environment

1. **Multi-Chain**: Deploy with all supported chains
2. **High Availability**: Deploy multiple instances
3. **Monitoring**: Full monitoring and alerting setup
4. **Backup Strategy**: Regular database backups
5. **Rollback Plan**: Ability to rollback to previous version

## Migration Strategy

### Phase 1: Database Schema
1. Create new tables for NFT data
2. Add indexes for performance
3. Test schema with sample data
4. Deploy schema changes

### Phase 2: Core Indexing
1. Implement NFT event listeners
2. Implement metadata processor
3. Implement ownership tracker
4. Test with single chain

### Phase 3: Marketplace Integration
1. Implement marketplace event listeners
2. Implement marketplace event handlers
3. Test with OpenSea first
4. Add other marketplaces incrementally

### Phase 4: Analytics and Enrichment
1. Implement analytics calculator
2. Implement rarity calculator
3. Implement Alchemy integration
4. Test analytics accuracy

### Phase 5: Multi-Chain Rollout
1. Deploy to first production chain
2. Monitor and optimize
3. Add additional chains incrementally
4. Full multi-chain deployment

### Phase 6: Optimization
1. Optimize database queries
2. Implement caching
3. Performance tuning
4. Scale horizontally if needed

## Future Enhancements

### Short Term (1-3 months)
1. Add more marketplace support (Rarible, Foundation)
2. Implement advanced filtering and search
3. Add webhook notifications for events
4. Implement GraphQL API

### Medium Term (3-6 months)
1. Add support for non-EVM chains (Solana, Bitcoin)
2. Implement machine learning for spam detection
3. Add price prediction features
4. Implement portfolio tracking

### Long Term (6-12 months)
1. Decentralized indexing with IPFS
2. Real-time WebSocket subscriptions
3. Advanced analytics and insights
4. Mobile SDK for easy integration
