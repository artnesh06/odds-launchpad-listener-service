# Mint Event Database Updates

## Overview
Dokumentasi ini menjelaskan data yang di-INSERT dan di-UPDATE ketika ada event mint NFT di sistem.

## Data yang DI-INSERT

### 1. **mints** (Wajib)
Record transaksi mint baru dengan informasi:
- `launchpadId`: ID launchpad
- `minter`: Address yang melakukan mint
- `tokenId`: ID token yang di-mint
- `quantity`: Jumlah (default: 1)
- `price`: Harga mint
- `txHash`: Transaction hash
- `blockNumber`: Block number
- `createdAt`: Timestamp

### 2. **activities** (Wajib)
Log aktivitas mint untuk timeline:
- `type`: `MINT_OCCURRED`
- `chainId`: Chain ID
- `factoryId`: Factory ID
- `launchpadId`: Launchpad ID
- `actor`: Address minter
- `description`: Deskripsi mint
- `txHash`: Transaction hash
- `blockNumber`: Block number
- `metadata`: Data tambahan (tokenId, minter)

### 3. **nfts** (Jika belum ada)
Data NFT yang baru di-mint:
- `chainId`: Chain ID
- `contractAddress`: Contract address
- `tokenId`: Token ID
- `tokenType`: Tipe token (ERC721)
- `mintAddress`: Address minter
- `mintBlockNumber`: Block number mint
- `mintTimestamp`: Timestamp mint
- `mintTransactionHash`: Transaction hash
- `timeLastUpdated`: Last update time

### 4. **nft_ownership** (Wajib)
Record kepemilikan NFT:
- `nftId`: ID NFT
- `ownerAddress`: Address owner
- `balance`: Balance (default: "1")
- `acquiredAt`: Waktu acquire
- `acquiredBlock`: Block number
- `acquiredTxHash`: Transaction hash
- `isCurrent`: Status current (true)

### 5. **nft_transfers** (Wajib)
Record transfer dari zero address ke minter:
- `chainId`: Chain ID
- `nftId`: ID NFT
- `fromAddress`: Zero address (0x0000...)
- `toAddress`: Address minter
- `quantity`: Jumlah (default: "1")
- `txHash`: Transaction hash
- `blockNumber`: Block number
- `blockTimestamp`: Timestamp
- `logIndex`: Log index
- `transferType`: `MINT`

### 6. **nft_attributes** (Opsional)
Attributes NFT dari metadata (jika tersedia):
- `nftId`: ID NFT
- `traitType`: Tipe trait
- `value`: Nilai trait
- `displayType`: Display type
- `numericValue`: Nilai numerik (jika ada)

## Data yang DI-UPDATE

### 1. **launchpads** (Wajib)
```typescript
UPDATE launchpads SET
  mintedCount = mintedCount + 1,
  volume = volume + mintPrice,
  lastMintAt = NOW(),
  updatedAt = NOW()
WHERE id = launchpadId
```

### 2. **launchpad_phases** (Jika ada phase aktif)
```typescript
UPDATE launchpad_phases SET
  mintedCount = mintedCount + 1,
  updatedAt = NOW()
WHERE id = activePhaseId
```

### 3. **launchpad_factories** (Wajib)
```typescript
UPDATE launchpad_factories SET
  totalLaunchpads = (SELECT COUNT(*) FROM launchpads WHERE factoryId = ...),
  updatedAt = NOW()
WHERE id = factoryId
```

### 4. **launchpad_analytics** (Wajib)
```typescript
UPDATE launchpad_analytics SET
  totalVolume = totalVolume + mintPrice,
  totalMints = totalMints + 1,
  avgMintPrice = totalVolume / totalMints,
  lastSalePrice = mintPrice,
  calculatedAt = NOW(),
  updatedAt = NOW()
WHERE launchpadId = launchpadId
```

Jika belum ada, akan di-CREATE dengan data awal.

### 5. **nft_contracts** (Jika sudah ada)
```typescript
UPDATE nft_contracts SET
  totalSupply = totalSupply + 1,
  updatedAt = NOW()
WHERE address = contractAddress AND chainId = chainId
```

Jika belum ada, akan di-CREATE dengan `totalSupply = 1`.

### 6. **nft_collection_analytics** (Wajib)
```typescript
UPDATE nft_collection_analytics SET
  totalSupply = totalSupply + 1,
  calculatedAt = NOW(),
  updatedAt = NOW()
WHERE contractAddress = contractAddress AND chainId = chainId
```

Jika belum ada, akan di-CREATE dengan `totalSupply = 1`.

### 7. **nfts** (Update metadata jika tersedia)
```typescript
UPDATE nfts SET
  name = metadata.name,
  description = metadata.description,
  tokenUri = metadata.tokenUri,
  imageCachedUrl = metadata.image.cachedUrl,
  imageThumbnailUrl = metadata.image.thumbnailUrl,
  rawMetadata = metadata.raw,
  isSpam = spamCheck.result,
  updatedAt = NOW()
WHERE id = nftId
```

## Urutan Eksekusi

Implementasi di `src/lib/queue/processors/mint-event-processor.ts`:

1. ✅ Check duplicate mint
2. ✅ Get launchpad info
3. ✅ **INSERT** `nfts` (upsert)
4. ✅ **INSERT** `nft_ownership`
5. ✅ **INSERT** `nft_transfers`
6. ✅ Fetch & **UPDATE** metadata (jika Alchemy tersedia)
7. ✅ **INSERT** `activities`
8. ✅ **INSERT** `mints`
9. ✅ **UPDATE** `launchpad_phases` (jika ada phase aktif)
10. ✅ **UPDATE** `launchpads`
11. ✅ **UPDATE** `launchpad_factories`
12. ✅ **UPDATE/INSERT** `launchpad_analytics`
13. ✅ **UPDATE/INSERT** `nft_contracts`
14. ✅ **UPDATE/INSERT** `nft_collection_analytics`
15. ✅ Emit WebSocket event

## Transaction Safety

Semua operasi database dibungkus dengan:
- `withRetry()`: Retry otomatis jika gagal
- `withDbLimit()`: Rate limiting untuk database
- Error handling yang proper

## Logging

Setiap operasi memiliki log yang jelas:
- ✅ Success: Operasi berhasil
- ℹ️ Info: Informasi tambahan
- ⚠️ Warning: Warning non-critical
- ❌ Error: Error yang perlu ditangani

## Testing

Untuk testing implementasi ini, jalankan:
```bash
npm test -- mint-event-processor
```

## Related Files

- `src/lib/queue/processors/mint-event-processor.ts` - Main processor
- `src/lib/queue/queue-config.ts` - Queue configuration
- `prisma/schema.prisma` - Database schema
