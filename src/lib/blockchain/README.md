# Blockchain Module - Clean Architecture

## 📁 Struktur Folder

```
blockchain/
├── config/                      # Konfigurasi dan constants
│   ├── event-config.ts         # Event configuration & priorities
│   └── index.ts                # Exports
│
├── types/                       # Type definitions
│   ├── activity-listener-types.ts  # Interfaces untuk events & config
│   └── index.ts                # Exports
│
├── utils/                       # Utility functions
│   ├── validation-helpers.ts   # Validation & helper functions
│   └── index.ts                # Exports
│
├── services/                    # Business logic services
│   ├── provider-service.ts     # RPC provider management
│   ├── error-tracking-service.ts  # Error tracking & alerts
│   ├── event-listener-registry.ts # Generic event listener setup
│   └── index.ts                # Exports
│
├── event-handlers/              # Event processing handlers
│   ├── base-handler.ts         # Base class dengan shared logic
│   ├── user-events.ts          # User-facing events (mint, burn, etc)
│   ├── admin-events.ts         # Admin events (treasury, fees, etc)
│   ├── metadata-events.ts      # Metadata events (URI updates)
│   ├── security-events.ts      # Security events (pause, roles)
│   ├── nft-events.ts           # NFT metadata & spam detection
│   ├── marketplace-events.ts   # Marketplace events
│   └── index.ts                # Exports
│
├── activity-listener.ts         # Launchpad event listener (refactored)
├── marketplace-event-listener.ts # Marketplace event listener (refactored)
├── multi-chain-listener-manager.ts  # Multi-chain orchestration
├── historical-sync.ts           # Historical event scanning
├── nft-event-listener.ts        # NFT-specific listener
│
├── ARCHITECTURE.md              # Architecture documentation
├── REFACTORING_GUIDE.md        # Panduan refactoring
└── README.md                    # Dokumentasi ini
```

## 🎯 Overview

This module contains two main event listeners that share common services:

### Activity Listener
Monitors launchpad smart contract events (mint, burn, transfer, etc.) from factory-deployed contracts.
- 24 different event types
- Auto-discovery of new launchpad contracts
- Historical sync capabilities

### Marketplace Listener
Monitors trading events from multiple marketplace platforms.
- OpenSea Seaport (OrderFulfilled, OrderCancelled)
- Blur (OrdersMatched, OrderCancelled)
- LooksRare (TakerAsk, TakerBid)
- Magic Eden (BuyListingERC721, SellOfferERC721)

### Shared Services
Both listeners use the same services for consistency:
- **ProviderService**: RPC connection management
- **ErrorTrackingService**: Error monitoring & alerting
- **EventListenerRegistry**: Generic event listener setup

## 🎯 Prinsip Clean Code yang Diterapkan

### 1. **Separation of Concerns**
- **Config**: Semua konfigurasi di satu tempat
- **Types**: Type definitions terpisah dari implementasi
- **Utils**: Helper functions yang reusable
- **Services**: Business logic yang modular dan **shared** oleh kedua listeners
- **Handlers**: Event processing logic

### 2. **Single Responsibility Principle**
Setiap file/class memiliki satu tanggung jawab:
- `ProviderService`: Hanya mengelola RPC connections (shared)
- `ErrorTrackingService`: Hanya mengelola error tracking (shared)
- `EventListenerRegistry`: Hanya setup event listeners (shared)
- `UserEventHandler`: Hanya handle user events
- `MarketplaceEventHandler`: Hanya handle marketplace events

### 3. **DRY (Don't Repeat Yourself)**
- Generic listener setup mengurangi 20+ method repetitif
- Base handler class untuk shared functionality
- Validation helpers untuk reusable validations

### 4. **Dependency Injection**
Services menerima dependencies melalui constructor:
```typescript
const errorService = new ErrorTrackingService(chainId, errorThreshold);
const providerService = new ProviderService(rpcUrl, chainId, launchpadCount);
```

### 5. **Type Safety**
Semua types didefinisikan dengan jelas di `types/` folder

## 📦 Cara Menggunakan

### Activity Listener Usage
```typescript
import { ActivityListener } from './activity-listener';

const listener = new ActivityListener({
  chainId: 1,
  rpcUrl: 'wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  factoryAddress: '0x...',
  enabledEvents: ['Minted', 'Burned', 'Transfer'],
  errorThreshold: 10
});

await listener.start();
```

### Marketplace Listener Usage
```typescript
import { MarketplaceEventListener } from './marketplace-event-listener';

const listener = new MarketplaceEventListener({
  chainId: 1,
  rpcUrl: 'wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
  enabledMarketplaces: ['opensea', 'blur', 'looksrare']
});

await listener.start();
```

