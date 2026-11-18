# Requirements Document: Complete Event Handlers Implementation

## Introduction

This specification defines the requirements for implementing comprehensive database update handlers for all blockchain events in the NFT Indexer & Marketplace system. The system currently has partial implementations for some events (Mint, Marketplace, Metadata) but lacks complete database updates for many critical events including Transfer, Burn, Airdrop, Phase Management, Reveal, Treasury, Royalty, Pause, and Role management events.

## Glossary

- **Event_Handler**: A processor function that handles blockchain events and updates the database accordingly
- **NFT_System**: The complete NFT indexing and marketplace tracking system
- **Launchpad**: A smart contract system for launching NFT collections with phases
- **Marketplace_Event**: Events related to NFT trading (listings, sales, offers, cancellations)
- **Activity_Event**: Events that track administrative and operational changes to launchpads
- **Transfer_Event**: Events tracking NFT ownership changes between addresses
- **Metadata_Event**: Events related to NFT metadata updates and fetching
- **Analytics_Table**: Database tables storing aggregated statistics (launchpad_analytics, nft_collection_analytics)
- **Ownership_Table**: Database tables tracking current and historical NFT ownership
- **Transaction**: A database transaction ensuring atomicity of multiple operations

## Requirements

### Requirement 1: Transfer Event Handler

**User Story:** As a system operator, I want transfer events to update ownership and analytics tables, so that NFT ownership is accurately tracked across all transfer types.

#### Acceptance Criteria

1. WHEN a transfer event occurs, THE Event_Handler SHALL insert a record into nft_transfers table
2. WHEN a transfer event occurs, THE Event_Handler SHALL update the previous owner's nft_ownership record by setting isCurrent to false
3. WHEN a transfer event occurs, THE Event_Handler SHALL insert a new nft_ownership record for the new owner with isCurrent set to true
4. WHEN a transfer event occurs, THE Event_Handler SHALL insert an activity record with type TRANSFER
5. WHEN a transfer is from zero address (mint), THE Event_Handler SHALL set transferType to MINT
6. WHEN a transfer is to zero address (burn), THE Event_Handler SHALL set transferType to BURN
7. WHEN a transfer is between non-zero addresses, THE Event_Handler SHALL set transferType to TRANSFER
8. WHEN a transfer event completes, THE Event_Handler SHALL update nft_collection_analytics uniqueHolders count
9. WHEN a transfer event completes, THE Event_Handler SHALL update launchpad_analytics uniqueHolders count if applicable

### Requirement 2: Burn Event Handler

**User Story:** As a system operator, I want burn events to update supply and ownership tables, so that burned NFTs are properly tracked and removed from circulation.

#### Acceptance Criteria

1. WHEN a burn event occurs, THE Event_Handler SHALL insert a transfer record with transferType BURN
2. WHEN a burn event occurs, THE Event_Handler SHALL update the owner's nft_ownership record by setting isCurrent to false
3. WHEN a burn event occurs, THE Event_Handler SHALL insert an activity record with type BURN
4. WHEN a burn event occurs, THE Event_Handler SHALL decrement nft_contracts totalSupply
5. WHEN a burn event occurs, THE Event_Handler SHALL decrement nft_collection_analytics totalSupply
6. WHEN a burn event occurs, THE Event_Handler SHALL decrement launchpads mintedCount if applicable
7. WHEN a burn event occurs, THE Event_Handler SHALL update nft_collection_analytics uniqueHolders count

### Requirement 3: Airdrop Event Handler

**User Story:** As a system operator, I want airdrop events to track mass distributions, so that airdropped NFTs are properly marked and tracked.

#### Acceptance Criteria

1. WHEN an airdrop event occurs, THE Event_Handler SHALL insert an activity record with type AIRDROP
2. WHEN an airdrop event occurs, THE Event_Handler SHALL update affected nfts records by setting isAirdrop to true
3. WHEN an airdrop event occurs, THE Event_Handler SHALL insert nft_ownership records for all recipients
4. WHEN an airdrop event occurs, THE Event_Handler SHALL insert nft_transfers records for all recipients
5. WHEN an airdrop event occurs, THE Event_Handler SHALL update nft_collection_analytics uniqueHolders count

### Requirement 4: Phase Management Event Handlers

**User Story:** As a system operator, I want phase management events to update phase configurations, so that mint phases are accurately tracked and enforced.

#### Acceptance Criteria

