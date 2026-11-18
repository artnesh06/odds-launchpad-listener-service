# Blockchain-Only Indexing Approach

## Overview

Sistem NFT Indexer dirancang untuk bekerja **100% dari blockchain events** tanpa ketergantungan pada API pihak ketiga seperti Alchemy. Semua data diperoleh langsung dari smart contract events dan calls.

---

## Data Sources - Pure Blockchain

### 1. NFT Metadata
**Source:** Token URI dari smart contract

```typescript
// Get token URI from contract
const tokenURI = await nftContract.tokenURI(tokenId);

// Fetch metadata from IPFS/HTTP
const metadata = await fetch(tokenURI);

// Parse and store
const { name, description, image, attributes } = await metadata.json();
```

**Events yang digunakan:**
- `Transfer` - Detect new mints
- `URI` (ERC1155) - Detect metadata updates

### 2. Ownership Tracking
**Source:** Transfer events

```typescript
// Listen to Transfer events
contract.on('Transfer', (from, to, tokenId) => {
  // Update ownership in database
  await updateOwnership(tokenId, to);
});
```

**Events yang digunakan:**
- `Transfer(address from, address to, uint256 tokenId)`

### 3. Marketplace Sales
**Source:** Marketplace contract events

```typescript
// OpenSea Seaport
contract.on('OrderFulfilled', (orderHash, offerer, zone, recipient, offer, consideration) => {
  // Extract sale data
  const sale = parseSaleFromEvent(event);
  await storeSale(sale);
});
```

**Events yang digunakan:**
- OpenSea: `OrderFulfilled`, `OrderCancelled`
- Blur: `OrdersMatched`
- LooksRare: `TakerAsk`, `TakerBid`
- Magic Eden: `BuyListingERC721`

### 4. Floor Price Calculation
**Source:** Active listings from marketplace events

```typescript
// Calculate from active listings
const activeListings = await getActiveListings(contractAddress);
const floorPrice = Math.min(...activeListings.map(l => l.price));
```

**Data source:**
- Marketplace listing events
- Real-time calculation from database

### 5. Contract Metadata
**Source:** Smart contract calls

```typescript
// Get contract info
const name = await contract.name();
const symbol = await contract.symbol();
const totalSupply = await contract.totalSupply();
const owner = await contract.owner();
```

**Methods yang digunakan:**
- `name()` - Contract name
- `symbol()` - Token symbol
- `totalSupply()` - Total supply
- `owner()` - Contract owner

### 6. Spam Detection
**Source:** On-chain analysis

```typescript
// Heuristic-based spam detection
const isSpam = await detectSpam({
  totalSupply: contract.totalSupply(),
  holderCount: await getHolderCount(contract),
  transferCount: await getTransferCount(contract),
  hasMetadata: await hasValidMetadata(contract),
  creationTime: await getContractCreationTime(contract),
});
```

**Indicators:**
- Very high supply (> 1M)
- Very low holder count
- No metadata or invalid metadata
- Suspicious transfer patterns
- Recently created with high activity

### 7. Rarity Calculation
**Source:** Attribute data from metadata

```typescript
// Calculate from stored attributes
const attributes = await getAllAttributes(contractAddress);
const prevalence = calculateAttributePrevalence(attributes);
const rarityScore = calculateRarityScore(tokenId, prevalence);
```

**Data source:**
- NFT attributes from metadata
- Collection-wide analysis

---

## Implementation Architecture

### Event-Driven Flow

```
Blockchain Events
    ↓
Event Listeners (ethers.js)
    ↓
Event Handlers
    ↓
Data Processors
    ↓
Database (PostgreSQL)
    ↓
API Endpoints
```

### No External API Dependencies

```
❌ Alchemy API
❌ Moralis API
❌ OpenSea API (for metadata)
❌ Any centralized service

✅ RPC Provider (Infura/Alchemy RPC only)
✅ IPFS Gateway (for metadata)
✅ Smart Contract Calls
✅ Blockchain Events
```

---

## Data Collection Methods

