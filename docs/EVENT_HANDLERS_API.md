# Event Handlers API Documentation

## Overview

This document provides comprehensive documentation for all blockchain event handlers in the NFT Indexer system, including event types, payloads, database updates, and WebSocket emissions.

---

## Table of Contents

1. [NFT Events](#nft-events)
2. [Marketplace Events](#marketplace-events)
3. [Phase Management Events](#phase-management-events)
4. [Configuration Events](#configuration-events)
5. [Airdrop Events](#airdrop-events)
6. [Role Management Events](#role-management-events)
7. [Fee Update Events](#fee-update-events)
8. [WebSocket Events](#websocket-events)
9. [Error Codes](#error-codes)

---

## NFT Events

### Transfer Event

Handles all NFT transfers including mints, burns, and regular transfers.

**Event Type:** `Transfer`

**Event Payload:**
```typescript
{
  contractAddress: string;      // NFT contract address
  tokenId: string;               // Token ID
  from: string;                  // Sender address (0x0 for mints)
  to: string;                    // Receiver address (0x0 for burns)
  quantity: string;              // Transfer quantity (ERC1155)
  txHash: string;                // Transaction hash
  blockNumber: number;           // Block number
  blockTimestamp: Date;          // Block timestamp
  logIndex: number;              // Log index
  tokenType: 'ERC721' | 'ERC1155';
}
```

**Database Updates:**
- INSERT: `nft_transfers`, `nft_ownership`, `activities`
- UPDATE: `nft_ownership` (previous owner), `nft_collection_analytics`, `launchpad_analytics`

**Transfer Types:**
- `MINT`: from = 0x0000000000000000000000000000000000000000
- `BURN`: to = 0x0000000000000000000000000000000000000000
- `TRANSFER`: Regular transfer between addresses
- `SALE`: Transfer via marketplace sale

**WebSocket Event:**
```json
{
  "type": "nft:transfer",
  "chainId": 1,
  "contractAddress": "0x...",
  "tokenId": "1",
  "from": "0x...",
  "to": "0x...",
  "transferType": "TRANSFER",
  "txHash": "0x...",
  "blockNumber": 12345678
}
```

---

### Burn Event

Handles NFT burns with supply tracking.

**Event Type:** `Burned`

**Event Payload:**
```typescript
{
  contractAddress: string;
  tokenId: string;
  owner: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
}
```

**Database Updates:**
- INSERT: `nft_transfers`, `activities`
- UPDATE: `nft_ownership`, `nft_contracts` (totalSupply--), `nft_collection_analytics` (totalSupply--, uniqueHolders), `launchpads` (mintedCount--)

**WebSocket Event:**
```json
{
  "type": "nft:burn",
  "chainId": 1,
  "contractAddress": "0x...",
  "tokenId": "1",
  "owner": "0x...",
  "txHash": "0x...",
  "blockNumber": 12345678
}
```

---

## Marketplace Events

### Sale Event

Handles marketplace sales with ownership updates.

**Event Type:** `Sale`

**Event Payload:**
```typescript
{
  chainId: number;
  listingId: string;
  seller: string;
  buyer: string;
  price: string;
  currency: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  marketplace: 'SEAPORT' | 'BLUR' | 'LOOKSRARE' | 'MAGIC_EDEN';
}
```

**Database Updates:**
- INSERT: `nft_ownership`, `nft_transfers`
- UPDATE: `nft_ownership` (seller), `marketplace_listings` (status=SOLD), `nft_collection_analytics`

**WebSocket Event:**
```json
{
  "type": "marketplace:sale",
  "chainId": 1,
  "contractAddress": "0x...",
  "tokenId": "1",
  "seller": "0x...",
  "buyer": "0x...",
  "price": "1000000000000000000",
  "marketplace": "SEAPORT",
  "txHash": "0x...",
  "blockNumber": 12345678
}
```

---

### Listing Event

Handles new marketplace listings.

**Event Type:** `Listing`

**Event Payload:**
```typescript
{
  chainId: number;
  seller: string;
  contractAddress: string;
  tokenId: string;
  price: string;
  currency: string;
  startTime: Date;
  expirationTime: Date;
  marketplace: string;
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- INSERT: `marketplace_listings`

**WebSocket Event:**
```json
{
  "type": "marketplace:listing",
  "chainId": 1,
  "contractAddress": "0x...",
  "tokenId": "1",
  "seller": "0x...",
  "price": "1000000000000000000",
  "marketplace": "SEAPORT",
  "txHash": "0x..."
}
```

---

## Phase Management Events

### Phase Added Event

Handles creation of new mint phases.

**Event Type:** `PhaseAdded`

**Event Payload:**
```typescript
{
  chainId: number;
  launchpadAddress: string;
  phaseIndex: number;
  name: string;
  phaseType: 'PRESALE' | 'PUBLIC' | 'ALLOWLIST' | 'FREE';
  startTime: Date;
  endTime?: Date;
  price: string;
  maxMintPerWallet?: number;
  totalLimit?: number;
  merkleRoot?: string;
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- INSERT: `launchpad_phases`, `activities`

**WebSocket Event:**
```json
{
  "type": "launchpad:phase_added",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "phaseIndex": 0,
  "name": "Public Sale",
  "phaseType": "PUBLIC",
  "startTime": "2024-01-01T00:00:00Z",
  "price": "1000000000000000000",
  "txHash": "0x..."
}
```

---

### Phase Updated Event

Handles updates to existing mint phases.

**Event Type:** `PhaseUpdated`

**Event Payload:** Same as PhaseAdded

**Database Updates:**
- UPDATE: `launchpad_phases`
- INSERT: `activities`

**WebSocket Event:**
```json
{
  "type": "launchpad:phase_updated",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "phaseIndex": 0,
  "changes": {
    "price": "2000000000000000000",
    "maxMintPerWallet": 10
  },
  "txHash": "0x..."
}
```

---

### Phase Removed Event

Handles removal of mint phases.

**Event Type:** `PhaseRemoved`

**Event Payload:**
```typescript
{
  chainId: number;
  launchpadAddress: string;
  phaseIndex: number;
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- DELETE/UPDATE: `launchpad_phases`
- INSERT: `activities`

**WebSocket Event:**
```json
{
  "type": "launchpad:phase_removed",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "phaseIndex": 0,
  "txHash": "0x..."
}
```

---

### Phase Activated/Deactivated Events

Handles phase activation state changes.

**Event Types:** `PhaseActivated`, `PhaseDeactivated`

**Event Payload:**
```typescript
{
  chainId: number;
  launchpadAddress: string;
  phaseIndex: number;
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- UPDATE: `launchpad_phases` (isActive)
- INSERT: `activities`

**WebSocket Event:**
```json
{
  "type": "launchpad:phase_activated",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "phaseIndex": 0,
  "isActive": true,
  "txHash": "0x..."
}
```

---

## Configuration Events

### Reveal Event

Handles collection reveals with metadata refresh.

**Event Type:** `Revealed`

**Event Payload:**
```typescript
{
  chainId: number;
  launchpadAddress: string;
  newBaseURI: string;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
}
```

**Database Updates:**
- UPDATE: `launchpads` (baseURI, updatedAt)
- INSERT: `activities`
- QUEUE: Metadata refresh jobs for all minted tokens

**WebSocket Event:**
```json
{
  "type": "launchpad:revealed",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "newBaseURI": "https://example.com/metadata/",
  "txHash": "0x..."
}
```

---

### Treasury Update Event

Handles treasury address changes.

**Event Type:** `TreasuryUpdated`

**Event Payload:**
```typescript
{
  chainId: number;
  launchpadAddress: string;
  oldTreasury: string;
  newTreasury: string;
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- UPDATE: `launchpads` (treasury)
- INSERT: `activities` (with old/new values in metadata)

**WebSocket Event:**
```json
{
  "type": "launchpad:treasury_updated",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "oldTreasury": "0x...",
  "newTreasury": "0x...",
  "txHash": "0x..."
}
```

---

### Royalty Update Event

Handles royalty configuration changes.

**Event Type:** `RoyaltyUpdated`

**Event Payload:**
```typescript
{
  chainId: number;
  launchpadAddress: string;
  oldRecipient: string;
  newRecipient: string;
  oldPercentage: number;
  newPercentage: number;
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- UPDATE: `launchpads` (royaltyRecipient, royaltyPercentage)
- INSERT: `activities` (with old/new values in metadata)

**WebSocket Event:**
```json
{
  "type": "launchpad:royalty_updated",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "newRecipient": "0x...",
  "newPercentage": 5.0,
  "txHash": "0x..."
}
```

---

### Metadata URI Update Event

Handles metadata URI changes with selective refresh.

**Event Type:** `MetadataURIUpdated`

**Event Payload:**
```typescript
{
  chainId: number;
  launchpadAddress: string;
  tokenId?: string;
  newURI: string;
  updateType: 'BASE_URI' | 'CONTRACT_URI' | 'TOKEN_URI';
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- UPDATE: `launchpads` (baseURI or contractURI)
- INSERT: `activities`
- QUEUE: Metadata refresh jobs (specific token or all tokens)

**WebSocket Event:**
```json
{
  "type": "launchpad:metadata_updated",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "tokenId": "1",
  "updateType": "TOKEN_URI",
  "txHash": "0x..."
}
```

---

### Pause/Unpause Events

Handles contract pause state changes.

**Event Types:** `Paused`, `Unpaused`

**Event Payload:**
```typescript
{
  chainId: number;
  launchpadAddress: string;
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- UPDATE: `launchpads` (status = PAUSED or ACTIVE)
- INSERT: `activities`

**WebSocket Event:**
```json
{
  "type": "launchpad:paused",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "status": "PAUSED",
  "txHash": "0x..."
}
```

---

## Airdrop Events

### Airdrop Event

Handles batch NFT distributions.

**Event Type:** `Airdropped`

**Event Payload:**
```typescript
{
  chainId: number;
  launchpadAddress: string;
  recipients: string[];
  tokenIds: string[];
  txHash: string;
  blockNumber: number;
  timestamp: Date;
}
```

**Database Updates:**
- INSERT: `nfts` (batch), `nft_ownership` (batch), `nft_transfers` (batch), `activities`
- UPDATE: `nft_collection_analytics` (uniqueHolders)
- All NFTs marked with `isAirdrop=true`

**WebSocket Event:**
```json
{
  "type": "launchpad:airdrop",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "recipientCount": 100,
  "tokenIds": ["1", "2", "3", "..."],
  "txHash": "0x..."
}
```

---

## Role Management Events

### Role Granted Event

Handles role assignments.

**Event Type:** `RoleGranted`

**Event Payload:**
```typescript
{
  chainId: number;
  launchpadAddress: string;
  role: string;
  account: string;
  sender: string;
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- INSERT: `activities` (with role and account in metadata)

**WebSocket Event:**
```json
{
  "type": "launchpad:role_granted",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "role": "MINTER_ROLE",
  "account": "0x...",
  "txHash": "0x..."
}
```

---

### Role Revoked Event

Handles role removals.

**Event Type:** `RoleRevoked`

**Event Payload:** Same as RoleGranted

**Database Updates:**
- INSERT: `activities` (with role and account in metadata)

**WebSocket Event:**
```json
{
  "type": "launchpad:role_revoked",
  "chainId": 1,
  "launchpadAddress": "0x...",
  "role": "MINTER_ROLE",
  "account": "0x...",
  "txHash": "0x..."
}
```

---

## Fee Update Events

### Platform Fee Update Event

Handles platform fee changes.

**Event Type:** `PlatformFeeUpdated`

**Event Payload:**
```typescript
{
  chainId: number;
  factoryAddress: string;
  oldFee: string;
  newFee: string;
  feeType: 'PLATFORM_FEE';
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- UPDATE: `launchpad_factories` (platformFeePercentage)
- INSERT: `activities`

**WebSocket Event:**
```json
{
  "type": "factory:platform_fee_updated",
  "chainId": 1,
  "factoryAddress": "0x...",
  "oldFee": "2.5",
  "newFee": "3.0",
  "txHash": "0x..."
}
```

---

### Creation Fee Update Event

Handles creation fee changes.

**Event Type:** `CreationFeeUpdated`

**Event Payload:**
```typescript
{
  chainId: number;
  factoryAddress: string;
  oldFee: string;
  newFee: string;
  feeType: 'CREATION_FEE';
  txHash: string;
  blockNumber: number;
}
```

**Database Updates:**
- UPDATE: `launchpad_factories` (creationFee)
- INSERT: `activities`

**WebSocket Event:**
```json
{
  "type": "factory:creation_fee_updated",
  "chainId": 1,
  "factoryAddress": "0x...",
  "oldFee": "0.1",
  "newFee": "0.05",
  "txHash": "0x..."
}
```

---

## WebSocket Events

### Connection

Connect to WebSocket server:

```javascript
const ws = new WebSocket('wss://api.example.com/ws');

ws.onopen = () => {
  console.log('Connected to WebSocket');
};
```

### Subscription

Subscribe to specific rooms:

```javascript
// Subscribe to chain events
ws.send(JSON.stringify({
  type: 'subscribe',
  room: 'chain:1'
}));

// Subscribe to contract events
ws.send(JSON.stringify({
  type: 'subscribe',
  room: 'contract:1:0x...'
}));

// Subscribe to launchpad events
ws.send(JSON.stringify({
  type: 'subscribe',
  room: 'launchpad:1:0x...'
}));
```

### Event Format

All WebSocket events follow this format:

```json
{
  "type": "event_type",
  "chainId": 1,
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    // Event-specific data
  }
}
```

### Room Naming Convention

- Chain events: `chain:{chainId}`
- Contract events: `contract:{chainId}:{contractAddress}`
- Launchpad events: `launchpad:{chainId}:{launchpadAddress}`
- Marketplace events: `marketplace:{chainId}:{marketplace}`

---

## Error Codes

### Event Processing Errors

| Code | Description | Severity |
|------|-------------|----------|
| `VALIDATION_ERROR` | Invalid event data | low |
| `DUPLICATE_EVENT` | Event already processed | low |
| `DATABASE_ERROR` | Database operation failed | medium |
| `LAUNCHPAD_NOT_FOUND` | Launchpad not found in database | high |
| `CONTRACT_NOT_FOUND` | Contract not found in database | high |
| `TRANSACTION_ROLLBACK` | Transaction rolled back | medium |
| `MAX_RETRIES_EXCEEDED` | Max retry attempts exceeded | high |
| `EXTERNAL_SERVICE_ERROR` | External service unavailable | medium |

### Error Response Format

```json
{
  "error": {
    "code": "DATABASE_ERROR",
    "message": "Failed to update nft_ownership",
    "severity": "medium",
    "context": {
      "chainId": 1,
      "contractAddress": "0x...",
      "tokenId": "1",
      "txHash": "0x...",
      "blockNumber": 12345678
    },
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

---

## Event Processing Flow

```
1. Blockchain Event Detected
   ↓
2. Event Listener Captures Event
   ↓
3. Event Handler Validates Data
   ↓
4. Check for Duplicate (Idempotency)
   ↓
5. Begin Database Transaction
   ↓
6. Update Multiple Tables Atomically
   ↓
7. Commit Transaction
   ↓
8. Emit WebSocket Event
   ↓
9. Log Success
```

### Error Handling Flow

```
1. Error Occurs
   ↓
2. Log Error to error_logs Table
   ↓
3. Rollback Transaction
   ↓
4. Retry with Exponential Backoff (if retryable)
   ↓
5. If Max Retries Exceeded:
   - Log Final Error
   - Continue Processing Other Events
   - Alert Admin if Threshold Exceeded
```

---

## Best Practices

### Event Handling

1. **Always validate event data** before processing
2. **Check for duplicates** using txHash and logIndex
3. **Use transactions** for atomic database updates
4. **Implement retry logic** for transient failures
5. **Log all errors** with complete context
6. **Emit WebSocket events** after successful processing

### Performance

1. **Batch operations** when processing multiple events
2. **Use connection pooling** for database connections
3. **Cache frequently accessed data** (launchpad records)
4. **Limit batch sizes** to prevent memory issues
5. **Update analytics once per batch** instead of per event

### Monitoring

1. **Track error rates** by event type
2. **Monitor processing latency** for each handler
3. **Alert on error thresholds** (>5% error rate)
4. **Track queue depth** and lag
5. **Monitor database connection pool** utilization

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-02  
**Status**: Complete
