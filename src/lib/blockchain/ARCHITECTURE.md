# Architecture Overview - Blockchain Module

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Multi-Chain Listener Manager                 │
│                  (Orchestrates multiple chains)                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─── Chain 1 (Ethereum)
                         ├─── Chain 2 (Polygon)
                         └─── Chain N (Base, etc)
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌──────────────────────┐      ┌──────────────────────┐
│  Activity Listener   │      │ Marketplace Listener │
│  (Launchpad Events)  │      │  (Trading Events)    │
└──────────────────────┘      └──────────────────────┘
         │                               │
         └───────────────┬───────────────┘
                         │
         ┌───────────────┴───────────────┐
         │    Shared Services Layer      │
         ├───────────────────────────────┤
         │  Provider  │  Error   │ Event │
         │  Service   │ Tracking │ Reg.  │
         └───────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌────────────────────┐      ┌────────────────────┐
│  Event Handlers    │      │  Marketplace       │
│  (User, Admin,     │      │  Event Handler     │
│   Metadata, etc)   │      │  (Sales, Listings) │
└────────────────────┘      └────────────────────┘
         │                               │
         └───────────────┬───────────────┘
                         ▼
         ┌────────────────────────────────────────┐
         │            Database Layer              │
         │         (Prisma + PostgreSQL)          │
         └────────────────────────────────────────┘
```

## 🎯 Listener Components

### Activity Listener
Monitors launchpad smart contract events (mint, burn, transfer, etc.) from factory-deployed contracts.

**Key Features:**
- Auto-discovery of new launchpad contracts via factory events
- 24 different event types (user, admin, metadata, security, NFT)
- Duplicate detection and prevention
- Historical sync capabilities

### Marketplace Listener
Monitors trading events from multiple marketplace platforms.

**Supported Marketplaces:**
- **OpenSea Seaport** - OrderFulfilled, OrderCancelled
- **Blur** - OrdersMatched, OrderCancelled
- **LooksRare** - TakerAsk, TakerBid
- **Magic Eden** - BuyListingERC721, SellOfferERC721

**Key Features:**
- Configurable marketplace selection
- Unified event handling via MarketplaceEventHandler
- Support for multiple marketplace protocols
- Sale, listing, offer, and cancellation tracking

## 🔧 Shared Services

Both listeners use the same shared services for consistency and code reuse:

### 1. Provider Service
- Manages RPC connections (WebSocket/HTTP)
- Handles rate limiting and polling intervals
- Connection testing and error handling
- Automatic provider type detection

### 2. Error Tracking Service
- Centralized error monitoring
- Error counter management per event type
- Admin alerts when thresholds exceeded
- Severity-based logging (low, medium, high, critical)

### 3. Event Listener Registry
- Generic listener setup for multiple contracts
- Rate limiting between setups
- Error isolation (one contract failure doesn't stop others)
- Block number filtering (only process new events)

## 🔄 Data Flow

### 1. Event Detection Flow (Activity Listener)
```
Blockchain Event
      │
      ▼
Provider Service (WebSocket/HTTP)
      │
      ▼
Event Listener Registry
      │
      ▼
Event Validation (utils/validation-helpers)
      │
      ▼
Event Handler (user/admin/metadata/security)
      │
      ▼
Database Write (with retry logic)
      │
      ▼
Activity Recorded ✅
```

### 2. Error Handling Flow
```
Error Occurs
      │
      ▼
Error Tracking Service
      │
      ├─── Increment Counter
      │
      ├─── Check Threshold
      │
      └─── If Exceeded
            │
            ▼
      Send Admin Alert 🚨
            │
            ▼
      Log to Error Logger
            │
            ▼
      Reset Counter
```

### 3. Provider Connection Flow
```
Initialize Provider Service
      │
      ├─── WebSocket? ──Yes──▶ WebSocketProvider
      │                              │
      └─── HTTP? ──Yes──▶ JsonRpcProvider
                              │
                              ├─── Set Polling Interval
                              │    (based on launchpad count)
                              │
                              ├─── Setup Error Handler
                              │
                              └─── Test Connection
                                        │
                                        ▼
                                  Ready to Listen ✅
```

### 4. Marketplace Event Flow
```
Marketplace Event (Sale/Listing/Offer)
      │
      ▼
Provider Service (Shared)
      │
      ▼
Event Listener Registry (Shared)
      │
      ▼
Marketplace Event Handler
      │
      ├─── Extract Sale Data
      │
      ├─── Validate Event Data
      │
      ├─── Determine Marketplace Type
      │
      └─── Write to Database
            │
            ▼
      Trading Activity Recorded ✅
```

## 📦 Module Dependencies

```
blockchain/
├── activity-listener.ts
│   ├── services/ (shared)
│   ├── event-handlers/
│   ├── config/
│   ├── types/
│   └── utils/
│
├── marketplace-event-listener.ts
│   ├── services/ (shared)
│   ├── event-handlers/marketplace-events.ts
│   └── config/marketplace-contracts.ts
│
├── services/ (SHARED BY BOTH LISTENERS)
│   ├── provider-service.ts
│   │   └── ethers
│   ├── error-tracking-service.ts
│   │   └── utils/error-logger
│   └── event-listener-registry.ts
│       └── utils/validation-helpers
│
├── event-handlers/
│   ├── base-handler.ts
│   │   └── config/database (prisma)
│   ├── user-events.ts
│   │   └── base-handler.ts
│   ├── admin-events.ts
│   │   └── base-handler.ts
│   ├── metadata-events.ts
│   │   └── base-handler.ts
│   ├── security-events.ts
│   │   └── base-handler.ts
│   ├── nft-events.ts
│   │   ├── base-handler.ts
│   │   ├── alchemy-nft-service.ts
│   │   └── alchemy-spam-detector.ts
│   └── marketplace-events.ts
│       ├── base-handler.ts
│       └── config/marketplace-contracts.ts
│
├── config/
│   ├── event-config.ts
│   └── marketplace-contracts.ts
│
├── types/
│   └── activity-listener-types.ts
│
└── utils/
    └── validation-helpers.ts
