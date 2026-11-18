# Design Document: Complete Event Handlers Implementation

## Overview

This design document specifies the implementation of comprehensive database update handlers for all blockchain events in the NFT Indexer & Marketplace system. The system currently has partial implementations for Mint, Marketplace, and Metadata events but lacks complete database updates for Transfer, Burn, Airdrop, Phase Management, Reveal, Treasury, Royalty, Pause, and Role management events.

The design follows the existing architecture patterns established in the codebase, utilizing:
- Event handlers extending `BaseEventHandler` for consistent error handling and validation
- Queue processors for asynchronous event processing with retry logic
- Database transactions for atomicity
- WebSocket event emission for real-time updates
- Comprehensive error logging to the `error_logs` table

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Blockchain Listeners                      │
│  (activity-listener, nft-event-listener,                    │
│   marketplace-event-listener)                                │
└────────────────────┬────────────────────────────────────────┘
                     │ Emit Events
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      Event Handlers                          │
│  - NFTEventHandler (Transfer, Burn)                         │
│  - MarketplaceEventHandler (Sale ownership updates)         │
│  - ActivityEventHandler (Phase, Reveal, Treasury, etc.)     │
└────────────────────┬────────────────────────────────────────┘
                     │ Queue Jobs
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                     Queue Processors                         │
│  - TransferEventProcessor (new)                             │
│  - BurnEventProcessor (new)                                 │
│  - PhaseEventProcessor (new)                                │
│  - ActivityEventProcessor (enhanced)                        │
└────────────────────┬────────────────────────────────────────┘
                     │ Database Operations
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Database (PostgreSQL)                     │
│  Tables: nfts, nft_ownership, nft_transfers,               │
│  launchpads, launchpad_phases, activities, etc.             │
└─────────────────────────────────────────────────────────────┘
```

### Event Flow Pattern


1. **Event Detection**: Blockchain listener detects event from smart contract
2. **Event Handler**: Handler validates event data and queues processing job
3. **Queue Processor**: Processes job with retry logic and database transactions
4. **Database Updates**: Atomic updates to multiple tables within transaction
5. **Analytics Recalculation**: Update aggregated statistics
6. **WebSocket Emission**: Broadcast real-time updates to connected clients
7. **Error Logging**: Log any failures to `error_logs` table

### Design Principles

1. **Idempotency**: All event handlers check for duplicates before processing
2. **Atomicity**: Database operations wrapped in transactions
3. **Resilience**: Retry logic with exponential backoff for transient failures
4. **Observability**: Comprehensive logging and error tracking
5. **Performance**: Batch operations where possible, connection pooling
6. **Consistency**: Follow existing patterns from mint and marketplace handlers

## Components and Interfaces

### 1. Enhanced NFTEventHandler

**Location**: `src/lib/blockchain/event-handlers/nft-events.ts`

**Current State**: Implements Transfer (mint only), partial burn support

**Enhancements Needed**:
- Complete burn event handling with supply updates
- Standalone transfer event handling (non-mint transfers)
- Analytics recalculation after ownership changes

**Key Methods**:
```typescript
class NFTEventHandler extends BaseEventHandler {
  // Existing
  async handleTransferEvent(transferData: TransferEventData): Promise<void>
  
  // Enhanced
  private async handleBurn(transferData: TransferEventData): Promise<void>
  private async handleRegularTransfer(transferData: TransferEventData): Promise<void>
  private async updateCollectionAnalytics(contractAddress: string): Promise<void>
}
```

### 2. Enhanced MarketplaceEventHandler

**Location**: `src/lib/blockchain/event-handlers/marketplace-events.ts`

**Current State**: Handles sale, listing, offer, cancellation events

**Enhancements Needed**:
- Update NFT ownership on marketplace sales
- Create transfer records for sales
- Update analytics with sale data

**Key Methods**:
```typescript
class MarketplaceEventHandler extends BaseEventHandler {
  // Enhanced
  async handleSaleEvent(saleData: SaleEventData): Promise<void>
  private async updateOwnershipOnSale(saleData: SaleEventData): Promise<void>
  private async createSaleTransferRecord(saleData: SaleEventData): Promise<void>
}
```

### 3. New ActivityEventHandler

**Location**: `src/lib/blockchain/event-handlers/activity-events.ts` (new file)

**Purpose**: Handle launchpad administrative and operational events

**Key Methods**:
```typescript
class ActivityEventHandler extends BaseEventHandler {
  // Phase Management
  async handlePhaseAdded(phaseData: PhaseAddedData): Promise<void>
  async handlePhaseUpdated(phaseData: PhaseUpdatedData): Promise<void>
  async handlePhaseRemoved(phaseData: PhaseRemovedData): Promise<void>
  async handlePhaseActivated(phaseData: PhaseActivatedData): Promise<void>
  async handlePhaseDeactivated(phaseData: PhaseDeactivatedData): Promise<void>
  
