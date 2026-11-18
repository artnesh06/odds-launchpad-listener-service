# Activity Event Database Updates

## Overview
Dokumentasi ini menjelaskan data yang di-INSERT dan di-UPDATE ketika ada activity events (burn, airdrop, phase updates, contract updates, dll).

---

## Event Types yang Dihandle

### 1. **Burned** - Token NFT dibakar
### 2. **Airdropped** - Airdrop NFT ke multiple addresses
### 3. **PhaseAdded** - Phase baru ditambahkan
### 4. **PhaseUpdated** - Phase diupdate
### 5. **Revealed** - Collection revealed (metadata diungkap)
### 6. **TreasuryUpdated** - Treasury address diupdate
### 7. **Withdrawn** - Withdrawal dari contract
### 8. **OwnershipTransferred** - Transfer ownership contract
### 9. **RoyaltyUpdated** - Royalty settings diupdate
### 10. **BaseURIUpdated** - Base URI metadata diupdate
### 11. **ContractURIUpdated** - Contract URI diupdate
### 12. **ExternalLinkUpdated** - External link diupdate
### 13. **Paused** - Contract di-pause
### 14. **Unpaused** - Contract di-unpause
### 15. **TransferLockUpdated** - Transfer lock status diupdate
### 16. **RoleGranted** - Role granted ke address
### 17. **RoleRevoked** - Role revoked dari address
### 18. **PlatformFeeToggled** - Platform fee toggle
### 19. **PlatformFlatFeeUpdated** - Platform flat fee diupdate

---

## Data yang DI-INSERT (Semua Event)

### **activities** (Wajib)
Record aktivitas untuk semua event:
- `chainId`: Chain ID
- `factoryId`: Factory ID (jika ada)
- `launchpadId`: Launchpad ID (jika ada)
- `type`: ActivityType enum
- `actor`: Address yang melakukan action
- `description`: Deskripsi human-readable
- `txHash`: Transaction hash
- `blockNumber`: Block number
- `metadata`: Data tambahan (JSON)
- `createdAt`: Timestamp

---

## Data yang DI-UPDATE per Event Type

### 1. BURNED Event

#### **nfts**
```typescript
UPDATE nfts SET
  updatedAt = NOW()
WHERE id = nftId
```

#### **nft_ownership**
```typescript
UPDATE nft_ownership SET
  isCurrent = false,
  updatedAt = NOW()
WHERE nftId = nftId AND ownerAddress = owner
```

#### **nft_transfers**
```typescript
INSERT INTO nft_transfers (
  chainId, nftId, fromAddress, toAddress,
  quantity, txHash, blockNumber, blockTimestamp,
  logIndex, transferType
)
VALUES (
  chainId, nftId, owner, '0x0000000000000000000000000000000000000000',
  '1', txHash, blockNumber, timestamp,
  logIndex, 'BURN'
)
```

#### **launchpads** (Jika dari launchpad)
```typescript
UPDATE launchpads SET
  mintedCount = mintedCount - 1,
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

#### **nft_contracts**
```typescript
UPDATE nft_contracts SET
  totalSupply = totalSupply - 1,
  updatedAt = NOW()
WHERE address = contractAddress AND chainId = chainId
```

#### **nft_collection_analytics**
```typescript
UPDATE nft_collection_analytics SET
  totalSupply = totalSupply - 1,
  calculatedAt = NOW(),
  updatedAt = NOW()
WHERE contractAddress = contractAddress AND chainId = chainId
```

---

### 2. AIRDROPPED Event

#### **nfts** (Multiple inserts)
```typescript
-- Insert untuk setiap NFT yang di-airdrop
INSERT INTO nfts (
  chainId, contractAddress, tokenId, tokenType,
  mintAddress, mintBlockNumber, mintTimestamp,
  mintTransactionHash, isAirdrop
)
```

#### **nft_ownership** (Multiple inserts)
```typescript
-- Insert untuk setiap recipient
INSERT INTO nft_ownership (
  nftId, ownerAddress, balance, acquiredAt,
  acquiredBlock, acquiredTxHash, isCurrent
)
```

#### **nft_transfers** (Multiple inserts)
```typescript
-- Insert untuk setiap transfer
INSERT INTO nft_transfers (
  chainId, nftId, fromAddress, toAddress,
  quantity, txHash, blockNumber, blockTimestamp,
  logIndex, transferType
)
VALUES (..., 'AIRDROP')
```

#### **launchpads**
```typescript
UPDATE launchpads SET
  mintedCount = mintedCount + totalQuantity,
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

### 3. PHASEADDED Event

#### **launchpad_phases**
```typescript
INSERT INTO launchpad_phases (
  launchpadId, name, phaseType, startTime, endTime,
  price, maxMintPerWallet, totalLimit, phaseIndex,
  isActive, merkleRoot
)
```

---

### 4. PHASEUPDATED Event

#### **launchpad_phases**
```typescript
UPDATE launchpad_phases SET
  name = data.name,
  startTime = data.startTime,
  endTime = data.endTime,
  price = data.price,
  maxMintPerWallet = data.maxMintPerWallet,
  totalLimit = data.totalLimit,
  isActive = data.isActive,
  merkleRoot = data.merkleRoot,
  updatedAt = NOW()
WHERE launchpadId = launchpadId AND phaseIndex = phaseIndex
```

---

### 5. REVEALED Event