1. WHEN a phase added event occurs, THE Event_Handler SHALL insert a new launchpad_phases record
2. WHEN a phase added event occurs, THE Event_Handler SHALL insert an activity record with type PHASE_ADDED
3. WHEN a phase updated event occurs, THE Event_Handler SHALL update the corresponding launchpad_phases record
4. WHEN a phase updated event occurs, THE Event_Handler SHALL insert an activity record with type PHASE_UPDATED
5. WHEN a phase removed event occurs, THE Event_Handler SHALL delete or mark inactive the launchpad_phases record
6. WHEN a phase removed event occurs, THE Event_Handler SHALL insert an activity record with type PHASE_REMOVED
7. WHEN a phase activated event occurs, THE Event_Handler SHALL set isActive to true for the phase
8. WHEN a phase activated event occurs, THE Event_Handler SHALL insert an activity record with type PHASE_ACTIVATED
9. WHEN a phase deactivated event occurs, THE Event_Handler SHALL set isActive to false for the phase
10. WHEN a phase deactivated event occurs, THE Event_Handler SHALL insert an activity record with type PHASE_DEACTIVATED

### Requirement 5: Reveal Event Handler

**User Story:** As a system operator, I want reveal events to trigger metadata updates, so that NFT metadata is refreshed when collections are revealed.

#### Acceptance Criteria

1. WHEN a reveal event occurs, THE Event_Handler SHALL insert an activity record with type REVEAL
2. WHEN a reveal event occurs, THE Event_Handler SHALL update launchpads baseURI field
3. WHEN a reveal event occurs, THE Event_Handler SHALL queue metadata refresh jobs for all minted tokens
4. WHEN a reveal event occurs, THE Event_Handler SHALL update launchpads updatedAt timestamp

### Requirement 6: Treasury Update Event Handler

**User Story:** As a system operator, I want treasury update events to track treasury changes, so that payment destinations are accurately recorded.

#### Acceptance Criteria

1. WHEN a treasury updated event occurs, THE Event_Handler SHALL update launchpads treasury field
2. WHEN a treasury updated event occurs, THE Event_Handler SHALL insert an activity record with type TREASURY_UPDATED
3. WHEN a treasury updated event occurs, THE Event_Handler SHALL store old and new treasury addresses in activity metadata

### Requirement 7: Royalty Update Event Handler

**User Story:** As a system operator, I want royalty update events to track royalty configurations, so that creator royalties are properly recorded.

#### Acceptance Criteria

1. WHEN a royalty updated event occurs, THE Event_Handler SHALL update launchpads royaltyRecipient field
2. WHEN a royalty updated event occurs, THE Event_Handler SHALL update launchpads royaltyPercentage field
3. WHEN a royalty updated event occurs, THE Event_Handler SHALL insert an activity record with type ROYALTY_UPDATED
4. WHEN a royalty updated event occurs, THE Event_Handler SHALL store old and new royalty settings in activity metadata

### Requirement 8: Metadata URI Update Event Handler

**User Story:** As a system operator, I want metadata URI update events to trigger metadata refreshes, so that NFT metadata stays synchronized with contract changes.

#### Acceptance Criteria

1. WHEN a metadata URI updated event occurs, THE Event_Handler SHALL update launchpads baseURI or contractURI field
2. WHEN a metadata URI updated event occurs, THE Event_Handler SHALL insert an activity record with type METADATA_UPDATED
3. WHEN a metadata URI updated event occurs, THE Event_Handler SHALL queue metadata refresh jobs for affected tokens
4. WHEN a metadata URI updated event occurs for a single token, THE Event_Handler SHALL queue refresh for that specific token only

### Requirement 9: Pause Event Handlers

**User Story:** As a system operator, I want pause events to track contract pause states, so that paused contracts are properly identified.

#### Acceptance Criteria

1. WHEN a paused event occurs, THE Event_Handler SHALL update launchpads status to PAUSED
2. WHEN a paused event occurs, THE Event_Handler SHALL insert an activity record with type PAUSED
3. WHEN an unpaused event occurs, THE Event_Handler SHALL update launchpads status to ACTIVE
4. WHEN an unpaused event occurs, THE Event_Handler SHALL insert an activity record with type UNPAUSED

### Requirement 10: Role Management Event Handlers

**User Story:** As a system operator, I want role management events to track administrative permissions, so that role changes are properly logged.

#### Acceptance Criteria

1. WHEN a role granted event occurs, THE Event_Handler SHALL insert an activity record with type ROLE_GRANTED
2. WHEN a role granted event occurs, THE Event_Handler SHALL store role and account information in activity metadata
3. WHEN a role revoked event occurs, THE Event_Handler SHALL insert an activity record with type ROLE_REVOKED
4. WHEN a role revoked event occurs, THE Event_Handler SHALL store role and account information in activity metadata

### Requirement 11: Fee Update Event Handlers

**User Story:** As a system operator, I want fee update events to track fee changes, so that platform and creation fees are accurately recorded.

#### Acceptance Criteria

1. WHEN a platform fee updated event occurs, THE Event_Handler SHALL update launchpad_factories platformFeePercentage field
2. WHEN a platform fee updated event occurs, THE Event_Handler SHALL insert an activity record with type PLATFORM_FEE_UPDATED
3. WHEN a creation fee updated event occurs, THE Event_Handler SHALL update launchpad_factories creationFee field
4. WHEN a creation fee updated event occurs, THE Event_Handler SHALL insert an activity record with type CREATION_FEE_UPDATED