  // Metadata & Configuration
  async handleReveal(revealData: RevealData): Promise<void>
  async handleTreasuryUpdate(treasuryData: TreasuryUpdateData): Promise<void>
  async handleRoyaltyUpdate(royaltyData: RoyaltyUpdateData): Promise<void>
  async handleMetadataURIUpdate(metadataData: MetadataUpdateData): Promise<void>
  
  // Contract State
  async handlePaused(pauseData: PauseData): Promise<void>
  async handleUnpaused(unpauseData: UnpauseData): Promise<void>
  
  // Access Control
  async handleRoleGranted(roleData: RoleGrantedData): Promise<void>
  async handleRoleRevoked(roleData: RoleRevokedData): Promise<void>
  
  // Factory Events
  async handlePlatformFeeUpdate(feeData: FeeUpdateData): Promise<void>
  async handleCreationFeeUpdate(feeData: FeeUpdateData): Promise<void>
}
```

### 4. New AirdropEventHandler

**Location**: `src/lib/blockchain/event-handlers/airdrop-events.ts` (new file)

**Purpose**: Handle batch NFT distribution events

**Key Methods**:
```typescript
class AirdropEventHandler extends BaseEventHandler {
  async handleAirdrop(airdropData: AirdropData): Promise<void>
  private async createBatchNFTs(recipients: string[], tokenIds: string[]): Promise<void>
  private async createBatchOwnership(nftIds: string[], recipients: string[]): Promise<void>
  private async createBatchTransfers(transferData: TransferData[]): Promise<void>
}
```

## Data Models

### Event Data Interfaces


```typescript
// Phase Management
interface PhaseAddedData {
  chainId: number;
  launchpadAddress: string;
  phaseIndex: number;
  name: string;
  phaseType: PhaseType;
  startTime: Date;
  endTime?: Date;
  price: string;
  maxMintPerWallet?: number;
  totalLimit?: number;
  merkleRoot?: string;
  txHash: string;
  blockNumber: number;
}

interface PhaseUpdatedData extends PhaseAddedData {
  // Same fields as PhaseAddedData
}

interface PhaseRemovedData {
  chainId: number;
  launchpadAddress: string;
  phaseIndex: number;
  txHash: string;
  blockNumber: number;
}

interface PhaseActivatedData {
  chainId: number;
  launchpadAddress: string;
  phaseIndex: number;
  txHash: string;
  blockNumber: number;
}

// Reveal Event
interface RevealData {
  chainId: number;
  launchpadAddress: string;
  newBaseURI: string;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
}

// Treasury Update
interface TreasuryUpdateData {
  chainId: number;
  launchpadAddress: string;
  oldTreasury: string;
  newTreasury: string;
  txHash: string;
  blockNumber: number;
}

// Royalty Update
interface RoyaltyUpdateData {
  chainId: number;
  launchpadAddress: string;
  oldRecipient: string;
  newRecipient: string;
  oldPercentage: number;
  newPercentage: number;
  txHash: string;
  blockNumber: number;
}

// Metadata URI Update
interface MetadataUpdateData {
  chainId: number;
  launchpadAddress: string;
  tokenId?: string; // Optional - if null, applies to all tokens
  newURI: string;
  updateType: 'BASE_URI' | 'CONTRACT_URI' | 'TOKEN_URI';
  txHash: string;
  blockNumber: number;
}

// Pause Events
interface PauseData {
  chainId: number;
  launchpadAddress: string;
  txHash: string;
  blockNumber: number;
}

// Role Management
interface RoleGrantedData {
  chainId: number;
  launchpadAddress: string;
  role: string;
  account: string;
  sender: string;
  txHash: string;
  blockNumber: number;
}

interface RoleRevokedData extends RoleGrantedData {
  // Same fields as RoleGrantedData
}

// Fee Updates
interface FeeUpdateData {
  chainId: number;
  factoryAddress: string;
  oldFee: string;
  newFee: string;
  feeType: 'PLATFORM_FEE' | 'CREATION_FEE';
  txHash: string;
  blockNumber: number;
}

