# NFT Event Handler

## Overview

The NFT Event Handler is a comprehensive system for processing NFT-related blockchain events, fetching metadata, tracking ownership, and maintaining contract information. It integrates with Alchemy's NFT API to provide rich metadata and spam detection capabilities.

## Features

### ✅ Task 4.1: Transfer Event Handler
- **Mint Detection**: Automatically detects and processes mint events (transfers from zero address)
- **Burn Detection**: Handles burn events (transfers to zero address) and updates supply
- **Regular Transfers**: Processes standard NFT transfers between addresses
- **Transfer Records**: Creates detailed transfer history in the database
- **Duplicate Prevention**: Prevents duplicate processing of the same transfer event

### ✅ Task 4.3: Metadata Fetching and Storage
- **Alchemy Integration**: Fetches complete NFT metadata from Alchemy API
- **Attribute Extraction**: Parses and stores NFT attributes/traits
- **Image Processing**: Stores multiple image formats (cached, thumbnail, PNG, original)
- **Raw Metadata Preservation**: Maintains original metadata JSON
- **Metadata Refresh**: Supports triggering metadata updates
- **Spam Detection**: Integrates spam and airdrop detection

### ✅ Task 4.5: Ownership Tracking
- **Current Ownership**: Maintains accurate current owner records
- **Ownership History**: Preserves complete ownership history
- **Balance Tracking**: Supports ERC1155 quantity tracking
- **Holder Count**: Automatically updates unique holder counts per collection
- **Transaction Details**: Records block number, timestamp, and transaction hash

### ✅ Task 4.7: Contract Metadata Syncing
- **Contract Discovery**: Automatically fetches contract metadata on first encounter
- **OpenSea Integration**: Stores OpenSea-specific metadata (floor price, collection info)
- **Deployer Information**: Tracks contract deployer and deployment block
- **Supply Tracking**: Maintains accurate total supply counts
- **Metadata Updates**: Supports refreshing contract metadata

## Architecture

```
NFTEventHandler
├── Transfer Event Processing
│   ├── handleTransferEvent()
│   ├── handleMint()
│   ├── handleBurn()
│   └── handleRegularTransfer()
├── Metadata Management
│   ├── syncNFTMetadata()
│   ├── storeNFTData()
│   └── refreshNFTMetadata()
├── Ownership Tracking
│   ├── updateOwnership()
│   ├── removeOwnership()
│   └── updateHolderCount()
└── Contract Management
    ├── ensureContractExists()
    ├── syncContractMetadata()
    └── updateOpenSeaMetadata()
```

## Requirements Fulfilled

### Requirement 11.1 - Transfer Processing
✅ Updates ownership records for all token transfers

### Requirement 11.2 - Mint Detection
✅ Records transfers from zero address as mint events

### Requirement 11.3 - Burn Detection
✅ Records transfers to zero address as burn events and updates supply

### Requirement 11.4 - Transfer Records
✅ Creates activity records with complete transfer details

### Requirement 1.1 - NFT Data Storage
✅ Stores contract address, token ID, token type, name, description, and token URI

### Requirement 1.2 - Image Data Storage
✅ Stores all image formats (cached, thumbnail, PNG, original) with metadata

### Requirement 1.3 - Attribute Storage
✅ Stores each attribute with trait type, value, and display type

### Requirement 1.4 - Metadata Updates
✅ Updates timeLastUpdated field on metadata changes

### Requirement 1.5 - Raw Metadata Preservation
✅ Preserves original metadata JSON and token URI

### Requirement 2.1 - Contract Data Storage
✅ Stores contract address, name, symbol, total supply, and token type

### Requirement 2.2 - Deployer Information
✅ Stores contract deployer address and deployed block number

### Requirement 2.3 - OpenSea Metadata
✅ Stores complete OpenSea metadata including floor price and social links

### Requirement 2.4 - Contract Metadata Refresh
✅ Updates all contract fields with latest blockchain data

### Requirement 3.1 - Ownership Updates
✅ Updates owner address for transferred tokens

### Requirement 3.2 - Ownership Queries
✅ Returns current owner address and token balance

### Requirement 3.3 - Multiple Token Ownership
✅ Stores all token IDs with their balances

### Requirement 3.4 - Transfer Metadata
✅ Records block timestamp and block number of transfers

### Requirement 3.5 - Ownership History
✅ Maintains records of all previous owners

## Usage

### Basic Setup

