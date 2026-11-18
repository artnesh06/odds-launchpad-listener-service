# Marketplace Event Database Updates

## Overview
Dokumentasi ini menjelaskan data yang di-INSERT dan di-UPDATE ketika ada event marketplace (sale, listing, offer, cancel).

---

## 1. SALE EVENT (Penjualan NFT)

### Data yang DI-INSERT

#### **marketplace_sales** (Wajib)
Record transaksi penjualan NFT:
- `chainId`: Chain ID
- `marketplace`: Marketplace (OPENSEA, BLUR, LOOKSRARE, X2Y2, dll)
- `contractAddress`: Contract address NFT
- `tokenId`: Token ID yang dijual
- `buyer`: Address pembeli
- `seller`: Address penjual
- `price`: Harga jual
- `currency`: Currency (ETH, WETH, USDC, dll)
- `quantity`: Jumlah (default: "1")
- `sellerFeeAmount`: Fee untuk seller
- `sellerFeeCurrency`: Currency fee seller
- `protocolFeeAmount`: Fee untuk protocol/marketplace
- `protocolFeeCurrency`: Currency fee protocol
- `royaltyFeeAmount`: Royalty fee untuk creator
- `royaltyFeeCurrency`: Currency royalty
- `txHash`: Transaction hash
- `blockNumber`: Block number
- `blockTimestamp`: Timestamp transaksi
- `logIndex`: Log index
- `bundleIndex`: Bundle index (default: 0)
- `taker`: Taker (buyer/seller)
- `listingId`: ID listing yang terkait (jika ada)

### Data yang DI-UPDATE

#### **marketplace_listings** (Jika ada listing terkait)
```typescript
UPDATE marketplace_listings SET
  status = 'SOLD',
  saleTxHash = txHash,
  saleBlock = blockNumber,
  updatedAt = NOW()
WHERE id = listingId
```

#### **nft_collection_analytics** (Wajib)
```typescript
UPDATE nft_collection_analytics SET
  totalVolume = totalVolume + price,
  volume24h = volume24h + price,
  volume7d = volume7d + price,
  volume30d = volume30d + price,
  totalSales = totalSales + 1,
  sales24h = sales24h + 1,
  sales7d = sales7d + 1,
  sales30d = sales30d + 1,
  lastSalePrice = price,
  avgSalePrice = totalVolume / totalSales,
  calculatedAt = NOW(),
  updatedAt = NOW()
WHERE contractAddress = contractAddress AND chainId = chainId
```

Jika belum ada, akan di-CREATE dengan data awal.

#### **nft_ownership** (Perlu update kepemilikan)
```typescript
-- Set ownership lama menjadi tidak current
UPDATE nft_ownership SET
  isCurrent = false,
  updatedAt = NOW()
WHERE nftId = nftId AND ownerAddress = seller

-- Insert ownership baru untuk buyer
INSERT INTO nft_ownership (
  nftId, ownerAddress, balance, acquiredAt, 
  acquiredBlock, acquiredTxHash, isCurrent
)
```

#### **nft_transfers** (Insert transfer record)
```typescript
INSERT INTO nft_transfers (
  chainId, nftId, fromAddress, toAddress,
  quantity, txHash, blockNumber, blockTimestamp,
  logIndex, transferType
)
VALUES (
  chainId, nftId, seller, buyer,
  quantity, txHash, blockNumber, timestamp,
  logIndex, 'SALE'
)
```

---

## 2. LISTING EVENT (NFT Dijual/Listed)

### Data yang DI-INSERT

#### **marketplace_listings** (Wajib)
Record listing NFT di marketplace:
- `chainId`: Chain ID
- `marketplace`: Marketplace
- `contractAddress`: Contract address NFT
- `tokenId`: Token ID
- `seller`: Address penjual
- `price`: Harga listing
- `currency`: Currency (ETH, WETH, dll)
- `quantity`: Jumlah (default: "1")
- `startTime`: Waktu mulai listing
- `endTime`: Waktu berakhir (nullable)
- `expirationTime`: Waktu expiration (nullable)
- `status`: Status (ACTIVE)
- `listingTxHash`: Transaction hash
- `listingBlock`: Block number
- `createdAt`: Timestamp

### Data yang DI-UPDATE

#### **nfts** (Opsional - untuk tracking)
```typescript
UPDATE nfts SET
  updatedAt = NOW()
WHERE contractAddress = contractAddress 
  AND tokenId = tokenId 
  AND chainId = chainId
```