### Method 1: Real-Time Event Listening

```typescript
// Listen to new events as they happen
const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(address, abi, provider);

contract.on('Transfer', async (from, to, tokenId, event) => {
  // Process immediately
  await handleTransfer({ from, to, tokenId, event });
});
```

**Advantages:**
- Real-time updates
- No API rate limits
- Complete control

### Method 2: Historical Sync

```typescript
// Sync past events in batches
const filter = contract.filters.Transfer();
const events = await contract.queryFilter(filter, startBlock, endBlock);

for (const event of events) {
  await handleTransfer(event);
}
```

**Advantages:**
- Backfill historical data
- Batch processing
- Efficient for large ranges

### Method 3: Direct Contract Calls

```typescript
// Query contract state directly
const tokenURI = await contract.tokenURI(tokenId);
const owner = await contract.ownerOf(tokenId);
const balance = await contract.balanceOf(address);
```

**Advantages:**
- Get current state
- No event dependency
- Verify data accuracy

---

## Metadata Fetching Strategy

### 1. From Token URI

```typescript
async function fetchMetadata(tokenURI: string) {
  // Handle different URI schemes
  if (tokenURI.startsWith('ipfs://')) {
    return await fetchFromIPFS(tokenURI);
  } else if (tokenURI.startsWith('http')) {
    return await fetchFromHTTP(tokenURI);
  } else if (tokenURI.startsWith('data:')) {
    return parseDataURI(tokenURI);
  }
}
```

### 2. IPFS Gateway

```typescript
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

async function fetchFromIPFS(ipfsURI: string) {
  const hash = ipfsURI.replace('ipfs://', '');
  
  // Try multiple gateways for reliability
  for (const gateway of IPFS_GATEWAYS) {
    try {
      const response = await fetch(gateway + hash);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      continue; // Try next gateway
    }
  }
  
  throw new Error('Failed to fetch from IPFS');
}
```

### 3. Caching Strategy

```typescript
// Cache metadata to reduce external calls
const cachedMetadata = await cache.get(`metadata:${contractAddress}:${tokenId}`);

if (cachedMetadata) {
  return cachedMetadata;
}

const metadata = await fetchMetadata(tokenURI);
await cache.set(`metadata:${contractAddress}:${tokenId}`, metadata, TTL);
```

---

## Spam Detection Algorithm

### Heuristic-Based Detection

```typescript
interface SpamIndicators {
  suspiciousSupply: boolean;    // > 1M tokens
  lowHolderRatio: boolean;      // holders / supply < 0.01
  noMetadata: boolean;          // No valid metadata
  recentCreation: boolean;      // Created < 7 days ago
  highTransferRate: boolean;    // > 1000 transfers/day
  suspiciousName: boolean;      // Contains spam keywords
}

async function detectSpam(contract: Contract): Promise<boolean> {
  const indicators = await analyzeContract(contract);
  
  // Spam if 3+ indicators are true
  const spamScore = Object.values(indicators).filter(Boolean).length;
  return spamScore >= 3;
}
```

### Community-Based Detection

```typescript
// Allow manual spam reporting
async function reportSpam(contractAddress: string, reporter: string) {
  await db.spamReport.create({
    contractAddress,
    reporter,
    timestamp: new Date(),
  });
  
  // Auto-mark as spam if 5+ reports
  const reportCount = await db.spamReport.count({ contractAddress });
  if (reportCount >= 5) {
    await markAsSpam(contractAddress);
  }
}
```

---

## Floor Price Calculation

### From Active Listings

```typescript
async function calculateFloorPrice(
  contractAddress: string,
  chainId: number
): Promise<string | null> {
  // Get all active listings
  const listings = await db.marketplaceListing.findMany({
    where: {
      contractAddress,
      chainId,
      status: 'ACTIVE',
      expirationTime: { gt: new Date() },
    },
    orderBy: { price: 'asc' },
    take: 1,
  });
  
  return listings[0]?.price || null;
}
```

### Multi-Marketplace Aggregation

