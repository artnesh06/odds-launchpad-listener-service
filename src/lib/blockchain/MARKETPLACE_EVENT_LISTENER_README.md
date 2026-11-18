# Marketplace Event Listener

## Overview

The Marketplace Event Listener is a comprehensive system for monitoring and capturing NFT marketplace events across multiple platforms and blockchain networks. It supports OpenSea Seaport, Blur, LooksRare, and Magic Eden marketplaces.

## Features

- **Multi-Marketplace Support**: Listen to events from OpenSea Seaport, Blur, LooksRare, and Magic Eden
- **Multi-Chain Support**: Works across Ethereum, Polygon, BSC, Arbitrum, Optimism, Base, and Avalanche
- **Version Management**: Supports multiple contract versions for each marketplace
- **Event Types**: Captures sales (OrderFulfilled), cancellations, and offers
- **Configurable**: Select which marketplaces to monitor per chain
- **Error Handling**: Built-in error logging and retry mechanisms

## Architecture

### Components

1. **MarketplaceEventListener**: Main listener class that manages event subscriptions
2. **Marketplace Contract Registry**: Configuration of marketplace contracts per chain
3. **Event Handlers**: Marketplace-specific event processing (to be implemented in Task 6)

### Supported Events

#### OpenSea Seaport
- `OrderFulfilled`: When an order is successfully filled (sale)
- `OrderCancelled`: When an order is cancelled
- `CounterIncremented`: When a user's counter is incremented

#### Blur
- `OrdersMatched`: When buy and sell orders are matched (sale)
- `OrderCancelled`: When an order is cancelled

#### LooksRare
- `TakerAsk`: When a seller accepts a bid (sale)
- `TakerBid`: When a buyer accepts a listing (sale)

#### Magic Eden
- `BuyListingERC721`: When a buyer purchases a listed NFT (sale)
- `SellOfferERC721`: When a seller accepts an offer (sale)

## Usage

### Basic Setup

```typescript
import { MarketplaceEventListener } from './lib/blockchain/marketplace-event-listener';
import { Marketplace } from '@prisma/client';

const config = {
  chainId: 1, // Ethereum mainnet
  rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
  marketplaces: [
    Marketplace.SEAPORT,
    Marketplace.BLUR,
    Marketplace.LOOKSRARE
  ],
  errorThreshold: 10,
  retryAttempts: 3
};

const listener = new MarketplaceEventListener(config);
await listener.start();
```

### Multi-Chain Setup

```typescript
// Ethereum
const ethListener = new MarketplaceEventListener({
  chainId: 1,
  rpcUrl: process.env.ETH_RPC_URL,
  marketplaces: [Marketplace.SEAPORT, Marketplace.BLUR, Marketplace.LOOKSRARE]
});

// Polygon
const polygonListener = new MarketplaceEventListener({
  chainId: 137,
  rpcUrl: process.env.POLYGON_RPC_URL,
  marketplaces: [Marketplace.SEAPORT, Marketplace.MAGIC_EDEN]
});

// Base
const baseListener = new MarketplaceEventListener({
  chainId: 8453,
  rpcUrl: process.env.BASE_RPC_URL,
  marketplaces: [Marketplace.SEAPORT, Marketplace.MAGIC_EDEN]
});

await Promise.all([
  ethListener.start(),
  polygonListener.start(),
  baseListener.start()
]);
```

### Checking Status

```typescript
const status = listener.getStatus();
console.log(`Chain: ${status.chainId}`);
console.log(`Running: ${status.isRunning}`);
console.log(`Contracts: ${status.contractCount}`);
console.log('Marketplace contracts:', status.contracts);
```

### Stopping the Listener

```typescript
await listener.stop();
```

## Marketplace Contract Registry

The registry maintains a comprehensive list of marketplace contract addresses across all supported chains.

### Using the Registry

```typescript
import {
  getMarketplaceContractsForChain,
  getSupportedMarketplaces,
  isMarketplaceContract
} from './config/marketplace-contracts';

// Get all marketplace contracts for Ethereum
const ethContracts = getMarketplaceContractsForChain(1);

// Get supported marketplaces for a chain
const marketplaces = getSupportedMarketplaces(1);

// Check if an address is a marketplace contract
const isMarketplace = isMarketplaceContract(1, '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC');
```

### Supported Chains

| Chain ID | Chain Name | Supported Marketplaces |
|----------|------------|------------------------|
| 1 | Ethereum Mainnet | Seaport, Blur, LooksRare, X2Y2, Rarible |
| 137 | Polygon | Seaport, Magic Eden |
| 56 | BNB Smart Chain | Seaport |
| 42161 | Arbitrum One | Seaport |
| 10 | Optimism | Seaport |
| 8453 | Base | Seaport, Magic Eden |
| 43114 | Avalanche C-Chain | Seaport |
| 11155111 | Sepolia (Testnet) | Seaport |
| 80001 | Mumbai (Testnet) | Seaport |