---

## 3. OFFER EVENT (Penawaran untuk NFT)

### Data yang DI-INSERT

#### **marketplace_offers** (Wajib)
Record offer/bid untuk NFT:
- `chainId`: Chain ID
- `marketplace`: Marketplace
- `contractAddress`: Contract address NFT
- `tokenId`: Token ID
- `offerer`: Address yang membuat offer
- `price`: Harga offer
- `currency`: Currency (biasanya WETH)
- `quantity`: Jumlah (default: "1")
- `offerTime`: Waktu offer dibuat
- `expirationTime`: Waktu expiration (nullable)
- `status`: Status (ACTIVE)
- `offerTxHash`: Transaction hash
- `offerBlock`: Block number
- `createdAt`: Timestamp

### Data yang DI-UPDATE

Tidak ada update khusus untuk offer event, hanya insert record baru.

---

## 4. CANCEL EVENT (Pembatalan Listing/Offer)

### Data yang DI-UPDATE

#### **marketplace_listings** (Jika cancel listing)
```typescript
UPDATE marketplace_listings SET
  status = 'CANCELLED',
  cancelTxHash = txHash,
  cancelBlock = blockNumber,
  updatedAt = NOW()
WHERE chainId = chainId
  AND marketplace = marketplace
  AND contractAddress = contractAddress
  AND tokenId = tokenId
  AND status = 'ACTIVE'
```

#### **marketplace_offers** (Jika cancel offer)
```typescript
UPDATE marketplace_offers SET
  status = 'CANCELLED',
  cancelTxHash = txHash,
  cancelBlock = blockNumber,
  updatedAt = NOW()
WHERE chainId = chainId
  AND marketplace = marketplace
  AND contractAddress = contractAddress
  AND tokenId = tokenId
  AND status = 'ACTIVE'
```

---

## Urutan Eksekusi per Event Type

### SALE Event
1. ✅ **INSERT** `marketplace_sales`
2. ✅ **UPDATE** `marketplace_listings` (status = SOLD)
3. ✅ **UPDATE/INSERT** `nft_collection_analytics`
4. ⚠️ **UPDATE** `nft_ownership` (set old owner isCurrent = false)
5. ⚠️ **INSERT** `nft_ownership` (new owner)
6. ⚠️ **INSERT** `nft_transfers` (transfer record)

### LISTING Event
1. ✅ **INSERT** `marketplace_listings`
2. ✅ **UPDATE** `nfts` (optional)

### OFFER Event
1. ✅ **INSERT** `marketplace_offers`

### CANCEL Event
1. ✅ **UPDATE** `marketplace_listings` (status = CANCELLED)
2. ✅ **UPDATE** `marketplace_offers` (status = CANCELLED)

---

## Status Enum Values

### ListingStatus
- `ACTIVE`: Listing aktif
- `SOLD`: Sudah terjual
- `CANCELLED`: Dibatalkan
- `EXPIRED`: Kadaluarsa

### OfferStatus
- `ACTIVE`: Offer aktif
- `ACCEPTED`: Offer diterima
- `CANCELLED`: Dibatalkan
- `EXPIRED`: Kadaluarsa

### Marketplace Enum
- `OPENSEA`
- `BLUR`
- `LOOKSRARE`
- `X2Y2`
- `RARIBLE`
- `FOUNDATION`
- `ZORA`
- `SUDOSWAP`

---

## Transaction Safety

Semua operasi database dibungkus dengan:
- `withRetry()`: Retry otomatis jika gagal
- `withDbLimit()`: Rate limiting untuk database
- Error handling yang proper

---

## Implementasi

File: `src/lib/queue/processors/marketplace-event-processor.ts`

### Fungsi Utama:
- `processSale()`: Handle sale event
- `processListing()`: Handle listing event
- `processOffer()`: Handle offer event
- `processCancel()`: Handle cancel event
- `updateCollectionAnalytics()`: Update analytics collection

---

## Yang Perlu Ditambahkan

⚠️ **Belum diimplementasi:**
1. Update `nft_ownership` pada sale event
2. Insert `nft_transfers` pada sale event
3. Update volume analytics yang lebih lengkap (24h, 7d, 30d)
4. Update `launchpad_analytics` jika NFT dari launchpad
5. Update floor price tracking

---

## Related Files

- `src/lib/queue/processors/marketplace-event-processor.ts` - Main processor
- `src/lib/queue/queue-config.ts` - Queue configuration
- `prisma/schema.prisma` - Database schema