```typescript
async function getLowestFloorPrice(
  contractAddress: string,
  chainId: number
): Promise<FloorPrice> {
  const marketplaces = ['OPENSEA', 'BLUR', 'LOOKSRARE'];
  
  const prices = await Promise.all(
    marketplaces.map(async (marketplace) => {
      const price = await calculateFloorPrice(
        contractAddress,
        chainId,
        marketplace
      );
      return { marketplace, price };
    })
  );
  
  // Return lowest price
  return prices
    .filter(p => p.price !== null)
    .sort((a, b) => parseFloat(a.price!) - parseFloat(b.price!))[0];
}
```

---

## Performance Optimization

### 1. Batch Processing

```typescript
// Process events in batches
const BATCH_SIZE = 100;

for (let i = 0; i < events.length; i += BATCH_SIZE) {
  const batch = events.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(handleEvent));
}
```

### 2. Parallel Processing

```typescript
// Process multiple contracts simultaneously
const contracts = await getActiveContracts();

await Promise.all(
  contracts.map(contract => syncContract(contract))
);
```

### 3. Incremental Sync

```typescript
// Only sync new blocks
const lastSyncedBlock = await getLastSyncedBlock(chainId);
const currentBlock = await provider.getBlockNumber();

if (currentBlock > lastSyncedBlock) {
  await syncBlocks(lastSyncedBlock + 1, currentBlock);
}
```

---

## Advantages of Blockchain-Only Approach

### ✅ Benefits

1. **No API Dependencies**
   - No rate limits
   - No API keys needed
   - No third-party downtime

2. **Complete Data Control**
   - Own the data pipeline
   - Verify data accuracy
   - Custom processing logic

3. **Cost Effective**
   - No API subscription fees
   - Only RPC costs (can use free tier)
   - Scalable without extra costs

4. **Decentralized**
   - True Web3 approach
   - No centralized points of failure
   - Censorship resistant

5. **Customizable**
   - Add custom analytics
   - Custom spam detection
   - Custom data structures

### ⚠️ Considerations

1. **Initial Sync Time**
   - Historical sync can take time
   - Solution: Incremental sync, parallel processing

2. **RPC Rate Limits**
   - Free RPC tiers have limits
   - Solution: Multiple providers, caching

3. **IPFS Reliability**
   - IPFS gateways can be slow
   - Solution: Multiple gateways, caching

4. **Metadata Parsing**
   - Various metadata formats
   - Solution: Robust parsing, fallbacks

---

## Configuration

### Environment Variables

```env
# RPC Providers (no API keys needed for public endpoints)
RPC_URL_ETHEREUM=https://eth.llamarpc.com
RPC_URL_POLYGON=https://polygon-rpc.com
RPC_URL_ARBITRUM=https://arb1.arbitrum.io/rpc
RPC_URL_OPTIMISM=https://mainnet.optimism.io
RPC_URL_BASE=https://mainnet.base.org

# IPFS Gateways
IPFS_GATEWAY_1=https://ipfs.io/ipfs/
IPFS_GATEWAY_2=https://cloudflare-ipfs.com/ipfs/
IPFS_GATEWAY_3=https://gateway.pinata.cloud/ipfs/

# Caching
CACHE_TTL_METADATA=3600
CACHE_TTL_CONTRACT=86400

# Processing
BATCH_SIZE=100
SYNC_INTERVAL_MS=5000
```

---

## Summary

Sistem NFT Indexer **tidak memerlukan Alchemy API atau API pihak ketiga lainnya**. Semua data diperoleh langsung dari:

1. ✅ Blockchain events (Transfer, marketplace events)
2. ✅ Smart contract calls (metadata, ownership)
3. ✅ IPFS/HTTP (metadata JSON)
4. ✅ Database calculations (floor price, analytics)

Ini membuat sistem:
- **Truly decentralized**
- **Cost-effective**
- **Reliable**
- **Scalable**
- **Independent**

**Alchemy hanya digunakan sebagai RPC provider (opsional)**, bukan untuk NFT API mereka.