### Import Shared Services
```typescript
import { ProviderService, ErrorTrackingService, EventListenerRegistry } from './services';
import { validateEventData, delay } from './utils';
import { DEFAULT_EVENT_CONFIG, initializeEnabledEvents } from './config';
import type { ActivityListenerConfig, MintEvent } from './types';
```

### Import Event Handlers
```typescript
import { 
  UserEventHandler, 
  AdminEventHandler, 
  MetadataEventHandler,
  SecurityEventHandler,
  NFTEventHandler,
  MarketplaceEventHandler
} from './event-handlers';
```

## 🔧 Maintenance Guide

### Menambah Event Baru

1. **Tambah Type** di `types/activity-listener-types.ts`:
```typescript
export interface NewEvent {
  field1: string;
  field2: bigint;
  txHash: string;
  blockNumber: number;
  launchpadAddress: string;
}
```

2. **Tambah Config** di `config/event-config.ts`:
```typescript
{ eventName: 'NewEvent', enabled: true, priority: 'high', phase: 1 }
```

3. **Tambah Handler** di event-handlers yang sesuai:
```typescript
async handleNewEvent(event: NewEvent): Promise<void> {
  // Implementation
}
```

4. **Register** di `activity-listener.ts`:
```typescript
if (this.isEventEnabled('NewEvent')) {
  await this.listenToNewEvents();
}
```

### Menambah Validation Baru

Tambahkan di `utils/validation-helpers.ts`:
```typescript
export function validateNewField(field: string): boolean {
  // Validation logic
}
```

### Menambah Service Baru

1. Buat file di `services/new-service.ts`
2. Export di `services/index.ts`
3. Gunakan di `activity-listener.ts`

## 🧪 Testing

### Unit Tests
Test individual services:
```typescript
// services/provider-service.test.ts
// services/error-tracking-service.test.ts
// utils/validation-helpers.test.ts
```

### Integration Tests
Test event handlers:
```typescript
// event-handlers/__tests__/user-events.test.ts
// event-handlers/__tests__/admin-events.test.ts
```

## 📊 Metrics

### Before Refactoring
- **activity-listener.ts**: 4744 lines
- **marketplace-event-listener.ts**: ~600 lines (with duplicated logic)
- **Cyclomatic Complexity**: High
- **Code Duplication**: ~60% (between listeners)
- **Maintainability**: Low

### After Refactoring
- **activity-listener.ts**: ~600-800 lines
- **marketplace-event-listener.ts**: ~600 lines
- **Shared Services**: ~800 lines (reused by both)
- **Total Lines** (all files): ~3000 lines
- **Cyclomatic Complexity**: Low-Medium
- **Code Duplication**: <5%
- **Maintainability**: High

## 🔄 Migration Notes

### From Old to New Architecture

**Activity Listener:**
- Old file backed up to `backup/activity-listener.ts.backup`
- New implementation uses shared services
- All 24 event types remain functional
- Database format unchanged (backward compatible)

**Marketplace Listener:**
- Refactored to use shared services (ProviderService, ErrorTrackingService, EventListenerRegistry)
- All 4 marketplace types remain functional
- Configurable marketplace selection
- Database format unchanged (backward compatible)

**Shared Services:**
- ProviderService handles all RPC connections
- ErrorTrackingService provides centralized error monitoring
- EventListenerRegistry provides generic listener setup
- Both listeners benefit from improvements to shared services

## 🚀 Performance

### Optimizations
- Rate limiting untuk HTTP providers
- Concurrent processing control untuk batch mints
- Filter recreation untuk prevent expiration
- Database retry logic dengan exponential backoff
- Error threshold monitoring

### Monitoring
- RPC error tracking
- Event processing metrics
- Database operation metrics
- Admin alerts untuk critical errors

## 📚 Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture overview and design patterns
- [REFACTORING_GUIDE.md](./REFACTORING_GUIDE.md) - Detailed refactoring guide
- [event-handlers/README.md](./event-handlers/README.md) - Event handlers documentation
- [MARKETPLACE_EVENT_LISTENER_README.md](./MARKETPLACE_EVENT_LISTENER_README.md) - Marketplace listener docs
- [Spec Documentation](../../../.kiro/specs/blockchain-listener-refactoring/) - Requirements, design, and tasks

## 🤝 Contributing

Saat menambah fitur baru:
1. Ikuti struktur folder yang ada
2. Gunakan TypeScript dengan strict mode
3. Tambahkan JSDoc comments
4. Write unit tests
5. Update dokumentasi
6. Follow clean code principles

## 📝 Notes

- Semua event handlers extend dari `BaseEventHandler`
- Gunakan `ErrorTrackingService` untuk error logging
- Gunakan `ProviderService` untuk RPC operations
- Gunakan `EventListenerRegistry` untuk setup listeners
- Semua validations ada di `utils/validation-helpers.ts`