```

## 🎭 Design Patterns Used

### 1. **Service Layer Pattern**
Memisahkan business logic ke dalam services yang independen dan **shared** oleh kedua listeners:
- `ProviderService`: RPC connection management (shared)
- `ErrorTrackingService`: Error monitoring & alerting (shared)
- `EventListenerRegistry`: Event listener setup (shared)

**Benefits:**
- Code reuse between activity and marketplace listeners
- Consistent behavior across all listeners
- Easier testing and maintenance
- Single source of truth for common functionality

### 2. **Strategy Pattern**
Event handlers menggunakan strategy pattern untuk handle berbagai jenis events:
```typescript
interface EventHandler {
  handleEvent(event: any): Promise<void>;
}

class UserEventHandler implements EventHandler { }
class AdminEventHandler implements EventHandler { }
```

### 3. **Template Method Pattern**
`BaseEventHandler` menyediakan template methods yang di-override oleh subclasses:
```typescript
abstract class BaseEventHandler {
  protected abstract handleSpecificEvent(event: any): Promise<void>;
  
  async handleEvent(event: any): Promise<void> {
    this.validateEventData(event);
    await this.handleSpecificEvent(event);
    await this.writeActivityWithRetry(data);
  }
}
```

### 4. **Factory Pattern**
`EventListenerRegistry` menggunakan factory pattern untuk create listeners:
```typescript
setupLaunchpadEventListeners(
  eventName,
  filterFactory, // Factory function
  handler
)
```

### 5. **Dependency Injection**
Services menerima dependencies melalui constructor:
```typescript
constructor(
  private providerService: ProviderService,
  private errorService: ErrorTrackingService
) { }
```

### 6. **Observer Pattern**
Event listeners menggunakan observer pattern untuk monitor blockchain events:
```typescript
contract.on(filter, async (...args) => {
  await handler(...args);
});
```

## 🔐 Security Considerations

### 1. **Input Validation**
- Semua event data divalidasi sebelum processing
- Address validation (format 0x + 40 hex chars)
- Transaction hash validation (format 0x + 64 hex chars)
- Block number validation (positive integer)

### 2. **Error Handling**
- Try-catch blocks di semua async operations
- Error logging dengan severity levels
- Admin alerts untuk critical errors
- Graceful degradation (continue processing other events)

### 3. **Rate Limiting**
- Delay between listener setups
- Polling interval adjustment based on load
- Filter recreation to prevent expiration

### 4. **Database Safety**
- Retry logic dengan exponential backoff
- Duplicate detection (deduplication)
- Transaction isolation

## 📊 Performance Optimizations

### 1. **Concurrent Processing Control**
```typescript
private activeMintProcessing: number = 0;
private readonly MAX_CONCURRENT_MINTS: number = 10;
private mintQueue: Array<() => Promise<void>> = [];
```

### 2. **Rate Limiting**
```typescript
// Adjust polling based on launchpad count
if (launchpadCount > 15) {
  pollingInterval = 20000; // 20s
} else if (launchpadCount > 10) {
  pollingInterval = 15000; // 15s
} else {
  pollingInterval = 10000; // 10s
}
```

### 3. **Filter Recreation**
```typescript
// Recreate filters every 4 minutes to prevent expiration
setInterval(async () => {
  await this.recreateFilters();
}, 240000);
```

### 4. **Database Optimization**
- Batch operations where possible
- Index on frequently queried fields
- Connection pooling via Prisma

## 🧪 Testing Strategy

### Unit Tests
```
services/
├── provider-service.test.ts
├── error-tracking-service.test.ts
└── event-listener-registry.test.ts

utils/
└── validation-helpers.test.ts

event-handlers/
├── user-events.test.ts
├── admin-events.test.ts
├── metadata-events.test.ts
├── security-events.test.ts
├── nft-events.test.ts
└── marketplace-events.test.ts
```

### Integration Tests
```
activity-listener.integration.test.ts
marketplace-listener.integration.test.ts
multi-chain-listener-manager.integration.test.ts
```

### E2E Tests
```
blockchain-events.e2e.test.ts
```

## 📈 Monitoring & Observability

### Metrics to Track
- Events processed per second
- Error rate per event type
- RPC response time
- Database write latency
- Filter expiration rate
- Memory usage
- Active listeners count

### Logging Levels
- **DEBUG**: Detailed event processing info
- **INFO**: Normal operations (event received, processed)
- **WARN**: Non-critical issues (filter expired, retry attempt)
- **ERROR**: Processing errors (validation failed, DB error)
- **CRITICAL**: System failures (threshold exceeded, connection lost)

### Alerts
- Error threshold exceeded (🚨 Admin Alert)
- RPC connection lost
- Database connection issues
- High memory usage
- Processing lag

## 🔄 Scalability

### Horizontal Scaling
- Multiple instances can run in parallel
- Each instance handles different chains
- Load balancing via MultiChainListenerManager

### Vertical Scaling
- Adjust MAX_CONCURRENT_MINTS based on resources
- Tune polling intervals
- Optimize database queries

### Future Improvements
- [ ] Redis cache for duplicate detection
- [ ] Message queue for event processing (RabbitMQ/Kafka)
- [ ] Distributed tracing (OpenTelemetry)
- [ ] Metrics dashboard (Grafana)
- [ ] Auto-scaling based on load
