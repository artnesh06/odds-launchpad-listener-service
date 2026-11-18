# Requirements Document

## Introduction

Sistem ini akan mengembangkan NFT Activity Listener Service yang sudah ada menjadi indexer NFT lengkap multi-chain. Sistem akan menambahkan kemampuan untuk menyimpan metadata NFT lengkap (seperti Alchemy), tracking marketplace events dari berbagai platform (OpenSea, Magic Eden, Blur, LooksRare, dll), dan menyediakan data NFT yang komprehensif untuk semua chain yang didukung.

## Glossary

- **NFT Indexer**: Sistem yang mengumpulkan, menyimpan, dan mengindeks data NFT dari blockchain
- **Marketplace Event**: Event yang terjadi di marketplace NFT seperti listing, sale, offer, cancel
- **Metadata**: Informasi deskriptif tentang NFT termasuk nama, deskripsi, gambar, dan attributes
- **Attributes**: Properti atau traits dari NFT (contoh: Background: Blue, Rarity: Rare)
- **Contract Metadata**: Informasi tentang NFT collection/contract seperti nama, symbol, total supply
- **Activity Listener**: Service yang mendengarkan dan merekam events dari blockchain
- **Multi-chain**: Mendukung multiple blockchain networks (Ethereum, Polygon, BSC, Base, dll)
- **Floor Price**: Harga terendah untuk NFT dalam sebuah collection
- **Spam Detection**: Kemampuan untuk mendeteksi dan menandai NFT spam atau airdrop
- **Alchemy API**: API pihak ketiga untuk data NFT yang digunakan sebagai referensi struktur data

## Requirements

### Requirement 1

**User Story:** As a developer, I want to store complete NFT metadata in the database, so that I can display NFT information without repeatedly calling external APIs.

#### Acceptance Criteria

1. WHEN an NFT is indexed THEN the system SHALL store the contract address, token ID, token type, name, description, and token URI
2. WHEN NFT metadata includes images THEN the system SHALL store cached URL, thumbnail URL, PNG URL, content type, size, and original URL
3. WHEN NFT has attributes THEN the system SHALL store each attribute with trait type, value, and display type
4. WHEN NFT metadata is updated THEN the system SHALL update the timeLastUpdated field with current timestamp
5. WHEN storing raw metadata THEN the system SHALL preserve the original metadata JSON and token URI

### Requirement 2

**User Story:** As a developer, I want to store NFT contract metadata, so that I can display collection information accurately.

#### Acceptance Criteria

1. WHEN a new NFT contract is discovered THEN the system SHALL store contract address, name, symbol, total supply, and token type
2. WHEN contract has deployer information THEN the system SHALL store contract deployer address and deployed block number
3. WHEN OpenSea metadata is available THEN the system SHALL store floor price, collection name, slug, safelist status, images, description, external URL, social links, and last ingested timestamp
4. WHEN contract metadata is refreshed THEN the system SHALL update all fields with latest data from blockchain
5. WHEN multiple contracts are processed THEN the system SHALL handle batch operations efficiently

### Requirement 3

**User Story:** As a developer, I want to track NFT ownership, so that I can show who owns which NFTs.

#### Acceptance Criteria

1. WHEN an NFT is transferred THEN the system SHALL update the owner address for that token
2. WHEN querying NFT ownership THEN the system SHALL return current owner address and token balance
3. WHEN an owner has multiple tokens THEN the system SHALL store all token IDs with their balances
4. WHEN ownership changes THEN the system SHALL record the block timestamp and block number of the transfer
5. WHEN tracking ownership history THEN the system SHALL maintain a record of all previous owners

### Requirement 4

**User Story:** As a developer, I want to index marketplace events from multiple platforms, so that I can track all NFT trading activity.

#### Acceptance Criteria

