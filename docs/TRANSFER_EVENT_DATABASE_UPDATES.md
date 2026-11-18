# Transfer Event Database Updates

## Overview
Dokumentasi ini menjelaskan data yang di-INSERT dan di-UPDATE ketika ada NFT transfer event (selain mint dan burn).

Transfer event terjadi ketika NFT berpindah kepemilikan dari satu address ke address lain.

---

## Event Types

### 1. **Regular Transfer** - Transfer biasa antar user
### 2. **Sale Transfer** - Transfer karena penjualan di marketplace
### 3. **Airdrop Transfer** - Transfer dari airdrop
### 4. **Mint Transfer** - Transfer dari zero address (mint) - handled by mint processor
### 5. **Burn Transfer** - Transfer ke zero address (burn) - handled by activity processor

---

## Data yang DI-INSERT

### **nft_transfers** (Wajib)

Record transfer NFT:

```typescript
INSERT INTO nft_transfers (
  chainId, nftId, fromAddress, toAddress,
  quantity, txHash, blockNumber, blockTimestamp,
  logIndex, transferType, createdAt
)
VALUES (
  chainId, nftId, from, to,
  '1', txHash, blockNumber, timestamp,
  logIndex, 'TRANSFER', NOW()
)
```

**Fields:**
- `chainId`: Chain ID
- `nftId`: ID NFT yang di-transfer
- `fromAddress`: Address pengirim
- `toAddress`: Address penerima
- `quantity`: Jumlah (default: "1" untuk ERC721)
- `txHash`: Transaction hash
- `blockNumber`: Block number
- `blockTimestamp`: Timestamp transfer
- `logIndex`: Log index dalam transaction
- `transferType`: Tipe transfer (TRANSFER, SALE, AIRDROP, MINT, BURN)

---

## Data yang DI-UPDATE

### **nft_ownership** (Wajib)

Update kepemilikan NFT:

#### 1. Set ownership lama menjadi tidak current
```typescript
UPDATE nft_ownership SET
  isCurrent = false,
  updatedAt = NOW()
WHERE nftId = nftId 
  AND ownerAddress = fromAddress
  AND isCurrent = true
```

#### 2. Insert atau update ownership baru
```typescript
-- Check if receiver already has ownership record
INSERT INTO nft_ownership (
  nftId, ownerAddress, balance, acquiredAt,
  acquiredBlock, acquiredTxHash, isCurrent, createdAt
)
VALUES (
  nftId, toAddress, '1', timestamp,
  blockNumber, txHash, true, NOW()
)
ON CONFLICT (nftId, ownerAddress) DO UPDATE SET
  balance = '1',
  acquiredAt = timestamp,
  acquiredBlock = blockNumber,
  acquiredTxHash = txHash,
  isCurrent = true,
  updatedAt = NOW()
```

### **nfts** (Opsional)

Update last activity timestamp:

```typescript
UPDATE nfts SET
  timeLastUpdated = timestamp,
  updatedAt = NOW()
WHERE id = nftId
```

### **activities** (Opsional)

Log transfer activity untuk tracking:

```typescript
INSERT INTO activities (
  chainId, factoryId, launchpadId, type,
  actor, description, txHash, blockNumber,
  metadata, createdAt
)
VALUES (
  chainId, factoryId, launchpadId, 'TRANSFER_OCCURRED',
  fromAddress, 'Transferred token #${tokenId} to ${toAddress}',
  txHash, blockNumber,
  { tokenId, from: fromAddress, to: toAddress },
  NOW()
)
```

---

## Transfer Type Detection

### Menentukan Transfer Type

```typescript
function determineTransferType(
  from: string,
  to: string,
  txHash: string
): TransferType {
  // Mint
  if (from === '0x0000000000000000000000000000000000000000') {
    return 'MINT';
  }
  
  // Burn
  if (to === '0x0000000000000000000000000000000000000000') {
    return 'BURN';
  }
  
  // Check if it's a sale (has marketplace sale record)
  const sale = await prisma.marketplaceSale.findFirst({
    where: { txHash }
  });
  if (sale) {
    return 'SALE';
  }
  
  // Check if it's an airdrop (from known airdrop contract or pattern)
  if (isAirdropPattern(from, to)) {
    return 'AIRDROP';
  }
  
  // Default transfer
  return 'TRANSFER';
}
```

---

## Ownership History Tracking

### Current vs Historical Ownership

System menyimpan:
1. **Current ownership** (`isCurrent = true`): Pemilik saat ini
2. **Historical ownership** (`isCurrent = false`): Riwayat kepemilikan

```typescript
-- Get current owner
SELECT * FROM nft_ownership
WHERE nftId = nftId AND isCurrent = true

-- Get ownership history
SELECT * FROM nft_ownership
WHERE nftId = nftId
ORDER BY acquiredAt DESC
```

---

## Analytics Updates

### **nft_collection_analytics** (Opsional)

Update unique holders count:

```typescript
-- Recalculate unique holders
UPDATE nft_collection_analytics SET
  uniqueHolders = (
    SELECT COUNT(DISTINCT ownerAddress)
    FROM nft_ownership
    WHERE nftId IN (
      SELECT id FROM nfts
      WHERE contractAddress = contractAddress
        AND chainId = chainId
    )
    AND isCurrent = true
  ),
  calculatedAt = NOW(),
  updatedAt = NOW()
WHERE contractAddress = contractAddress 
  AND chainId = chainId
```