// Airdrop Event
interface AirdropData {
  chainId: number;
  launchpadAddress: string;
  recipients: string[];
  tokenIds: string[];
  txHash: string;
  blockNumber: number;
  timestamp: Date;
}
```

### Database Operations Summary

**Transfer Event** (Requirements 1.1-1.9):
- INSERT: `nft_transfers`, `nft_ownership`, `activities`
- UPDATE: `nft_ownership` (set isCurrent=false for previous owner), `nft_collection_analytics` (uniqueHolders), `launchpad_analytics` (uniqueHolders)

**Burn Event** (Requirements 2.1-2.7):
- INSERT: `nft_transfers`, `activities`
- UPDATE: `nft_ownership` (set isCurrent=false), `nft_contracts` (totalSupply--), `nft_collection_analytics` (totalSupply--, uniqueHolders), `launchpads` (mintedCount--)

**Airdrop Event** (Requirements 3.1-3.5):
- INSERT: `activities`, `nfts` (batch), `nft_ownership` (batch), `nft_transfers` (batch)
- UPDATE: `nft_collection_analytics` (uniqueHolders)

**Phase Management** (Requirements 4.1-4.10):
- INSERT: `launchpad_phases`, `activities`
- UPDATE: `launchpad_phases` (for updates), DELETE/UPDATE `launchpad_phases` (for removal)

**Reveal Event** (Requirements 5.1-5.4):
- INSERT: `activities`, metadata refresh queue jobs
- UPDATE: `launchpads` (baseURI, updatedAt)

**Treasury Update** (Requirements 6.1-6.3):
- INSERT: `activities`
- UPDATE: `launchpads` (treasury)

**Royalty Update** (Requirements 7.1-7.4):
- INSERT: `activities`
- UPDATE: `launchpads` (royaltyRecipient, royaltyPercentage)

**Metadata URI Update** (Requirements 8.1-8.4):
- INSERT: `activities`, metadata refresh queue jobs
- UPDATE: `launchpads` (baseURI or contractURI)

**Pause Events** (Requirements 9.1-9.4):
- INSERT: `activities`
- UPDATE: `launchpads` (status)

**Role Management** (Requirements 10.1-10.4):
- INSERT: `activities`

**Fee Updates** (Requirements 11.1-11.4):
- INSERT: `activities`
- UPDATE: `launchpad_factories` (platformFeePercentage or creationFee)

**Marketplace Sale Ownership** (Requirements 12.1-12.5):
- INSERT: `nft_ownership`, `nft_transfers`
- UPDATE: `nft_ownership` (set isCurrent=false for seller), `marketplace_listings` (status=SOLD), `nft_collection_analytics`

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property Reflection

After analyzing all acceptance criteria, several properties can be consolidated to eliminate redundancy:

**Activity Logging Consolidation**: Many requirements (1.4, 2.3, 3.1, 4.2, 4.4, 4.6, 4.8, 4.10, 5.1, 6.2, 7.3, 8.2, 9.2, 9.4, 10.1, 10.3, 11.2, 11.4) all test that activity records are created for events. These can be combined into a single comprehensive property about activity logging.

**Transfer Type Classification**: Requirements 1.5, 1.6, 1.7 all test the same classification logic with different inputs. These can be combined into one property about correct transfer type determination.

**Ownership Update Pattern**: Requirements 1.2, 1.3, 2.2, 12.1, 12.2 all test the same ownership update pattern (mark old as not current, create new as current). These can be combined into one comprehensive property.

**Analytics Update Pattern**: Requirements 1.8, 1.9, 2.5, 2.7, 3.5, 16.1, 16.2, 16.3 all test that analytics are updated after events. These can be combined into properties about analytics recalculation.

**Idempotency Pattern**: Requirements 15.1, 15.2, 15.3, 15.4 all test the same idempotency behavior. These can be combined into one property about duplicate event handling.

**Error Handling Pattern**: Requirements 14.1, 14.2, 14.3, 14.4 all test error logging structure. These can be combined into one property about complete error logging.

### Correctness Properties

**Property 1: Transfer Record Creation**
*For any* transfer event (mint, burn, or regular transfer), a corresponding record SHALL be inserted into the nft_transfers table with the correct transferType, addresses, and transaction details.
**Validates: Requirements 1.1, 1.5, 1.6, 1.7, 2.1**

**Property 2: Ownership State Transition**
*For any* transfer event, the system SHALL atomically update ownership by marking the previous owner's nft_ownership record as isCurrent=false and creating a new nft_ownership record for the new owner with isCurrent=true.
**Validates: Requirements 1.2, 1.3, 2.2, 12.1, 12.2**

**Property 3: Activity Logging Completeness**
*For any* blockchain event processed by the system, an activity record SHALL be inserted with the appropriate ActivityType and complete metadata including actor, description, txHash, and blockNumber.
**Validates: Requirements 1.4, 2.3, 3.1, 4.2, 4.4, 4.6, 4.8, 4.10, 5.1, 6.2, 7.3, 8.2, 9.2, 9.4, 10.1, 10.3, 11.2, 11.4**

**Property 4: Supply Tracking Consistency**
*For any* burn event, the system SHALL decrement totalSupply in both nft_contracts and nft_collection_analytics tables, and decrement mintedCount in launchpads table if the NFT belongs to a launchpad.
**Validates: Requirements 2.4, 2.5, 2.6**

**Property 5: Unique Holders Recalculation**
*For any* event that changes NFT ownership (transfer, burn, airdrop, sale), the system SHALL recalculate uniqueHolders in nft_collection_analytics by counting distinct ownerAddress values where isCurrent=true.
**Validates: Requirements 1.8, 1.9, 2.7, 3.5, 16.5**

**Property 6: Batch Airdrop Atomicity**
*For any* airdrop event with multiple recipients, the system SHALL create nft records, nft_ownership records, and nft_transfers records for all recipients atomically, such that either all are created or none are created.
**Validates: Requirements 3.2, 3.3, 3.4**

**Property 7: Phase Management Data Integrity**
*For any* phase management event (added, updated, removed, activated, deactivated), the system SHALL update the launchpad_phases table to reflect the current phase configuration with correct phaseIndex, isActive status, and phase parameters.
**Validates: Requirements 4.1, 4.3, 4.5, 4.7, 4.9**

**Property 8: Reveal Metadata Refresh Trigger**
*For any* reveal event, the system SHALL update the launchpad baseURI and queue metadata refresh jobs for all minted tokens in that launchpad.
**Validates: Requirements 5.2, 5.3, 5.4**

**Property 9: Configuration Update Preservation**
*For any* configuration update event (treasury, royalty, metadata URI, fees), the system SHALL update the target field in the database and preserve both old and new values in the activity metadata for audit purposes.
**Validates: Requirements 6.1, 6.3, 7.1, 7.2, 7.4, 8.1, 11.1, 11.3**

**Property 10: Metadata Refresh Specificity**
*For any* metadata URI update event, if a specific tokenId is provided, the system SHALL queue a metadata refresh job for only that token; if no tokenId is provided, the system SHALL queue refresh jobs for all minted tokens.
**Validates: Requirements 8.3, 8.4**

**Property 11: Contract State Synchronization**
*For any* pause or unpause event, the system SHALL update the launchpad status field to match the contract's pause state (PAUSED or ACTIVE).
**Validates: Requirements 9.1, 9.3**

**Property 12: Marketplace Sale Ownership Transfer**
*For any* marketplace sale event, the system SHALL create a nft_transfers record with transferType SALE, update ownership from seller to buyer, update the listing status to SOLD, and update nft_collection_analytics with the sale data.
**Validates: Requirements 12.3, 12.4, 12.5**

**Property 13: Transaction Atomicity and Rollback**
*For any* event processing that encounters a database error, the system SHALL rollback all database operations for that event and log the error to the error_logs table with complete context.
**Validates: Requirements 13.2, 13.4**

**Property 14: Error Logging Completeness**
*For any* error encountered during event processing, the system SHALL insert a record into error_logs table containing errorType, severity, message, stack, component, operation, and all available context (chainId, contractAddress, tokenId, txHash, blockNumber) with resolved=false.
**Validates: Requirements 14.1, 14.2, 14.3, 14.4**

**Property 15: System Resilience**
*For any* event processing error, the system SHALL continue processing subsequent events without stopping, ensuring that one failure does not halt the entire event processing pipeline.
**Validates: Requirements 14.5, 18.5**

**Property 16: Idempotent Event Processing**
*For any* event processed multiple times with the same txHash and logIndex (or txHash for mints), the system SHALL process it only once, skipping duplicate processing attempts without errors.
**Validates: Requirements 15.1, 15.2, 15.3, 15.4**

**Property 17: Analytics Upsert Robustness**
*For any* analytics update operation, the system SHALL use upsert (insert or update) to handle cases where analytics records do not yet exist, ensuring analytics are always updated regardless of prior state.
**Validates: Requirements 16.4**

**Property 18: Batch Transaction Atomicity**
*For any* batch processing operation, the system SHALL maintain transaction atomicity per batch, such that if any operation in the batch fails, all operations in that batch are rolled back.
**Validates: Requirements 17.2**

**Property 19: Batch Retry Granularity**
*For any* failed batch operation, the system SHALL retry individual items from the failed batch separately, allowing successful items to complete while only retrying failed items.
**Validates: Requirements 17.3**

**Property 20: Retry Exhaustion Handling**
*For any* database operation that fails after the maximum number of retry attempts (3), the system SHALL log the failure to error_logs and continue processing other events.
**Validates: Requirements 18.2, 18.5**

## Error Handling

### Error Categories

1. **Validation Errors** (Severity: low)
   - Missing required fields
   - Invalid data formats
   - Address validation failures
   - Action: Log error, skip event, continue processing

2. **Database Errors** (Severity: medium)
   - Connection failures
   - Deadlocks
   - Constraint violations
   - Action: Retry with exponential backoff (3 attempts), log if exhausted

3. **External Service Errors** (Severity: medium)
   - Alchemy API failures
   - IPFS gateway timeouts
   - RPC provider errors
   - Action: Use fallback mechanisms, log warning

4. **Business Logic Errors** (Severity: high)
   - Launchpad not found
   - Phase not found
   - Invalid state transitions
   - Action: Log error with full context, alert admin if threshold exceeded

### Error Handling Strategy


```typescript
// Error handling pattern used across all handlers
async handleEvent(eventData: EventData): Promise<void> {
  try {
    // Validate event data
    this.validateEventData(eventData, requiredFields);
    
    // Check for duplicates (idempotency)
    if (await this.isDuplicate(eventData)) {
      console.log('Duplicate event, skipping');
      return;
    }
    
    // Process within transaction
    await prisma.$transaction(async (tx) => {
      // All database operations here
      await this.updateDatabase(tx, eventData);
      await this.updateAnalytics(tx, eventData);
    });
    
    // Emit WebSocket event (outside transaction)
    await this.emitEvent(eventData);
    
  } catch (error) {
    // Log error with full context
    await this.logEventError('handleEvent', error, eventData);
    
    // Increment error counter
    this.incrementErrorCounter(eventData.type);
    
    // Alert admin if threshold exceeded
    if (this.errorCountExceeded(eventData.type)) {
      await this.sendAdminAlert({
        type: 'ERROR_THRESHOLD_EXCEEDED',
        component: this.constructor.name,
        eventType: eventData.type,
        errorCount: this.getErrorCount(eventData.type)
      });
    }
    
    // Re-throw for queue retry mechanism
    throw error;
  }
}
```

### Retry Configuration

- **Max Retries**: 3 attempts
- **Backoff Strategy**: Exponential (1s, 2s, 4s)
- **Retryable Errors**:
  - Database connection errors (P1001, P1002)
  - Deadlocks (P2034)
  - Too many connections (P2037)
  - Timeout errors
- **Non-Retryable Errors**:
  - Validation errors
  - Unique constraint violations (already processed)
  - Missing required data (launchpad not found)

### Error Logging Schema

```typescript
interface ErrorLog {
  errorType: string;        // 'ValidationError', 'DatabaseError', etc.
  severity: string;         // 'low', 'medium', 'high', 'critical'
  message: string;          // Error message
  stack: string;            // Stack trace
  component: string;        // Handler class name
  operation: string;        // Method name
  chainId: number;          // Chain ID
  contractAddress: string;  // Contract address
  tokenId: string;          // Token ID (if applicable)
  txHash: string;           // Transaction hash
  blockNumber: number;      // Block number
  metadata: any;            // Additional context
  resolved: boolean;        // false by default
  createdAt: Date;          // Timestamp
}
```

## Testing Strategy

### Unit Testing

Unit tests will verify specific examples and edge cases for each event handler:

**Transfer Event Handler**:
- Test mint from zero address
- Test burn to zero address
- Test regular transfer between addresses
- Test ERC1155 multi-quantity transfers
- Test ownership updates
- Test analytics recalculation

**Burn Event Handler**:
- Test supply decrement
- Test ownership removal
- Test analytics updates
- Test launchpad mintedCount decrement

**Phase Management Handler**:
- Test phase creation with all parameters
- Test phase updates
- Test phase activation/deactivation
- Test phase removal

**Marketplace Sale Handler**:
- Test ownership transfer on sale
- Test listing status update
- Test transfer record creation
- Test analytics updates

**Error Handling**:
- Test validation errors
- Test duplicate event handling
- Test transaction rollback
- Test error logging

### Property-Based Testing

Property-based tests will verify universal properties across all inputs using **fast-check** library with minimum 100 iterations per test:

**Configuration**: Each property test will run with:
```typescript
fc.assert(
  fc.property(/* generators */, /* test function */),
  { numRuns: 100 }
);
```

**Test Tags**: Each property test will include a comment tag:
```typescript
// Feature: complete-event-handlers, Property 1: Transfer Record Creation
```

**Property Test Examples**:

```typescript
// Property 1: Transfer Record Creation
describe('Transfer Record Creation', () => {
  it('should create transfer records for all transfer types', async () => {
    // Feature: complete-event-handlers, Property 1: Transfer Record Creation
    await fc.assert(
      fc.property(
        transferEventGenerator(),
        async (transferEvent) => {
          await handleTransferEvent(transferEvent);
          
          const transfer = await prisma.nFTTransfer.findUnique({
            where: {
              txHash_logIndex: {
                txHash: transferEvent.txHash,
                logIndex: transferEvent.logIndex
              }
            }
          });
          
          expect(transfer).toBeDefined();
          expect(transfer.transferType).toBe(
            determineTransferType(transferEvent.from, transferEvent.to)
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Property 2: Ownership State Transition
describe('Ownership State Transition', () => {
  it('should atomically update ownership on transfers', async () => {
    // Feature: complete-event-handlers, Property 2: Ownership State Transition
    await fc.assert(
      fc.property(
        transferEventGenerator(),
        async (transferEvent) => {
          // Setup: Create initial ownership
          await setupInitialOwnership(transferEvent);
          
          // Execute transfer
          await handleTransferEvent(transferEvent);
          
          // Verify old owner marked as not current
          const oldOwnership = await prisma.nFTOwnership.findFirst({
            where: {
              nft: {
                contractAddress: transferEvent.contractAddress,
                tokenId: transferEvent.tokenId
              },
              ownerAddress: transferEvent.from,
              isCurrent: true
            }
          });
          expect(oldOwnership).toBeNull();
          
          // Verify new owner marked as current
          const newOwnership = await prisma.nFTOwnership.findFirst({
            where: {
              nft: {
                contractAddress: transferEvent.contractAddress,
                tokenId: transferEvent.tokenId
              },
              ownerAddress: transferEvent.to,
              isCurrent: true
            }
          });
          expect(newOwnership).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Property 16: Idempotent Event Processing
describe('Idempotent Event Processing', () => {
  it('should process duplicate events only once', async () => {
    // Feature: complete-event-handlers, Property 16: Idempotent Event Processing
    await fc.assert(
      fc.property(
        transferEventGenerator(),
        async (transferEvent) => {
          // Process event twice
          await handleTransferEvent(transferEvent);
          await handleTransferEvent(transferEvent);
          
          // Verify only one transfer record exists
          const transfers = await prisma.nFTTransfer.findMany({
            where: {
              txHash: transferEvent.txHash,
              logIndex: transferEvent.logIndex
            }
          });
          
          expect(transfers.length).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

**Generators**:

```typescript
// Transfer event generator
function transferEventGenerator() {
  return fc.record({
    contractAddress: ethereumAddressGenerator(),
    tokenId: fc.integer({ min: 0, max: 10000 }).map(String),
    from: fc.oneof(
      fc.constant('0x0000000000000000000000000000000000000000'), // mint
      ethereumAddressGenerator() // regular transfer
    ),
    to: fc.oneof(
      fc.constant('0x0000000000000000000000000000000000000000'), // burn
      ethereumAddressGenerator() // regular transfer
    ),
    quantity: fc.integer({ min: 1, max: 100 }).map(String),
    txHash: txHashGenerator(),
    blockNumber: fc.integer({ min: 1, max: 1000000 }),
    blockTimestamp: fc.date(),
    logIndex: fc.integer({ min: 0, max: 100 }),
    tokenType: fc.constantFrom('ERC721', 'ERC1155')
  });
}

// Ethereum address generator
function ethereumAddressGenerator() {
  return fc.hexaString({ minLength: 40, maxLength: 40 })
    .map(hex => `0x${hex}`);
}

// Transaction hash generator
function txHashGenerator() {
  return fc.hexaString({ minLength: 64, maxLength: 64 })
    .map(hex => `0x${hex}`);
}

// Phase event generator
function phaseEventGenerator() {
  return fc.record({
    chainId: fc.integer({ min: 1, max: 100 }),
    launchpadAddress: ethereumAddressGenerator(),
    phaseIndex: fc.integer({ min: 0, max: 10 }),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    phaseType: fc.constantFrom('PRESALE', 'PUBLIC', 'ALLOWLIST', 'FREE'),
    startTime: fc.date(),
    endTime: fc.option(fc.date()),
    price: fc.bigInt({ min: 0n, max: 1000000000000000000n }).map(String),
    maxMintPerWallet: fc.option(fc.integer({ min: 1, max: 100 })),
    totalLimit: fc.option(fc.integer({ min: 1, max: 10000 })),
    merkleRoot: fc.option(fc.hexaString({ minLength: 64, maxLength: 64 })),
    txHash: txHashGenerator(),
    blockNumber: fc.integer({ min: 1, max: 1000000 })
  });
}
```

### Integration Testing

Integration tests will verify end-to-end event processing:

1. **Event Listener → Handler → Database**
   - Emit blockchain event
   - Verify handler processes event
   - Verify database updates

2. **Queue → Processor → Database**
   - Queue event job
   - Verify processor executes
   - Verify database updates

3. **Error Recovery**
   - Inject database failures
   - Verify retry logic
   - Verify error logging

4. **WebSocket Emission**
   - Process event
   - Verify WebSocket broadcast
   - Verify client receives update

### Test Coverage Goals

- **Unit Tests**: 80% code coverage
- **Property Tests**: All 20 correctness properties
- **Integration Tests**: All critical event flows
- **Error Scenarios**: All error categories

## Implementation Phases

### Phase 1: Transfer and Burn Events (High Priority)
**Duration**: 3-4 days

**Tasks**:
1. Enhance NFTEventHandler burn handling
2. Add analytics recalculation to transfer events
3. Implement unique holders calculation
4. Write unit tests for transfer/burn
5. Write property tests for ownership transitions
6. Integration testing

**Deliverables**:
- Complete transfer event handling with analytics
- Complete burn event handling with supply updates
- Property tests for Properties 1, 2, 4, 5

### Phase 2: Marketplace Sale Ownership (High Priority)
**Duration**: 2-3 days

**Tasks**:
1. Enhance MarketplaceEventHandler sale handling
2. Add ownership transfer on sales
3. Add transfer record creation for sales
4. Update analytics with sale data
5. Write unit tests
6. Write property tests

**Deliverables**:
- Complete marketplace sale ownership updates
- Property tests for Property 12

### Phase 3: Phase Management Events (Medium Priority)
**Duration**: 3-4 days

**Tasks**:
1. Create ActivityEventHandler
2. Implement phase added/updated/removed handlers
3. Implement phase activated/deactivated handlers
4. Write unit tests
5. Write property tests

**Deliverables**:
- Complete phase management event handling
- Property tests for Property 7

### Phase 4: Configuration Events (Medium Priority)
**Duration**: 3-4 days

**Tasks**:
1. Implement reveal event handler
2. Implement treasury update handler
3. Implement royalty update handler
4. Implement metadata URI update handler
5. Implement pause/unpause handlers
6. Write unit tests
7. Write property tests

**Deliverables**:
- Complete configuration event handling
- Property tests for Properties 8, 9, 10, 11

### Phase 5: Airdrop and Role Management (Low Priority)
**Duration**: 2-3 days

**Tasks**:
1. Create AirdropEventHandler
2. Implement batch NFT creation
3. Implement role management handlers
4. Implement fee update handlers
5. Write unit tests
6. Write property tests

**Deliverables**:
- Complete airdrop event handling
- Complete role and fee management
- Property tests for Property 6

### Phase 6: Error Handling and Resilience (Ongoing)
**Duration**: Throughout all phases

**Tasks**:
1. Implement comprehensive error logging
2. Implement retry logic with exponential backoff
3. Implement transaction rollback handling
4. Implement idempotency checks
5. Write property tests for error scenarios

**Deliverables**:
- Property tests for Properties 13, 14, 15, 16, 17, 18, 19, 20

## Performance Considerations

### Database Connection Pooling

```typescript
// Use existing withDbLimit wrapper
await withDbLimit(async () => {
  // Database operations
});
```

**Configuration**:
- Max connections: 20
- Connection timeout: 10s
- Idle timeout: 30s

### Batch Operations

For events with multiple items (airdrops, batch reveals):

```typescript
// Batch size limit
const BATCH_SIZE = 100;

// Process in chunks
for (let i = 0; i < items.length; i += BATCH_SIZE) {
  const chunk = items.slice(i, i + BATCH_SIZE);
  await processBatch(chunk);
}
```

### Analytics Recalculation

**Strategy**: Debounce analytics updates to avoid excessive recalculation

```typescript
// Update analytics once per batch instead of per event
await prisma.$transaction(async (tx) => {
  // Process all events
  for (const event of events) {
    await processEvent(tx, event);
  }
  
  // Update analytics once at the end
  await updateAnalytics(tx, contractAddress);
});
```

### Caching Strategy

**Launchpad Data**: Cache launchpad records for 5 minutes to reduce database queries

```typescript
const launchpadCache = new Map<string, { data: Launchpad, expiry: number }>();

async function getCachedLaunchpad(address: string): Promise<Launchpad> {
  const cached = launchpadCache.get(address);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
  
  const launchpad = await prisma.launchpad.findUnique({
    where: { contractAddress: address }
  });
  
  launchpadCache.set(address, {
    data: launchpad,
    expiry: Date.now() + 300000 // 5 minutes
  });
  
  return launchpad;
}
```

## Security Considerations

### Input Validation

All event data must be validated before processing:

```typescript
// Address validation
function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Normalize addresses to lowercase
function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

// Validate required fields
function validateEventData(event: any, requiredFields: string[]): void {
  for (const field of requiredFields) {
    if (event[field] === undefined || event[field] === null) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}
```

### SQL Injection Prevention

Use Prisma's parameterized queries (already handled by Prisma):

```typescript
// Safe - Prisma handles parameterization
await prisma.nFT.findUnique({
  where: {
    contractAddress_tokenId_chainId: {
      contractAddress: userInput, // Safe
      tokenId: userInput,
      chainId: userInput
    }
  }
});
```

### Access Control

Event handlers should only be callable by authorized blockchain listeners:

```typescript
// Verify event source
function verifyEventSource(event: BlockchainEvent): boolean {
  return event.source === 'BLOCKCHAIN_LISTENER' &&
         event.signature === computeEventSignature(event);
}
```

## Monitoring and Observability

### Metrics to Track

1. **Event Processing Metrics**:
   - Events processed per second
   - Average processing time per event type
   - Queue depth and lag

2. **Error Metrics**:
   - Error rate by event type
   - Error rate by error category
   - Retry success rate

3. **Database Metrics**:
   - Query execution time
   - Connection pool utilization
   - Transaction rollback rate

4. **Analytics Metrics**:
   - Analytics recalculation frequency
   - Analytics accuracy (spot checks)
   - Unique holders count changes

### Logging Strategy

**Log Levels**:
- **DEBUG**: Detailed event processing steps
- **INFO**: Event processing start/complete
- **WARN**: Retryable errors, fallback usage
- **ERROR**: Non-retryable errors, max retries exceeded

**Log Format**:
```typescript
{
  timestamp: '2026-01-01T12:00:00Z',
  level: 'INFO',
  component: 'NFTEventHandler',
  operation: 'handleTransferEvent',
  chainId: 1,
  contractAddress: '0x...',
  tokenId: '123',
  txHash: '0x...',
  message: 'Transfer processed successfully',
  duration: 150 // ms
}
```

### Alerting

**Alert Conditions**:
1. Error rate exceeds 5% for any event type
2. Queue lag exceeds 1000 events
3. Database connection pool exhausted
4. Analytics recalculation fails repeatedly
5. Critical event processing failure (launchpad not found)

**Alert Channels**:
- Admin dashboard
- Email notifications
- Slack/Discord webhooks

## Migration Strategy

### Backward Compatibility

All enhancements must maintain backward compatibility with existing event processing:

1. **Existing Events**: Continue to process mint and marketplace events as before
2. **New Events**: Add handlers for new event types without disrupting existing flows
3. **Database Schema**: No breaking changes to existing tables
4. **API Contracts**: Maintain existing WebSocket event formats

### Deployment Plan

1. **Phase 1**: Deploy transfer/burn enhancements to staging
2. **Phase 2**: Run parallel processing (old + new) for 24 hours
3. **Phase 3**: Verify data consistency between old and new handlers
4. **Phase 4**: Deploy to production with feature flag
5. **Phase 5**: Monitor for 48 hours before full rollout
6. **Phase 6**: Remove old code after successful rollout

### Rollback Plan

If issues are detected:

1. **Immediate**: Disable feature flag to revert to old handlers
2. **Short-term**: Fix issues in staging environment
3. **Long-term**: Re-deploy with fixes after thorough testing

## Dependencies

### External Services

1. **Alchemy API**: For NFT metadata fetching (optional, has fallback)
2. **IPFS Gateways**: For metadata and image retrieval (multiple fallbacks)
3. **RPC Providers**: For blockchain data (configured per chain)

### Internal Dependencies

1. **Prisma Client**: Database ORM
2. **Bull Queue**: Job queue for async processing
3. **WebSocket Manager**: Real-time event broadcasting
4. **Error Tracking Service**: Centralized error logging

### Library Dependencies

1. **ethers.js**: Ethereum address validation and utilities
2. **fast-check**: Property-based testing
3. **vitest**: Unit and integration testing

## Documentation Requirements

### Code Documentation

All event handlers must include:

1. **Class-level JSDoc**: Purpose, requirements validated
2. **Method-level JSDoc**: Parameters, return values, errors thrown
3. **Inline Comments**: Complex logic explanation

### API Documentation

Update API documentation to include:

1. **New Event Types**: Description and payload format
2. **WebSocket Events**: New event types and data structures
3. **Error Codes**: New error types and handling

### Operational Documentation

Create runbooks for:

1. **Event Processing Failures**: Diagnosis and resolution steps
2. **Analytics Discrepancies**: How to recalculate and verify
3. **Database Migration**: Steps for schema updates
4. **Performance Tuning**: Configuration adjustments

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-01  
**Status**: Ready for Review