1. WHEN a listing is created on any supported marketplace THEN the system SHALL record the marketplace name, contract address, token ID, seller, price, currency, and expiration time
2. WHEN a sale occurs THEN the system SHALL record buyer address, seller address, price, quantity, marketplace fees, protocol fees, royalty fees, block number, and transaction hash
3. WHEN an offer is made THEN the system SHALL record offerer address, price, quantity, expiration time, and offer status
4. WHEN a listing or offer is cancelled THEN the system SHALL update the status to cancelled and record the cancellation timestamp
5. WHEN processing marketplace events THEN the system SHALL support OpenSea, Magic Eden, Blur, LooksRare, X2Y2, and Rarible

### Requirement 5

**User Story:** As a developer, I want to detect and mark spam NFTs, so that users can filter out unwanted content.

#### Acceptance Criteria

1. WHEN analyzing an NFT contract THEN the system SHALL check if the contract is marked as spam by Alchemy or other spam detection services
2. WHEN an NFT is identified as spam THEN the system SHALL set the isSpam flag to true in the database
3. WHEN an NFT is an airdrop THEN the system SHALL set the isAirdrop flag to true
4. WHEN querying NFTs THEN the system SHALL provide options to exclude spam and airdrop NFTs
5. WHEN spam status changes THEN the system SHALL update the flag and record the update timestamp

### Requirement 6

**User Story:** As a developer, I want to calculate and store NFT rarity data, so that users can see how rare their NFTs are.

#### Acceptance Criteria

1. WHEN calculating rarity THEN the system SHALL compute rarity rank, score, and prevalence for each NFT
2. WHEN attributes are analyzed THEN the system SHALL calculate the prevalence of each attribute value in the collection
3. WHEN rarity is computed THEN the system SHALL store strategy ID, strategy version, rank, score, max rank, and total supply
4. WHEN displaying rarity THEN the system SHALL show both absolute rank and percentile ranking
5. WHEN collection attributes change THEN the system SHALL recalculate rarity scores for affected NFTs

### Requirement 7

**User Story:** As a developer, I want to track floor prices from multiple marketplaces, so that users can see accurate pricing information.

#### Acceptance Criteria

1. WHEN fetching floor price THEN the system SHALL query OpenSea, LooksRare, Blur, and Magic Eden
2. WHEN floor price is retrieved THEN the system SHALL store the price value, currency, marketplace name, collection URL, and retrieved timestamp
3. WHEN multiple marketplaces have different prices THEN the system SHALL store all prices and identify the lowest
4. WHEN floor price is updated THEN the system SHALL record the previous price for historical tracking
5. WHEN floor price is unavailable THEN the system SHALL handle the null value gracefully and retry later

### Requirement 8

**User Story:** As a developer, I want to support multi-chain indexing, so that the system works across all major blockchain networks.

#### Acceptance Criteria

1. WHEN indexing NFTs THEN the system SHALL support Ethereum Mainnet, Polygon, BSC, Arbitrum, Optimism, Base, Avalanche, and testnets
2. WHEN processing events THEN the system SHALL correctly identify and store the chain ID for each event
3. WHEN querying data THEN the system SHALL allow filtering by specific chains or querying across all chains
4. WHEN a new chain is added THEN the system SHALL require only configuration changes without code modifications
5. WHEN handling chain-specific features THEN the system SHALL adapt to different block times and gas mechanisms

### Requirement 9

**User Story:** As a developer, I want to sync historical NFT data, so that the database contains complete historical information.

#### Acceptance Criteria

1. WHEN starting historical sync THEN the system SHALL process events from a specified start block to current block
2. WHEN syncing large ranges THEN the system SHALL process events in batches to avoid memory issues
3. WHEN sync is interrupted THEN the system SHALL resume from the last successfully processed block
4. WHEN historical data conflicts with existing data THEN the system SHALL use the blockchain as source of truth
5. WHEN sync is complete THEN the system SHALL mark the collection as fully synced with a timestamp

### Requirement 10

**User Story:** As a developer, I want to integrate with Alchemy API, so that I can enrich NFT data with additional metadata.

#### Acceptance Criteria

