# NFT Metadata Event Database Updates

## Overview
Dokumentasi ini menjelaskan data yang di-INSERT dan di-UPDATE ketika ada NFT metadata fetch/refresh event.

---

## Event Trigger

Metadata fetch dapat di-trigger oleh:
1. **Mint event** - Fetch metadata untuk NFT yang baru di-mint
2. **Manual refresh** - User request refresh metadata
3. **Reveal event** - Collection revealed, refresh semua metadata
4. **Scheduled job** - Periodic metadata refresh
5. **Metadata update event** - BaseURI atau ContractURI berubah

---

## Data yang DI-UPDATE

### **nfts** (Wajib)

Update metadata NFT dari external source (IPFS, Alchemy, OpenSea, dll):

```typescript
UPDATE nfts SET
  name = metadata.name,
  description = metadata.description,
  tokenUri = metadata.tokenUri,
  imageCachedUrl = metadata.image.cachedUrl,
  imageThumbnailUrl = metadata.image.thumbnailUrl,
  imagePngUrl = metadata.image.pngUrl,
  imageContentType = metadata.image.contentType,
  imageSize = metadata.image.size,
  imageOriginalUrl = metadata.image.originalUrl,
  rawMetadata = metadata.raw,
  rawTokenUri = metadata.rawTokenUri,
  timeLastUpdated = NOW(),
  isSpam = spamCheck.result,
  isAirdrop = spamCheck.isAirdrop,
  updatedAt = NOW()
WHERE id = nftId
```

---

## Data yang DI-INSERT

### **nft_attributes** (Jika ada attributes)

Insert attributes dari metadata:

```typescript
INSERT INTO nft_attributes (
  nftId, traitType, value, displayType, numericValue
)
VALUES
  (nftId, 'Background', 'Blue', null, null),
  (nftId, 'Eyes', 'Laser', null, null),
  (nftId, 'Power', '100', 'number', 100),
  ...
```

**Attributes yang di-extract:**
- `trait_type`: Tipe trait (Background, Eyes, Rarity, dll)
- `value`: Nilai trait
- `display_type`: Display type (number, date, boost_percentage, dll)
- `numeric_value`: Nilai numerik (jika applicable)

---

## Data yang DI-UPDATE (Lanjutan)

### **nft_contracts** (Opsional)

Update contract metadata dari OpenSea/Alchemy:

```typescript
UPDATE nft_contracts SET
  name = contractMetadata.name,
  symbol = contractMetadata.symbol,
  totalSupply = contractMetadata.totalSupply,
  tokenType = contractMetadata.tokenType,
  openSeaFloorPrice = openSeaData.floorPrice,
  openSeaCollectionName = openSeaData.collectionName,
  openSeaCollectionSlug = openSeaData.slug,
  openSeaSafelistStatus = openSeaData.safelistStatus,
  openSeaImageUrl = openSeaData.imageUrl,
  openSeaDescription = openSeaData.description,
  openSeaExternalUrl = openSeaData.externalUrl,
  openSeaTwitter = openSeaData.twitterUsername,
  openSeaDiscord = openSeaData.discordUrl,
  openSeaBannerImageUrl = openSeaData.bannerImageUrl,
  openSeaLastIngestedAt = openSeaData.lastIngestedAt,
  updatedAt = NOW()
WHERE address = contractAddress AND chainId = chainId
```

---

## Metadata Sources

### 1. **Token URI (IPFS/HTTP)**
- Fetch dari `tokenUri` yang ada di contract
- Parse JSON metadata
- Extract name, description, image, attributes

### 2. **Alchemy API**
- `getNFTMetadata()`: Get metadata lengkap
- `getContractMetadata()`: Get contract info
- `isSpamContract()`: Check spam status
- Cached images (thumbnails, PNG versions)

### 3. **OpenSea API**
- Collection metadata
- Floor price
- Safelist status
- Social links

### 4. **IPFS Gateway**
- Fetch dari IPFS hash
- Multiple gateway fallback
- Timeout handling

---

## Spam Detection

### **isSpam Flag**

Criteria untuk spam detection:
- Contract flagged by Alchemy
- Suspicious metadata patterns
- Known spam collections
- Airdrop patterns

```typescript
UPDATE nfts SET
  isSpam = true,
  updatedAt = NOW()
WHERE id = nftId
```

### **isAirdrop Flag**

Criteria untuk airdrop detection:
- Unsolicited transfer
- From unknown address
- Suspicious metadata
- Low value collection

```typescript
UPDATE nfts SET
  isAirdrop = true,
  updatedAt = NOW()
WHERE id = nftId
```

---

## Image Processing

### Image Variants

System menyimpan multiple image variants:

1. **imageOriginalUrl**: Original image URL dari metadata
2. **imageCachedUrl**: Cached version (Alchemy CDN)
3. **imageThumbnailUrl**: Thumbnail (256x256)
4. **imagePngUrl**: PNG version (jika original bukan PNG)

### Image Metadata

```typescript
{
  imageContentType: 'image/png',
  imageSize: 1024000, // bytes
  imageOriginalUrl: 'ipfs://...',
  imageCachedUrl: 'https://...',
  imageThumbnailUrl: 'https://...',
  imagePngUrl: 'https://...'
}
```