### Requirement 12: Marketplace Sale Ownership Updates

**User Story:** As a system operator, I want marketplace sales to update ownership tables, so that NFT ownership changes from sales are properly tracked.

#### Acceptance Criteria

1. WHEN a marketplace sale occurs, THE Event_Handler SHALL update the seller's nft_ownership record by setting isCurrent to false
2. WHEN a marketplace sale occurs, THE Event_Handler SHALL insert a new nft_ownership record for the buyer
3. WHEN a marketplace sale occurs, THE Event_Handler SHALL insert a nft_transfers record with transferType SALE
4. WHEN a marketplace sale occurs, THE Event_Handler SHALL update the related marketplace_listings status to SOLD
5. WHEN a marketplace sale occurs, THE Event_Handler SHALL update nft_collection_analytics with sale data

### Requirement 13: Transaction Atomicity

**User Story:** As a system operator, I want all database operations for an event to execute atomically, so that partial updates cannot corrupt the database state.

#### Acceptance Criteria

1. WHEN processing any event, THE Event_Handler SHALL wrap all database operations in a Transaction
2. WHEN any database operation fails, THE Event_Handler SHALL rollback the entire Transaction
3. WHEN all database operations succeed, THE Event_Handler SHALL commit the Transaction
4. WHEN a Transaction rollback occurs, THE Event_Handler SHALL log the error with full context

### Requirement 14: Error Handling and Logging

**User Story:** As a system operator, I want comprehensive error logging for all event handlers, so that failures can be diagnosed and resolved.

#### Acceptance Criteria

1. WHEN any event handler encounters an error, THE Event_Handler SHALL insert a record into error_logs table
2. WHEN logging an error, THE Event_Handler SHALL include errorType, severity, message, stack, component, and operation
3. WHEN logging an error, THE Event_Handler SHALL include chainId, contractAddress, tokenId, txHash, and blockNumber when available
4. WHEN an error is logged, THE Event_Handler SHALL set resolved to false
5. WHEN an error occurs, THE Event_Handler SHALL continue processing other events without stopping the entire system

### Requirement 15: Idempotency

**User Story:** As a system operator, I want event handlers to be idempotent, so that reprocessing events does not create duplicate or inconsistent data.

#### Acceptance Criteria

1. WHEN processing a transfer event, THE Event_Handler SHALL check if the transfer already exists by txHash and logIndex
2. WHEN processing a mint event, THE Event_Handler SHALL check if the mint already exists by txHash
3. WHEN processing a marketplace event, THE Event_Handler SHALL check if the event already exists by txHash and logIndex
4. WHEN an event already exists, THE Event_Handler SHALL skip processing and return success
5. WHEN checking for existing events, THE Event_Handler SHALL use unique indexes for efficient lookups

### Requirement 16: Analytics Recalculation

**User Story:** As a system operator, I want analytics to be recalculated after relevant events, so that statistics remain accurate and up-to-date.

#### Acceptance Criteria

1. WHEN a mint, burn, or transfer event occurs, THE Event_Handler SHALL update nft_collection_analytics
2. WHEN a mint or burn event occurs, THE Event_Handler SHALL update launchpad_analytics
3. WHEN a marketplace sale occurs, THE Event_Handler SHALL update nft_collection_analytics with volume and sales data
4. WHEN updating analytics, THE Event_Handler SHALL use upsert operations to handle missing analytics records
5. WHEN calculating uniqueHolders, THE Event_Handler SHALL count distinct current owners from nft_ownership table

### Requirement 17: Batch Processing Support

**User Story:** As a system operator, I want event handlers to support batch processing, so that historical sync and high-volume events can be processed efficiently.

#### Acceptance Criteria

1. WHEN processing multiple events of the same type, THE Event_Handler SHALL support batch insert operations
2. WHEN batch processing, THE Event_Handler SHALL maintain transaction atomicity per batch
3. WHEN a batch operation fails, THE Event_Handler SHALL retry individual items from the failed batch
4. WHEN batch processing, THE Event_Handler SHALL limit batch size to prevent memory issues
5. WHEN batch processing completes, THE Event_Handler SHALL update analytics once per batch rather than per event

### Requirement 18: Rate Limiting and Retry Logic

**User Story:** As a system operator, I want event handlers to implement rate limiting and retry logic, so that database overload is prevented and transient failures are handled gracefully.

#### Acceptance Criteria

1. WHEN processing events, THE Event_Handler SHALL implement exponential backoff for retries
2. WHEN a database operation fails, THE Event_Handler SHALL retry up to 3 times before logging an error
3. WHEN rate limiting is triggered, THE Event_Handler SHALL delay processing to avoid overwhelming the database
4. WHEN retrying operations, THE Event_Handler SHALL use increasing delays (1s, 2s, 4s)
5. WHEN maximum retries are exceeded, THE Event_Handler SHALL log the failure and continue with other events