### Contract Versions

The registry supports multiple versions of marketplace contracts:

- **Seaport**: v1.1, v1.4, v1.5
- **LooksRare**: v1.0, v2.0
- **Blur**: v1.0
- **Magic Eden**: v1.0

## Event Processing Flow

```
1. Event Detection
   Marketplace Contract → Event Emitted → Listener Catches Event

2. Event Validation
   Listener → Validate Event Data → Check Block Number

3. Event Logging
   Listener → Log Event Details → Console Output

4. Event Processing (Task 6)
   Listener → Route to Handler → Process Sale/Listing/Offer/Cancellation
```

## Configuration

### Environment Variables

```bash
# RPC URLs
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Error handling
ERROR_THRESHOLD=10
RETRY_ATTEMPTS=3
```

### Listener Configuration Options

```typescript
interface MarketplaceEventListenerConfig {
  chainId: number;              // Chain ID to listen on
  rpcUrl: string;               // RPC endpoint URL
  marketplaces: Marketplace[];  // Which marketplaces to monitor
  errorThreshold?: number;      // Error count before alerting (default: 10)
  retryAttempts?: number;       // Database retry attempts (default: 3)
}
```

## Error Handling

The listener includes comprehensive error handling:

- **Event Validation**: Validates event data before processing
- **Block Number Filtering**: Only processes events from current block onwards
- **Error Logging**: Logs errors with full context using centralized error logger
- **Graceful Degradation**: Continues processing other events if one fails

## Testing

### Running Tests

```bash
# Test marketplace event listener
npm test -- marketplace-event-listener.test.ts --run

# Test marketplace contract registry
npm test -- marketplace-contracts.test.ts --run

# Run all tests
npm test -- --run
```

### Test Coverage

- Initialization with different marketplace configurations
- Multi-chain support verification
- Contract registry functionality
- Status reporting
- Configuration validation

## Integration with Multi-Chain Listener Manager

The marketplace event listener can be integrated with the existing multi-chain listener manager:

```typescript
import { MultiChainListenerManager } from './lib/blockchain/multi-chain-listener-manager';
import { MarketplaceEventListener } from './lib/blockchain/marketplace-event-listener';

// In the manager, add marketplace listeners alongside NFT listeners
class EnhancedMultiChainListenerManager extends MultiChainListenerManager {
  private marketplaceListeners: Map<number, MarketplaceEventListener> = new Map();
  
  async addMarketplaceListener(chainId: number, marketplaces: Marketplace[]): Promise<void> {
    const chainConfig = getChainConfig(chainId);
    const listener = new MarketplaceEventListener({
      chainId,
      rpcUrl: chainConfig.rpcUrl,
      marketplaces
    });
    
    await listener.start();
    this.marketplaceListeners.set(chainId, listener);
  }
}
```

## Next Steps (Task 6)

The current implementation captures marketplace events but does not yet process them. Task 6 will implement:

1. **Sale Event Handler**: Process OrderFulfilled, OrdersMatched, TakerAsk/Bid, BuyListing events
2. **Listing Event Handler**: Process listing creation events
3. **Offer Event Handler**: Process offer events
4. **Cancellation Event Handler**: Process order cancellation events
5. **Database Storage**: Store marketplace events in the database
6. **Analytics Updates**: Update collection analytics after sales

## Requirements Satisfied

- ✅ **4.1**: Listen to marketplace listing events
- ✅ **4.2**: Listen to marketplace sale events
- ✅ **4.4**: Listen to cancellation events
- ✅ **4.5**: Support multiple marketplace versions
- ✅ **8.1**: Multi-chain support
- ✅ **13.1**: OpenSea Seaport event decoding
- ✅ **13.2**: Blur event decoding
- ✅ **13.3**: LooksRare event decoding
- ✅ **13.4**: Magic Eden event decoding
- ✅ **13.5**: Multiple contract version support

## Troubleshooting

### No Events Being Captured

1. Check RPC connection: `await provider.getBlockNumber()`
2. Verify contract addresses in registry
3. Ensure listener is started: `listener.getStatus().isRunning`
4. Check block number filtering (only processes new events)

### Missing Marketplace

1. Add marketplace contract to `marketplace-contracts.ts`
2. Add ABI fragments to `marketplace-event-listener.ts`
3. Implement event listener setup method
4. Update tests

### Performance Issues

1. Use WebSocket provider instead of HTTP for real-time events
2. Reduce number of marketplaces being monitored
3. Increase polling interval for HTTP providers
4. Consider running separate listeners per marketplace

## Contributing

When adding support for new marketplaces:

1. Add contract addresses to `marketplace-contracts.ts`
2. Add ABI fragments to `marketplace-event-listener.ts`
3. Implement setup method for marketplace events
4. Add tests for the new marketplace
5. Update this README with marketplace details