---

## Attribute Processing

### Attribute Types

1. **String attributes**: Background, Eyes, Clothes, dll
2. **Numeric attributes**: Power, Level, Speed, dll
3. **Date attributes**: Birthday, Created Date, dll
4. **Boost attributes**: Boost Percentage, Boost Number, dll

### Display Types

- `null`: Default string display
- `number`: Numeric value
- `date`: Unix timestamp
- `boost_percentage`: Percentage boost
- `boost_number`: Numeric boost

### Prevalence Calculation

```typescript
-- Calculate prevalence untuk setiap attribute
UPDATE nft_attributes SET
  prevalence = (
    SELECT COUNT(*) 
    FROM nft_attributes 
    WHERE traitType = attr.traitType 
      AND value = attr.value
  ) / (
    SELECT COUNT(DISTINCT nftId) 
    FROM nft_attributes
  ),
  count = (
    SELECT COUNT(*) 
    FROM nft_attributes 
    WHERE traitType = attr.traitType 
      AND value = attr.value
  )
WHERE id = attr.id
```

---

## Rarity Calculation

Setelah metadata dan attributes di-fetch, trigger rarity calculation:

### **nft_rarity** (Insert/Update)

```typescript
INSERT INTO nft_rarity (
  nftId, strategyId, strategyVersion,
  rank, score, maxRank, totalSupply,
  rarityScore, prevalence, percentile,
  calculatedAt
)
```

Rarity calculation strategies:
1. **Trait Rarity**: Based on attribute prevalence
2. **Statistical Rarity**: Statistical analysis
3. **OpenRarity**: OpenRarity standard

---

## Error Handling

### Metadata Fetch Failures

Jika metadata fetch gagal:
1. Log error ke `error_logs`
2. Retry dengan exponential backoff
3. Fallback ke cached data (jika ada)
4. Mark NFT untuk manual review

```typescript
INSERT INTO error_logs (
  errorType, severity, message, component,
  operation, chainId, contractAddress, tokenId,
  metadata
)
VALUES (
  'METADATA_FETCH_FAILED', 'WARNING',
  'Failed to fetch metadata', 'NFTMetadataProcessor',
  'fetchMetadata', chainId, contractAddress, tokenId,
  { error: error.message, tokenUri: tokenUri }
)
```

---

## Batch Processing

Untuk collection reveal atau bulk refresh:

1. Queue semua tokenIds ke `nft-metadata` queue
2. Process dengan concurrency limit (5 concurrent)
3. Rate limiting untuk external APIs
4. Progress tracking

```typescript
// Queue multiple metadata jobs
for (const tokenId of tokenIds) {
  await metadataQueue.add({
    chainId,
    contractAddress,
    tokenId,
    forceRefresh: true
  }, {
    priority: 2,
    attempts: 3
  });
}
```

---

## Urutan Eksekusi

1. ✅ Get NFT record dari database
2. ✅ Fetch metadata dari token URI atau Alchemy
3. ✅ **UPDATE** `nfts` dengan metadata
4. ✅ **INSERT** `nft_attributes` (delete old, insert new)
5. ✅ Check spam status
6. ✅ **UPDATE** `nfts` dengan spam flag
7. ✅ **UPDATE** `nft_contracts` (jika ada contract metadata)
8. ⚠️ Trigger rarity calculation (belum implemented)
9. ⚠️ Update collection analytics (belum implemented)

---

## Transaction Safety

Semua operasi database dibungkus dengan:
- `withRetry()`: Retry otomatis jika gagal
- `withDbLimit()`: Rate limiting untuk database
- Timeout handling untuk external API calls
- Error logging

---

## Implementasi

File: `src/lib/queue/processors/nft-metadata-processor.ts`

### Fungsi Utama:
- `process()`: Main processor
- `fetchMetadata()`: Fetch dari Alchemy/IPFS
- `updateNFTMetadata()`: Update database
- `extractAttributes()`: Extract attributes dari metadata
- `checkSpamStatus()`: Check spam

---

## Yang Perlu Ditambahkan

⚠️ **Perlu diimplementasi:**
1. Rarity calculation setelah metadata fetch
2. Update collection analytics
3. Image caching/processing
4. Attribute prevalence calculation
5. Batch metadata refresh untuk revealed collections
6. Metadata validation
7. IPFS gateway fallback
8. OpenSea metadata integration

---

## Performance Considerations

### Rate Limiting
- Alchemy API: 330 requests/second (free tier)
- IPFS Gateway: Varies by gateway
- OpenSea API: 2 requests/second

### Caching
- Cache metadata for 24 hours
- Cache images permanently (CDN)
- Cache contract metadata for 1 hour

### Queue Priority
- New mints: High priority
- Manual refresh: Medium priority
- Bulk refresh: Low priority
- Scheduled refresh: Low priority

---

## Related Files

- `src/lib/queue/processors/nft-metadata-processor.ts` - Main processor
- `src/lib/alchemy-nft-service.ts` - Alchemy integration
- `src/lib/alchemy-metadata-mapper.ts` - Metadata mapping
- `src/lib/alchemy-spam-detector.ts` - Spam detection
- `src/lib/queue/queue-config.ts` - Queue configuration
- `prisma/schema.prisma` - Database schema