```typescript
import { NFTEventHandler } from './event-handlers/nft-events';
import { AlchemyNFTService } from '../alchemy-nft-service';
import { AlchemySpamDetector } from '../alchemy-spam-detector';

// Create services
const alchemyService = new AlchemyNFTService({
  apiKey: 'your-api-key',
  network: 'eth-mainnet'
});

const spamDetector = new AlchemySpamDetector(alchemyService);

// Create handler
const handler = new NFTEventHandler({
  chainId: 1,
  retryAttempts: 3,
  errorCounters: new Map(),
  errorThreshold: 10,
  sendAdminAlert: async (alert) => console.log(alert),
  alchemyService,
  spamDetector
});
```

### Process Transfer Event

```typescript
await handler.handleTransferEvent({
  contractAddress: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
  tokenId: '1234',
  from: '0x0000000000000000000000000000000000000000', // Mint
  to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  quantity: '1',
  txHash: '0xabc123...',
  blockNumber: 12345678,
  blockTimestamp: new Date(),
  logIndex: 0,
  tokenType: 'ERC721'
});
```

### Sync Metadata

```typescript
// Sync NFT metadata
await handler.syncNFTMetadata(
  '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
  '1234',
  'ERC721'
);

// Sync contract metadata
await handler.syncContractMetadata(
  '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
  'ERC721'
);
```

### Integration with NFT Event Listener

```typescript
import { NFTEventListener } from '../nft-event-listener';

const listener = new NFTEventListener({
  chainId: 1,
  rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/your-key',
  contracts: [
    {
      address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
      tokenType: 'ERC721',
      chainId: 1
    }
  ],
  nftEventHandler: handler // Pass handler to listener
});

await listener.start();
```

## Database Schema

### NFT Table
Stores complete NFT metadata including:
- Contract address, token ID, token type
- Name, description, token URI
- Image data (cached, thumbnail, PNG, original)
- Raw metadata JSON
- Mint information
- Spam/airdrop flags
- Timestamps

### NFTContract Table
Stores contract metadata including:
- Contract address, name, symbol
- Total supply, token type
- Deployer information
- OpenSea metadata (floor price, collection info, social links)

### NFTOwnership Table
Tracks ownership with:
- Current owner address
- Token balance (for ERC1155)
- Acquisition details (timestamp, block, transaction)
- Historical ownership flag

### NFTTransfer Table
Records all transfers with:
- From/to addresses
- Quantity transferred
- Transaction details
- Transfer type (MINT, TRANSFER, BURN)

### NFTAttribute Table
Stores NFT attributes with:
- Trait type and value
- Display type
- Numeric value (if applicable)
- Rarity data (prevalence, count)

## Error Handling

The handler includes comprehensive error handling:

1. **Validation**: Validates all event data before processing
2. **Duplicate Detection**: Prevents duplicate transfer processing
3. **Retry Logic**: Inherited from BaseEventHandler
4. **Error Logging**: Logs all errors with context
5. **Graceful Degradation**: Continues processing even if metadata fetch fails
6. **Admin Alerts**: Sends alerts for critical errors

## Performance Considerations

1. **Batch Processing**: Supports processing multiple events in parallel
2. **Caching**: Spam detection results are cached
3. **Minimal RPC Calls**: Fetches metadata only when needed
4. **Database Optimization**: Uses upsert operations to avoid conflicts
5. **Async Processing**: All operations are asynchronous

## Testing

Comprehensive test suite included:
- Transfer type identification (mint, burn, transfer)
- Event data validation
- Address normalization
- ERC1155 quantity handling
- Duplicate detection

Run tests:
```bash
npm test -- src/lib/blockchain/event-handlers/__tests__/nft-events.test.ts --run
```

## Multi-Chain Support

The handler supports multiple chains:
- Ethereum Mainnet
- Polygon
- BSC
- Arbitrum
- Optimism
- Base
- Avalanche
- Testnets

Each chain requires its own handler instance with appropriate chainId and Alchemy service.

## Future Enhancements

Potential improvements:
1. Batch metadata fetching for multiple NFTs
2. Metadata caching layer
3. Historical sync support
4. Rarity calculation integration
5. Floor price tracking
6. Analytics calculation

## Related Components

- **NFTEventListener**: Listens to blockchain events and routes to handler
- **AlchemyNFTService**: Fetches NFT metadata from Alchemy API
- **AlchemySpamDetector**: Detects spam and airdrop NFTs
- **AlchemyMetadataMapper**: Maps Alchemy responses to database schema

## Documentation

- See `nft-events.example.ts` for usage examples
- See `nft-events.test.ts` for test examples
- See design document for detailed requirements

## Support

For issues or questions:
1. Check the example file for common use cases
2. Review the test file for expected behavior
3. Consult the design document for requirements
4. Check error logs for debugging information

