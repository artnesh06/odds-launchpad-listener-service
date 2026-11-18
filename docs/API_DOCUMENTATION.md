# Odds Launchpad API Documentation

Base URL: `https://backend.oddslaunchpad.com`

---

## Health Endpoints

### GET /health
Mendapatkan status kesehatan sistem.

### GET /health/websocket
Mendapatkan status WebSocket server secara detail.

---

## NFT Endpoints

### GET /api/nfts
Query NFTs dengan filter.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| chainId | integer | Filter by chain ID |
| contractAddress | string | Filter by contract address |
| ownerAddress | string | Filter by owner address |
| limit | integer | Number of results (default: 50, max: 100) |
| cursor | string | Pagination cursor |
| orderBy | string | Sort field: `tokenId`, `timeLastUpdated`, `rarity` |
| orderDirection | string | Sort direction: `asc`, `desc` |

### GET /api/nfts/owner/{ownerAddress}
Mendapatkan semua NFT yang dimiliki oleh address tertentu.

### GET /api/nfts/collection/{chainId}/{contractAddress}
Mendapatkan semua NFT dalam collection.

### GET /api/nfts/collection/{chainId}/{contractAddress}/rarest
Mendapatkan NFT paling langka dalam collection.

### GET /api/nfts/collection/{chainId}/{contractAddress}/attributes
Mendapatkan distribusi atribut dalam collection.

### GET /api/nfts/search?q={query}
Mencari NFT berdasarkan nama atau deskripsi.

---

## Marketplace Endpoints

### GET /api/marketplace/sales
Query marketplace sales dengan filter.

### GET /api/marketplace/collection/{chainId}/{contractAddress}/sales
Mendapatkan recent sales untuk collection.

### GET /api/marketplace/collection/{chainId}/{contractAddress}/listings
Mendapatkan active listings untuk collection.

### GET /api/marketplace/collection/{chainId}/{contractAddress}/offers
Mendapatkan active offers untuk collection.

### GET /api/marketplace/collection/{chainId}/{contractAddress}/activity
Mendapatkan combined marketplace activity.

### GET /api/marketplace/collection/{chainId}/{contractAddress}/stats
Mendapatkan statistik penjualan untuk collection.

---

## Chain Endpoints

### GET /api/chains
Mendapatkan status semua chain yang didukung.

### POST /api/chains/{chainId}/restart
Restart blockchain listener untuk chain tertentu.

---

## Launchpad Endpoints

### GET /api/launchpads/{chainId}
Mendapatkan semua launchpad pada chain tertentu.

---

## Indexer Endpoints

### POST /api/indexer/sync-all
Sync semua missing NFTs di semua chain.

### POST /api/indexer/sync/{chainId}
Sync semua missing NFTs pada chain tertentu.

### POST /api/indexer/sync/{chainId}/{launchpadAddress}
Sync missing NFTs untuk launchpad tertentu.

---

## Metadata Endpoints

### POST /api/metadata/refresh/{chainId}/{contractAddress}
Refresh metadata untuk seluruh collection via Alchemy API.

### POST /api/metadata/refresh/{chainId}/{contractAddress}/{tokenId}
Refresh metadata untuk NFT tertentu via Alchemy API.

---

## Supported Chains

| Chain ID | Name |
|----------|------|
| 6343 | MegaETH Testnet V2 |
| 11155111 | Sepolia |
| 10143 | Monad Testnet |

---

## Swagger UI

Interactive API documentation:
```
https://backend.oddslaunchpad.com/api-docs
```