#### **launchpads**
```typescript
UPDATE launchpads SET
  baseURI = data.baseURI,
  status = 'REVEALED',
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

#### **nfts** (Batch update untuk refresh metadata)
```typescript
-- Trigger metadata refresh untuk semua NFT di collection
-- Biasanya dilakukan via queue job
```

---

### 6. TREASURYUPDATED Event

#### **launchpads**
```typescript
UPDATE launchpads SET
  treasury = data.newTreasury,
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

### 7. WITHDRAWN Event

#### **launchpads**
```typescript
UPDATE launchpads SET
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

Tidak ada field khusus untuk tracking withdrawal, hanya log di activities.

---

### 8. OWNERSHIPTRANSFERRED Event

#### **launchpads**
```typescript
UPDATE launchpads SET
  creator = data.newOwner,
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

### 9. ROYALTYUPDATED Event

#### **launchpads**
```typescript
UPDATE launchpads SET
  royaltyRecipient = data.recipient,
  royaltyPercentage = data.percentage,
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

### 10. BASEURIUPDATED Event

#### **launchpads**
```typescript
UPDATE launchpads SET
  baseURI = data.newBaseURI,
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

### 11. CONTRACTURIUPDATED Event

#### **launchpads**
```typescript
UPDATE launchpads SET
  contractURI = data.newContractURI,
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

### 12. EXTERNALLINKUPDATED Event

#### **launchpads**
```typescript
UPDATE launchpads SET
  externalLink = data.newExternalLink,
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

### 13. PAUSED Event

#### **launchpads**
```typescript
UPDATE launchpads SET
  status = 'PAUSED',
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

### 14. UNPAUSED Event

#### **launchpads**
```typescript
UPDATE launchpads SET
  status = 'ACTIVE',
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

### 15. TRANSFERLOCKUPDATED Event

Tidak ada field khusus di database, hanya log di activities.

---

### 16. ROLEGRANTED Event

#### **admin_users** (Jika role adalah admin)
```typescript
INSERT INTO admin_users (
  address, role, isActive
)
ON CONFLICT (address) DO UPDATE SET
  role = data.role,
  isActive = true,
  updatedAt = NOW()
```

---

### 17. ROLEREVOKED Event

#### **admin_users** (Jika role adalah admin)
```typescript
UPDATE admin_users SET
  isActive = false,
  updatedAt = NOW()
WHERE address = data.account
```

---

### 18. PLATFORMFEETOGGLED Event

#### **launchpad_factories**
```typescript
UPDATE launchpad_factories SET
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

### 19. PLATFORMFLATFEEUPDATED Event

#### **launchpad_factories**
```typescript
UPDATE launchpad_factories SET
  freeMintFee = data.newFee,
  updatedAt = NOW()
WHERE contractAddress = contractAddress
```

---

## ActivityType Enum Mapping

```typescript
Burned → BURN_OCCURRED
Airdropped → AIRDROP_OCCURRED
PhaseAdded → PHASE_CREATED
PhaseUpdated → PHASE_UPDATED
Revealed → COLLECTION_REVEALED
TreasuryUpdated → TREASURY_UPDATED
Withdrawn → EMERGENCY_WITHDRAW
OwnershipTransferred → OWNERSHIP_TRANSFERRED
PlatformFeeToggled → FEE_UPDATED
PlatformFlatFeeUpdated → FEE_UPDATED
RoyaltyUpdated → ROYALTY_UPDATED
BaseURIUpdated → METADATA_UPDATED
ContractURIUpdated → METADATA_UPDATED
ExternalLinkUpdated → METADATA_UPDATED
Paused → CONTRACT_PAUSED
Unpaused → CONTRACT_UNPAUSED
TransferLockUpdated → TRANSFER_LOCK_UPDATED
RoleGranted → ROLE_GRANTED
RoleRevoked → ROLE_REVOKED
```

---

## Urutan Eksekusi

1. ✅ Get launchpad info (jika ada)
2. ✅ **INSERT** `activities` (semua event)
3. ⚠️ **UPDATE/INSERT** table terkait sesuai event type

---

## Transaction Safety

Semua operasi database dibungkus dengan:
- `withRetry()`: Retry otomatis jika gagal
- `withDbLimit()`: Rate limiting untuk database
- Error handling yang proper

---

## Implementasi

File: `src/lib/queue/processors/activity-event-processor.ts`

### Fungsi Utama:
- `process()`: Main processor
- `getLaunchpadInfo()`: Get launchpad data
- `createActivityRecord()`: Create activity log
- `mapEventTypeToActivityType()`: Map event ke enum
- `generateDescription()`: Generate human-readable description

---

## Yang Perlu Ditambahkan

⚠️ **Belum diimplementasi:**
1. Update table terkait untuk setiap event type (hanya insert activities)
2. Handle burn event (update ownership, transfers, supply)
3. Handle airdrop event (insert multiple NFTs, ownerships, transfers)
4. Handle phase events (insert/update phases)
5. Handle reveal event (update launchpad, trigger metadata refresh)
6. Handle treasury/royalty/metadata updates
7. Handle pause/unpause status
8. Handle role management

**Saat ini hanya membuat log di table `activities`**, belum update table-table terkait.

---

## Related Files

- `src/lib/queue/processors/activity-event-processor.ts` - Main processor
- `src/lib/queue/queue-config.ts` - Queue configuration
- `prisma/schema.prisma` - Database schema