### **launchpad_analytics** (Opsional)

Update unique holders untuk launchpad:

```typescript
UPDATE launchpad_analytics SET
  uniqueHolders = (
    SELECT COUNT(DISTINCT ownerAddress)
    FROM nft_ownership
    WHERE nftId IN (
      SELECT id FROM nfts
      WHERE contractAddress = launchpadAddress
        AND chainId = chainId
    )
    AND isCurrent = true
  ),
  calculatedAt = NOW(),
  updatedAt = NOW()
WHERE launchpadId = launchpadId
```

---

## Batch Transfer Handling

Untuk multiple transfers dalam satu transaction (ERC1155 batch):

```typescript
// Process each transfer in the batch
for (const transfer of batchTransfers) {
  await processTransfer({
    chainId,
    nftId: transfer.nftId,
    from: transfer.from,
    to: transfer.to,
    quantity: transfer.quantity,
    txHash,
    blockNumber,
    logIndex: transfer.logIndex,
    timestamp
  });
}
```

---

## Special Cases

### 1. **Contract to Contract Transfer**

Transfer antara smart contracts (staking, escrow, dll):

```typescript
// Mark as contract interaction
INSERT INTO nft_transfers (
  ...,
  transferType = 'TRANSFER',
  metadata = { 
    fromContract: true, 
    toContract: true,
    contractType: 'STAKING' // or 'ESCROW', 'MARKETPLACE'
  }
)
```

### 2. **Wash Trading Detection**

Transfer bolak-balik antara addresses yang sama:

```typescript
-- Check for wash trading pattern
SELECT COUNT(*) FROM nft_transfers
WHERE nftId = nftId
  AND (
    (fromAddress = addr1 AND toAddress = addr2) OR
    (fromAddress = addr2 AND toAddress = addr1)
  )
  AND blockTimestamp > NOW() - INTERVAL '24 hours'
```

### 3. **Lost NFT Recovery**

Transfer dari address yang sudah lama tidak aktif:

```typescript
-- Check last activity
SELECT MAX(blockTimestamp) FROM nft_transfers
WHERE fromAddress = fromAddress
```

---

## Urutan Eksekusi

1. ✅ Get NFT info dari database
2. ✅ Determine transfer type
3. ✅ **INSERT** `nft_transfers`
4. ✅ **UPDATE** `nft_ownership` (set old owner isCurrent = false)
5. ✅ **INSERT/UPDATE** `nft_ownership` (new owner)
6. ✅ **UPDATE** `nfts` (timeLastUpdated)
7. ⚠️ **INSERT** `activities` (optional log)
8. ⚠️ **UPDATE** `nft_collection_analytics` (unique holders)
9. ⚠️ **UPDATE** `launchpad_analytics` (unique holders)

---

## Transaction Safety

Semua operasi database dibungkus dengan:
- `withRetry()`: Retry otomatis jika gagal
- `withDbLimit()`: Rate limiting untuk database
- Transaction untuk atomicity
- Duplicate check untuk idempotency

---

## Duplicate Prevention

Check duplicate transfer sebelum insert:

```typescript
const existingTransfer = await prisma.nFTTransfer.findUnique({
  where: {
    txHash_logIndex: {
      txHash,
      logIndex
    }
  }
});

if (existingTransfer) {
  console.log('Transfer already processed');
  return;
}
```

---

## Implementasi

File: `src/lib/blockchain/event-handlers/nft-events.ts`

### Fungsi yang Perlu Dibuat:
- `handleTransferEvent()`: Main handler untuk transfer
- `updateOwnership()`: Update ownership records
- `determineTransferType()`: Detect transfer type
- `updateHolderAnalytics()`: Update holder counts
- `logTransferActivity()`: Log ke activities

---

## Yang Perlu Ditambahkan

⚠️ **Belum diimplementasi:**
1. Dedicated transfer event handler (saat ini handled by mint processor)
2. Transfer type detection logic
3. Ownership history tracking
4. Unique holders calculation
5. Contract-to-contract transfer handling
6. Wash trading detection
7. Batch transfer support (ERC1155)
8. Transfer activity logging

**Saat ini transfer hanya di-handle sebagai bagian dari mint event**, belum ada handler khusus untuk regular transfers.

---

## Performance Considerations

### Indexing
```sql
-- Important indexes for transfer queries
CREATE INDEX nft_transfers_nftId_idx ON nft_transfers(nftId);
CREATE INDEX nft_transfers_fromAddress_idx ON nft_transfers(fromAddress);
CREATE INDEX nft_transfers_toAddress_idx ON nft_transfers(toAddress);
CREATE INDEX nft_transfers_blockNumber_idx ON nft_transfers(blockNumber);
CREATE INDEX nft_ownership_nftId_isCurrent_idx ON nft_ownership(nftId, isCurrent);
CREATE INDEX nft_ownership_ownerAddress_isCurrent_idx ON nft_ownership(ownerAddress, isCurrent);
```

### Query Optimization
- Use indexes untuk ownership queries
- Batch update untuk multiple transfers
- Cache current owner untuk fast lookup
- Periodic cleanup untuk old historical data

---

## Related Files

- `src/lib/blockchain/event-handlers/nft-events.ts` - Event handlers
- `src/lib/queue/processors/mint-event-processor.ts` - Mint processor (handles mint transfers)
- `src/lib/queue/processors/activity-event-processor.ts` - Activity processor (handles burn transfers)
- `prisma/schema.prisma` - Database schema
