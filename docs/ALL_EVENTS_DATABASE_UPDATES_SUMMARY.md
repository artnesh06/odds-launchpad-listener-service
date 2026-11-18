# All Events Database Updates - Summary

## Overview
Dokumen ini merangkum semua event yang ada di sistem dan data yang perlu di-INSERT/UPDATE untuk masing-masing event.

---

## 📋 Event Categories

### 1. **NFT Events**
- [Mint Event](#1-mint-event) ✅ Implemented
- [Transfer Event](#2-transfer-event) ⚠️ Partial
- [Burn Event](#3-burn-event) ⚠️ Partial

### 2. **Marketplace Events**
- [Sale Event](#4-sale-event) ✅ Implemented
- [Listing Event](#5-listing-event) ✅ Implemented
- [Offer Event](#6-offer-event) ✅ Implemented
- [Cancel Event](#7-cancel-event) ✅ Implemented

### 3. **Launchpad Events**
- [Phase Events](#8-phase-events) ⚠️ Not Implemented
- [Reveal Event](#9-reveal-event) ⚠️ Not Implemented
- [Treasury Update](#10-treasury-update) ⚠️ Not Implemented
- [Royalty Update](#11-royalty-update) ⚠️ Not Implemented
- [Metadata Update](#12-metadata-update) ⚠️ Not Implemented

### 4. **Contract Events**
- [Ownership Transfer](#13-ownership-transfer) ⚠️ Not Implemented
- [Pause/Unpause](#14-pauseunpause) ⚠️ Not Implemented
- [Role Management](#15-role-management) ⚠️ Not Implemented
- [Fee Updates](#16-fee-updates) ⚠️ Not Implemented

### 5. **System Events**
- [Metadata Fetch](#17-metadata-fetch) ✅ Implemented
- [Airdrop Event](#18-airdrop-event) ⚠️ Not Implemented

---

## 1. MINT EVENT

**Status:** ✅ Fully Implemented

**File:** `src/lib/queue/processors/mint-event-processor.ts`

### INSERT:
- ✅ `mints` - Record mint transaction
- ✅ `nfts` - NFT data
- ✅ `nft_ownership` - Initial ownership
- ✅ `nft_transfers` - Transfer from zero address
- ✅ `activities` - Activity log
- ✅ `nft_attributes` - Attributes (if metadata available)

### UPDATE:
- ✅ `launchpads` - mintedCount, volume, lastMintAt
- ✅ `launchpad_phases` - mintedCount (if active phase)
- ✅ `launchpad_factories` - totalLaunchpads
- ✅ `launchpad_analytics` - totalVolume, totalMints, avgMintPrice
- ✅ `nft_contracts` - totalSupply
- ✅ `nft_collection_analytics` - totalSupply
- ✅ `nfts` - metadata (if Alchemy available)

**Documentation:** [MINT_EVENT_DATABASE_UPDATES.md](./MINT_EVENT_DATABASE_UPDATES.md)

---

## 2. TRANSFER EVENT

**Status:** ⚠️ Partially Implemented (only as part of mint)

**File:** Need to create dedicated handler

### INSERT:
- ⚠️ `nft_transfers` - Transfer record
- ⚠️ `nft_ownership` - New ownership
- ⚠️ `activities` - Activity log (optional)

### UPDATE:
- ⚠️ `nft_ownership` - Set old owner isCurrent = false
- ⚠️ `nfts` - timeLastUpdated
- ⚠️ `nft_collection_analytics` - uniqueHolders
- ⚠️ `launchpad_analytics` - uniqueHolders

**Documentation:** [TRANSFER_EVENT_DATABASE_UPDATES.md](./TRANSFER_EVENT_DATABASE_UPDATES.md)

---

## 3. BURN EVENT

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### INSERT:
- ✅ `activities` - Activity log
- ⚠️ `nft_transfers` - Transfer to zero address

### UPDATE:
- ⚠️ `nft_ownership` - Set isCurrent = false
- ⚠️ `nfts` - Mark as burned
- ⚠️ `launchpads` - Decrement mintedCount
- ⚠️ `nft_contracts` - Decrement totalSupply
- ⚠️ `nft_collection_analytics` - Decrement totalSupply

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#1-burned-event)

---

## 4. SALE EVENT

**Status:** ✅ Implemented

**File:** `src/lib/queue/processors/marketplace-event-processor.ts`

### INSERT:
- ✅ `marketplace_sales` - Sale record

### UPDATE:
- ✅ `marketplace_listings` - status = SOLD
- ✅ `nft_collection_analytics` - totalSales, sales24h, lastSalePrice
- ⚠️ `nft_ownership` - Update ownership (not implemented)
- ⚠️ `nft_transfers` - Transfer record (not implemented)

**Documentation:** [MARKETPLACE_EVENT_DATABASE_UPDATES.md](./MARKETPLACE_EVENT_DATABASE_UPDATES.md#1-sale-event)

---

## 5. LISTING EVENT

**Status:** ✅ Implemented

**File:** `src/lib/queue/processors/marketplace-event-processor.ts`

### INSERT:
- ✅ `marketplace_listings` - Listing record

### UPDATE:
- ✅ `nfts` - updatedAt (optional)

**Documentation:** [MARKETPLACE_EVENT_DATABASE_UPDATES.md](./MARKETPLACE_EVENT_DATABASE_UPDATES.md#2-listing-event)

---

## 6. OFFER EVENT

**Status:** ✅ Implemented

**File:** `src/lib/queue/processors/marketplace-event-processor.ts`

### INSERT:
- ✅ `marketplace_offers` - Offer record

**Documentation:** [MARKETPLACE_EVENT_DATABASE_UPDATES.md](./MARKETPLACE_EVENT_DATABASE_UPDATES.md#3-offer-event)

---

## 7. CANCEL EVENT

**Status:** ✅ Implemented

**File:** `src/lib/queue/processors/marketplace-event-processor.ts`

### UPDATE:
- ✅ `marketplace_listings` - status = CANCELLED
- ✅ `marketplace_offers` - status = CANCELLED

**Documentation:** [MARKETPLACE_EVENT_DATABASE_UPDATES.md](./MARKETPLACE_EVENT_DATABASE_UPDATES.md#4-cancel-event)

---

## 8. PHASE EVENTS

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### PhaseAdded
- ✅ `activities` - Activity log
- ⚠️ `launchpad_phases` - INSERT new phase

### PhaseUpdated
- ✅ `activities` - Activity log
- ⚠️ `launchpad_phases` - UPDATE phase data

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#3-phaseadded-event)

---

## 9. REVEAL EVENT

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### UPDATE:
- ✅ `activities` - Activity log
- ⚠️ `launchpads` - baseURI, status = REVEALED
- ⚠️ `nfts` - Trigger metadata refresh for all NFTs

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#5-revealed-event)

---

## 10. TREASURY UPDATE

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### UPDATE:
- ✅ `activities` - Activity log
- ⚠️ `launchpads` - treasury address

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#6-treasuryupdated-event)

---

## 11. ROYALTY UPDATE

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### UPDATE:
- ✅ `activities` - Activity log
- ⚠️ `launchpads` - royaltyRecipient, royaltyPercentage

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#9-royaltyupdated-event)

---

## 12. METADATA UPDATE

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### UPDATE:
- ✅ `activities` - Activity log
- ⚠️ `launchpads` - baseURI, contractURI, externalLink

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#10-baseuriupdated-event)

---

## 13. OWNERSHIP TRANSFER

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### UPDATE:
- ✅ `activities` - Activity log
- ⚠️ `launchpads` - creator (new owner)

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#8-ownershiptransferred-event)

---

## 14. PAUSE/UNPAUSE

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### UPDATE:
- ✅ `activities` - Activity log
- ⚠️ `launchpads` - status (PAUSED/ACTIVE)

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#13-paused-event)

---

## 15. ROLE MANAGEMENT

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### RoleGranted
- ✅ `activities` - Activity log
- ⚠️ `admin_users` - INSERT or UPDATE

### RoleRevoked
- ✅ `activities` - Activity log
- ⚠️ `admin_users` - UPDATE isActive = false

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#16-rolegranted-event)

---

## 16. FEE UPDATES

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### UPDATE:
- ✅ `activities` - Activity log
- ⚠️ `launchpad_factories` - freeMintFee, platformFeePercentage

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#18-platformfeetoggled-event)

---

## 17. METADATA FETCH

**Status:** ✅ Implemented

**File:** `src/lib/queue/processors/nft-metadata-processor.ts`

### UPDATE:
- ✅ `nfts` - name, description, images, metadata
- ✅ `nft_contracts` - contract metadata, OpenSea data

### INSERT:
- ✅ `nft_attributes` - Attributes from metadata

**Documentation:** [NFT_METADATA_EVENT_DATABASE_UPDATES.md](./NFT_METADATA_EVENT_DATABASE_UPDATES.md)

---

## 18. AIRDROP EVENT

**Status:** ⚠️ Not Implemented

**File:** `src/lib/queue/processors/activity-event-processor.ts` (only logs activity)

### INSERT:
- ✅ `activities` - Activity log
- ⚠️ `nfts` - Multiple NFTs
- ⚠️ `nft_ownership` - Multiple ownerships
- ⚠️ `nft_transfers` - Multiple transfers

### UPDATE:
- ⚠️ `launchpads` - mintedCount

**Documentation:** [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md#2-airdropped-event)

---

## 📊 Implementation Status Summary

### ✅ Fully Implemented (3)
1. Mint Event
2. Marketplace Events (Sale, Listing, Offer, Cancel)
3. Metadata Fetch

### ⚠️ Partially Implemented (2)
1. Transfer Event (only as part of mint)
2. Activity Events (only logs, no table updates)

### ❌ Not Implemented (13)
1. Burn Event (table updates)
2. Phase Events (table updates)
3. Reveal Event (table updates)
4. Treasury Update (table updates)
5. Royalty Update (table updates)
6. Metadata Update (table updates)
7. Ownership Transfer (table updates)
8. Pause/Unpause (table updates)
9. Role Management (table updates)
10. Fee Updates (table updates)
11. Airdrop Event (table updates)
12. Transfer ownership updates on sale
13. Unique holders calculation

---

## 🎯 Priority Implementation Order

### High Priority (Critical for core functionality)
1. **Transfer Event Handler** - Dedicated handler untuk regular transfers
2. **Burn Event Updates** - Update supply counts dan ownership
3. **Sale Ownership Updates** - Update ownership pada marketplace sale
4. **Unique Holders Calculation** - Calculate unique holders untuk analytics

### Medium Priority (Important for features)
5. **Phase Events** - Insert/update phase data
6. **Reveal Event** - Update launchpad status dan trigger metadata refresh
7. **Airdrop Event** - Handle multiple NFT creation
8. **Metadata Updates** - Update launchpad metadata fields

### Low Priority (Nice to have)
9. **Treasury/Royalty Updates** - Update payment settings
10. **Pause/Unpause** - Update contract status
11. **Role Management** - Admin user management
12. **Fee Updates** - Factory fee updates

---

## 📁 Related Documentation Files

1. [MINT_EVENT_DATABASE_UPDATES.md](./MINT_EVENT_DATABASE_UPDATES.md)
2. [MARKETPLACE_EVENT_DATABASE_UPDATES.md](./MARKETPLACE_EVENT_DATABASE_UPDATES.md)
3. [ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md)
4. [NFT_METADATA_EVENT_DATABASE_UPDATES.md](./NFT_METADATA_EVENT_DATABASE_UPDATES.md)
5. [TRANSFER_EVENT_DATABASE_UPDATES.md](./TRANSFER_EVENT_DATABASE_UPDATES.md)

---

## 🔧 Implementation Files

### Processors
- `src/lib/queue/processors/mint-event-processor.ts` ✅
- `src/lib/queue/processors/marketplace-event-processor.ts` ✅
- `src/lib/queue/processors/activity-event-processor.ts` ⚠️
- `src/lib/queue/processors/nft-metadata-processor.ts` ✅
- `src/lib/queue/processors/transfer-event-processor.ts` ❌ (need to create)

### Event Handlers
- `src/lib/blockchain/event-handlers/nft-events.ts`
- `src/lib/blockchain/event-handlers/marketplace-events.ts`
- `src/lib/blockchain/event-handlers/launchpad-events.ts`

### Queue Configuration
- `src/lib/queue/queue-config.ts`
- `src/lib/queue/queue-worker.ts`

---

## 📝 Notes

- Semua operasi database harus dibungkus dengan `withRetry()` dan `withDbLimit()`
- Duplicate check harus dilakukan sebelum insert
- Error logging ke `error_logs` table
- WebSocket events untuk real-time updates
- Transaction safety untuk atomicity
- Rate limiting untuk external APIs

---

Last Updated: 2026-01-01