1. WHEN NFT metadata is incomplete THEN the system SHALL query Alchemy API to fetch missing data
2. WHEN Alchemy returns metadata THEN the system SHALL map the response to database schema exactly
3. WHEN API rate limits are reached THEN the system SHALL implement exponential backoff and retry logic
4. WHEN Alchemy data is cached THEN the system SHALL respect cache expiration and refresh stale data
5. WHEN Alchemy API is unavailable THEN the system SHALL fall back to direct blockchain queries

### Requirement 11

**User Story:** As a developer, I want to track NFT transfers and burns, so that I can maintain accurate ownership and supply data.

#### Acceptance Criteria

1. WHEN a Transfer event is detected THEN the system SHALL update ownership records for the token
2. WHEN transfer is from zero address THEN the system SHALL record it as a mint event
3. WHEN transfer is to zero address THEN the system SHALL record it as a burn event and update total supply
4. WHEN transfer occurs THEN the system SHALL create an activity record with transfer details
5. WHEN batch transfers occur THEN the system SHALL process all transfers in the batch atomically

### Requirement 12

**User Story:** As a developer, I want to store and query NFT attributes efficiently, so that filtering and searching by traits is fast.

#### Acceptance Criteria

1. WHEN storing attributes THEN the system SHALL normalize trait types and values for consistent querying
2. WHEN querying by attributes THEN the system SHALL support filtering by multiple trait combinations
3. WHEN attributes are indexed THEN the system SHALL create database indexes for common query patterns
4. WHEN displaying attributes THEN the system SHALL preserve original formatting and display types
5. WHEN attribute values are numeric THEN the system SHALL store them as numbers for range queries

### Requirement 13

**User Story:** As a developer, I want to handle marketplace-specific event formats, so that all marketplace events are captured correctly.

#### Acceptance Criteria

1. WHEN processing OpenSea Seaport events THEN the system SHALL decode OrderFulfilled, OrderCancelled, and CounterIncremented events
2. WHEN processing Blur events THEN the system SHALL decode OrdersMatched and OrderCancelled events
3. WHEN processing LooksRare events THEN the system SHALL decode TakerAsk and TakerBid events
4. WHEN processing Magic Eden events THEN the system SHALL decode BuyListingERC721 and SellOfferERC721 events
5. WHEN new marketplace versions are released THEN the system SHALL support multiple contract versions simultaneously

### Requirement 14

**User Story:** As a developer, I want to calculate collection analytics, so that users can see trading volume, holder count, and other metrics.

#### Acceptance Criteria

1. WHEN calculating analytics THEN the system SHALL compute total volume, total sales, unique holders, and average sale price
2. WHEN analytics are updated THEN the system SHALL recalculate metrics incrementally for efficiency
3. WHEN displaying analytics THEN the system SHALL provide time-based breakdowns (24h, 7d, 30d, all time)
4. WHEN holder count changes THEN the system SHALL update the count based on current ownership data
5. WHEN volume is calculated THEN the system SHALL sum all sale prices in the native currency and USD equivalent

### Requirement 15

**User Story:** As a developer, I want to implement efficient caching strategies, so that frequently accessed data loads quickly.

#### Acceptance Criteria

1. WHEN NFT metadata is queried THEN the system SHALL cache the result with appropriate TTL
2. WHEN contract metadata is accessed THEN the system SHALL cache collection-level data separately from token-level data
3. WHEN cache is invalidated THEN the system SHALL remove stale entries and fetch fresh data
4. WHEN high-traffic queries occur THEN the system SHALL use cache to reduce database load
5. WHEN cache misses happen THEN the system SHALL fetch from database and populate cache for subsequent requests

### Requirement 16

**User Story:** As a developer, I want to monitor indexer health and performance, so that I can identify and fix issues quickly.

#### Acceptance Criteria

1. WHEN indexer is running THEN the system SHALL report current block number, sync status, and events processed per second
2. WHEN errors occur THEN the system SHALL log error details, frequency, and affected components
3. WHEN performance degrades THEN the system SHALL alert administrators with specific metrics
4. WHEN monitoring health THEN the system SHALL track RPC connection status, database connection status, and memory usage
5. WHEN generating reports THEN the system SHALL provide daily summaries of indexed events, errors, and performance metrics
