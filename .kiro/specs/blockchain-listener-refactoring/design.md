# Design Document - Blockchain Listener Refactoring

## Overview

Refactoring ini bertujuan untuk mengubah dua file listener yang monolithic menjadi arsitektur modular yang lebih maintainable:
1. `activity-listener.ts` (4744 baris) - untuk launchpad contract events
2. `marketplace-event-listener.ts` (~600 baris) - untuk marketplace trading events

Struktur baru sudah partially implemented dengan services, utilities, dan config modules, namun belum fully integrated. Design ini akan menyelesaikan migrasi ke arsitektur baru tanpa mengubah fungsionalitas yang sudah ada, dan memastikan kedua listener menggunakan shared services yang sama.

### Goals
- Mengurangi ukuran `activity-listener.ts` dari 4744 baris menjadi maksimal 800 baris
- Refactor `marketplace-event-listener.ts` untuk menggunakan shared services
- Menghilangkan 20+ listener methods yang repetitif dengan generic approach
- Menyelesaikan implementasi `activity-listener-simplified.ts`
- Memastikan backward compatibility 100% untuk kedua listeners
- Meningkatkan testability dan maintainability
- Membuat shared services (ProviderService, ErrorTrackingService, EventListenerRegistry) yang digunakan oleh kedua listeners
- Memindahkan file backup dan dokumentasi lama ke folder `backup/` di root project

### Non-Goals
- Mengubah fungsionalitas existing
- Menambah fitur baru
- Mengubah database schema
- Mengubah event handler logic
- Menggabungkan activity listener dan marketplace listener menjadi satu file

## Architecture

### Current Architecture (Before Refactoring)
```
activity-listener.ts (4744 lines)
├── 50+ interfaces and types
├── Provider setup logic
├── Error tracking logic
├── 20+ repetitive listener methods
├── Validation logic scattered
└── Event handler calls
```

### Target Architecture (After Refactoring)
```
blockchain/
├── types/
│   └── activity-listener-types.ts
│       └── All interfaces and type definitions
│
├── config/
│   └── event-config.ts
│       ├── DEFAULT_EVENT_CONFIG
│       ├── initializeEnabledEvents()
│       └── getAlchemyNetwork()
│
├── utils/
│   └── validation-helpers.ts
│       ├── isValidTxHash()
│       ├── isValidAddress()
│       ├── validateEventData()
│       └── delay()
│
├── services/
│   ├── provider-service.ts
│   │   ├── Provider initialization (WebSocket/HTTP)
│   │   ├── Rate limiting
│   │   ├── Error handling
│   │   └── Connection testing
│   │
│   ├── error-tracking-service.ts
│   │   ├── Error counter management
│   │   ├── Admin alerts
│   │   ├── Error logging
│   │   └── Threshold monitoring
│   │
│   └── event-listener-registry.ts
│       ├── setupLaunchpadEventListeners()
│       ├── setupSimpleLaunchpadListener()
│       └── Generic listener registration
│
├── event-handlers/ (already exists)
│   ├── user-events.ts
│   ├── admin-events.ts
│   ├── metadata-events.ts
│   ├── security-events.ts
│   ├── nft-events.ts
│   └── marketplace-events.ts (already exists)
│
├── activity-listener.ts (simplified, ~600-800 lines)
│   ├── Constructor (initialize services)
│   ├── start() / stop()
│   ├── registerEventHandlers()
│   ├── recreateFilters()
│   └── Helper methods
│
└── marketplace-event-listener.ts (to be refactored, ~600 lines)
    ├── Constructor (use shared services)
    ├── start() / stop()
    ├── setupMarketplaceListeners()
    ├── Use MarketplaceEventHandler
    └── Support multiple marketplaces
```

## Components and Interfaces

### 1. ActivityListener (Main Class)

**Responsibilities:**
- Orchestrate all services
- Manage listener lifecycle (start/stop)
- Register event handlers
- Handle filter recreation

**Key Methods:**
```typescript
class ActivityListener {
  constructor(config: ActivityListenerConfig)
  async start(): Promise<void>
  async stop(): Promise<void>
  private async registerEventHandlers(): Promise<void>
  private async recreateFilters(): Promise<void>
  private isEventEnabled(eventName: string): boolean
  private async ensureLaunchpadRegistered(address: string): Promise<void>
  private async autoSyncLaunchpad(address: string): Promise<void>
  private async isDuplicateActivity(txHash: string, eventType: ActivityType, launchpadAddress?: string): Promise<boolean>
}
```

### 2. ProviderService

**Responsibilities:**
- Initialize and manage RPC providers (WebSocket/HTTP)
- Handle rate limiting and polling intervals
- Manage RPC error handling
- Test connections

**Interface:**
```typescript
class ProviderService {
  constructor(rpcUrl: string, chainId: number, launchpadCount: number)
  getProvider(): ethers.JsonRpcProvider | ethers.WebSocketProvider
  isWebSocket(): boolean
  getSetupDelay(launchpadCount: number): number
  async testConnection(timeoutMs?: number): Promise<void>
  async destroy(): Promise<void>
}
```

### 3. ErrorTrackingService

**Responsibilities:**
- Track error counts per event type
- Send admin alerts when threshold exceeded
- Log errors with severity levels
- Manage error counters

**Interface:**
```typescript
class ErrorTrackingService {
  constructor(chainId: number, errorThreshold: number)
  incrementErrorCounter(eventType: string): void
  async logEventError(eventType: string, error: any, eventData: any, severity?: ErrorSeverity): Promise<void>
  getErrorCounters(): Map<string, ErrorCounter>
}
```

### 4. EventListenerRegistry

**Responsibilities:**
- Setup event listeners for multiple contracts
- Apply rate limiting between setups
- Handle setup errors gracefully
- Provide generic listener registration

**Interface:**
```typescript
class EventListenerRegistry {
  constructor(chainId: number, setupDelay: number)
  async setupLaunchpadEventListeners<T>(
    eventName: string,
    contracts: Map<string, ethers.Contract>,
    filterFactory: (contract: ethers.Contract) => ethers.ContractEventName,
    handler: (address: string, currentBlock: number, ...args: [...T, ethers.EventLog]) => Promise<void>,
    currentBlock: number
  ): Promise<void>
  
  async setupSimpleLaunchpadListener(
    eventName: string,
    contracts: Map<string, ethers.Contract>,
    filterFactory: (contract: ethers.Contract) => ethers.ContractEventName,
    handler: (eventData: any) => Promise<void>,
    currentBlock: number,
    argsExtractor: (args: any[], address: string) => any
  ): Promise<void>
}
```

### 5. Event Handlers (Already Implemented)

Event handlers sudah ada dan tidak perlu diubah:
- `UserEventHandler` - mint, burn, airdrop, phase, reveal
- `AdminEventHandler` - treasury, withdrawal, ownership, fees, royalty
- `MetadataEventHandler` - baseURI, contractURI, externalLink
- `SecurityEventHandler` - pause, unpause, transfer lock, roles
- `NFTEventHandler` - NFT metadata dan spam detection
- `MarketplaceEventHandler` - sale, listing, offer, cancellation events

### 6. MarketplaceEventListener (To Be Refactored)

**Responsibilities:**
- Listen to marketplace trading events from multiple platforms
- Use shared services (ProviderService, ErrorTrackingService, EventListenerRegistry)
- Support selective marketplace monitoring
- Route events to MarketplaceEventHandler

**Key Methods:**
```typescript
class MarketplaceEventListener {
  constructor(config: MarketplaceEventListenerConfig)
  async start(): Promise<void>
  async stop(): Promise<void>
  private async setupMarketplaceListeners(): Promise<void>
  private async setupSeaportListeners(contract: ethers.Contract, config: MarketplaceContractConfig): Promise<void>
  private async setupBlurListeners(contract: ethers.Contract, config: MarketplaceContractConfig): Promise<void>
  private async setupLooksRareListeners(contract: ethers.Contract, config: MarketplaceContractConfig): Promise<void>
  private async setupMagicEdenListeners(contract: ethers.Contract, config: MarketplaceContractConfig): Promise<void>
  getStatus(): MarketplaceListenerStatus
}
```

**Supported Marketplaces:**
- **OpenSea Seaport** - OrderFulfilled, OrderCancelled
- **Blur** - OrdersMatched, OrderCancelled
- **LooksRare** - TakerAsk, TakerBid
- **Magic Eden** - BuyListingERC721, SellOfferERC721

## Data Models

### Configuration Types

```typescript
interface ActivityListenerConfig {
  chainId: number;
  rpcUrl: string;
  factoryAddress: string;
  launchpadAddresses?: string[];
  enabledEvents?: string[];
  errorThreshold?: number;
  retryAttempts?: number;
}

interface EventConfig {
  eventName: string;
  enabled: boolean;
  priority: 'high' | 'medium' | 'low';
  phase: 1 | 2 | 3 | 4;
}
```

### Error Tracking Types

```typescript
interface ErrorCounter {
  eventType: string;
  count: number;
  lastError: Date;
  threshold: number;
}

type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

interface ErrorLogData {
  eventType: string;
  eventData: any;
  error: any;
  severity: ErrorSeverity;
  timestamp: Date;
  chainId: number;
  txHash?: string;
  blockNumber?: number;
}
```

### Event Types

All event interfaces (CollectionCreatedEvent, MintEvent, BurnedEvent, dll) dipindahkan ke `types/activity-listener-types.ts`.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Event Handler Routing
*For any* blockchain event of a known type, the system should route it to the correct event handler based on its event type.
**Validates: Requirements 2.4**

### Property 2: Error Isolation
*For any* event processing error, the system should continue processing other events without crashing or stopping the listener.
**Validates: Requirements 2.5, 7.5**

### Property 3: Validation Error Messages
*For any* invalid input (address, txHash, event data), the validation function should throw an error with a descriptive message that includes the field name and invalid value.
**Validates: Requirements 4.5**

### Property 4: Error Counter Threshold Alert
*For any* event type, when the error counter reaches the configured threshold, the system should send an admin alert and reset the counter to zero.
**Validates: Requirements 6.2, 6.5**

### Property 5: Error Context Completeness
*For any* tracked error, the error log should include all required context fields: eventType, chainId, timestamp, severity, and error details.
**Validates: Requirements 6.3, 6.4**

### Property 6: Listener Setup Error Isolation
*For any* set of contracts, if listener setup fails for one contract, the system should continue setting up listeners for the remaining contracts.
**Validates: Requirements 7.3**

### Property 7: Block Number Filtering
*For any* blockchain event, if the event's block number is less than the current block at listener start time, the event should be ignored and not processed.
**Validates: Requirements 7.4**

### Property 8: Database Format Preservation
*For any* event type, the data saved to the database after refactoring should have the same structure and fields as before refactoring.
**Validates: Requirements 8.2**

### Property 9: Marketplace Event Routing
*For any* marketplace event (sale, listing, offer, cancellation), the system should route it to the correct MarketplaceEventHandler method based on event type.
**Validates: Requirements 11.4**

### Property 10: Marketplace Configuration Filtering
*For any* marketplace listener configuration, if a marketplace is not in the enabled list, the system should not initialize contracts or setup listeners for that marketplace.
**Validates: Requirements 13.1, 13.2, 13.3**

## Error Handling

### Error Categories

1. **RPC Errors**
   - Connection timeouts
   - Rate limiting
   - Filter expiration
   - Network issues
   - **Handling**: Log warning, continue operation, recreate filters if needed

2. **Validation Errors**
   - Invalid addresses
   - Invalid transaction hashes
   - Missing required fields
   - **Handling**: Throw descriptive error, log with medium severity, increment error counter

3. **Database Errors**
   - Connection failures
   - Write failures
   - Constraint violations
   - **Handling**: Retry with exponential backoff (up to 3 attempts), log with high severity

4. **Event Handler Errors**
   - Processing failures
   - Unexpected data formats
   - Business logic errors
   - **Handling**: Log error, increment counter, continue processing other events

5. **System Errors**
   - Out of memory
   - Unhandled exceptions
   - Service initialization failures
   - **Handling**: Log with critical severity, send admin alert, attempt graceful shutdown

### Error Recovery Strategies

1. **Retry with Exponential Backoff**
   - Used for: Database operations, RPC calls
   - Max retries: 3
   - Initial delay: 1000ms
   - Backoff multiplier: 2x

2. **Filter Recreation**
   - Triggered by: Filter expiration errors
   - Frequency: Every 4 minutes (preventive)
   - Action: Remove all listeners, re-register all event handlers

3. **Error Counter Reset**
   - Triggered by: Threshold exceeded
   - Action: Send admin alert, reset counter to 0
   - Purpose: Prevent alert spam

4. **Graceful Degradation**
   - If one event type fails repeatedly: Continue processing other events
   - If one contract fails: Continue monitoring other contracts
   - If RPC connection degrades: Increase polling interval

## Testing Strategy

### Unit Testing

Unit tests akan fokus pada individual components dan functions:

**ProviderService Tests:**
- Test WebSocket provider creation with ws:// URL
- Test HTTP provider creation with http:// URL
- Test polling interval calculation based on launchpad count
- Test error handler setup
- Test connection timeout handling

**ErrorTrackingService Tests:**
- Test error counter increment
- Test threshold alert triggering
- Test counter reset after alert
- Test error logging with different severity levels
- Test context data inclusion in error logs

**EventListenerRegistry Tests:**
- Test listener setup with rate limiting delays
- Test error handling during setup (one contract fails, others continue)
- Test block number filtering (events before current block ignored)
- Test event validation (invalid events rejected)

**Validation Helpers Tests:**
- Test isValidAddress() with valid and invalid addresses
- Test isValidTxHash() with valid and invalid hashes
- Test validateEventData() with missing fields
- Test validateEventData() with invalid field values
- Test error messages include field names and values

### Property-Based Testing

Property-based tests akan menggunakan **fast-check** library untuk TypeScript. Setiap test akan run minimal 100 iterations.

**Property Test 1: Event Handler Routing**
```typescript
// Feature: blockchain-listener-refactoring, Property 1: Event Handler Routing
fc.assert(
  fc.property(
    fc.constantFrom(...ALL_EVENT_TYPES),
    (eventType) => {
      const handler = getHandlerForEventType(eventType);
      return handler !== null && handler !== undefined;
    }
  ),
  { numRuns: 100 }
);
```

**Property Test 2: Error Isolation**
```typescript
// Feature: blockchain-listener-refactoring, Property 2: Error Isolation
fc.assert(
  fc.property(
    fc.array(fc.record({ eventType: fc.string(), shouldFail: fc.boolean() })),
    async (events) => {
      const results = await processEvents(events);
      // Even if some events fail, all should be attempted
      return results.length === events.length;
    }
  ),
  { numRuns: 100 }
);
```

**Property Test 3: Validation Error Messages**
```typescript
// Feature: blockchain-listener-refactoring, Property 3: Validation Error Messages
fc.assert(
  fc.property(
    fc.record({
      address: fc.string(),
      txHash: fc.string(),
      blockNumber: fc.integer()
    }),
    (invalidData) => {
      try {
        validateEventData(invalidData, ['address', 'txHash', 'blockNumber']);
        return false; // Should have thrown
      } catch (error) {
        const message = error.message;
        // Error message should include field name
        return message.includes('address') || message.includes('txHash') || message.includes('blockNumber');
      }
    }
  ),
  { numRuns: 100 }
);
```

**Property Test 4: Error Counter Threshold Alert**
```typescript
// Feature: blockchain-listener-refactoring, Property 4: Error Counter Threshold Alert
fc.assert(
  fc.property(
    fc.integer({ min: 1, max: 20 }),
    fc.string(),
    (threshold, eventType) => {
      const service = new ErrorTrackingService(1, threshold);
      let alertSent = false;
      
      // Mock alert function
      service['sendAdminAlert'] = () => { alertSent = true; };
      
      // Increment to threshold
      for (let i = 0; i < threshold; i++) {
        service.incrementErrorCounter(eventType);
      }
      
      const counter = service.getErrorCounters().get(eventType);
      return alertSent && counter.count === 0; // Alert sent and counter reset
    }
  ),
  { numRuns: 100 }
);
```

**Property Test 5: Error Context Completeness**
```typescript
// Feature: blockchain-listener-refactoring, Property 5: Error Context Completeness
fc.assert(
  fc.property(
    fc.string(),
    fc.record({ txHash: fc.string(), blockNumber: fc.integer() }),
    fc.constantFrom('low', 'medium', 'high', 'critical'),
    async (eventType, eventData, severity) => {
      const service = new ErrorTrackingService(1, 10);
      const logs: any[] = [];
      
      // Mock logger
      global.mockLogger = (data: any) => logs.push(data);
      
      await service.logEventError(eventType, new Error('test'), eventData, severity);
      
      const log = logs[0];
      return log.eventType && log.chainId && log.timestamp && log.severity && log.error;
    }
  ),
  { numRuns: 100 }
);
```

**Property Test 6: Listener Setup Error Isolation**
```typescript
// Feature: blockchain-listener-refactoring, Property 6: Listener Setup Error Isolation
fc.assert(
  fc.property(
    fc.array(fc.record({ address: fc.string(), shouldFail: fc.boolean() }), { minLength: 2, maxLength: 10 }),
    async (contracts) => {
      const setupResults = await setupListenersForContracts(contracts);
      const successCount = setupResults.filter(r => r.success).length;
      const expectedSuccess = contracts.filter(c => !c.shouldFail).length;
      
      // All non-failing contracts should succeed
      return successCount === expectedSuccess;
    }
  ),
  { numRuns: 100 }
);
```

**Property Test 7: Block Number Filtering**
```typescript
// Feature: blockchain-listener-refactoring, Property 7: Block Number Filtering
fc.assert(
  fc.property(
    fc.integer({ min: 1000, max: 2000 }),
    fc.array(fc.integer({ min: 900, max: 2100 })),
    (currentBlock, eventBlocks) => {
      const processedEvents = eventBlocks.filter(block => shouldProcessEvent(block, currentBlock));
      const expectedEvents = eventBlocks.filter(block => block >= currentBlock);
      
      return processedEvents.length === expectedEvents.length;
    }
  ),
  { numRuns: 100 }
);
```

**Property Test 8: Database Format Preservation**
```typescript
// Feature: blockchain-listener-refactoring, Property 8: Database Format Preservation
fc.assert(
  fc.property(
    fc.constantFrom(...ALL_EVENT_TYPES),
    fc.record({ /* event data fields */ }),
    async (eventType, eventData) => {
      const oldFormat = await processEventOldWay(eventType, eventData);
      const newFormat = await processEventNewWay(eventType, eventData);
      
      // Compare all fields
      return JSON.stringify(oldFormat) === JSON.stringify(newFormat);
    }
  ),
  { numRuns: 100 }
);
```

### Integration Testing

Integration tests akan memverifikasi bahwa semua components bekerja bersama dengan benar:

- Test full listener lifecycle (start → process events → stop)
- Test event processing end-to-end dengan mock blockchain
- Test error handling across service boundaries
- Test filter recreation mechanism
- Test multi-contract listener setup

### Backward Compatibility Testing

Specific tests untuk memastikan tidak ada breaking changes:

**Activity Listener:**
- Test all 24 launchpad event types masih berfungsi
- Test database writes menghasilkan format yang sama
- Test error handling behavior sama
- Test filter recreation timing sama
- Test cleanup behavior sama

**Marketplace Listener:**
- Test all 4 marketplace types (OpenSea, Blur, LooksRare, Magic Eden) masih berfungsi
- Test sale, listing, offer, cancellation events masih berfungsi
- Test database writes untuk marketplace events menghasilkan format yang sama
- Test marketplace configuration filtering works correctly
- Test cleanup behavior sama

**Shared Services:**
- Test ProviderService works for both listeners
- Test ErrorTrackingService tracks errors from both listeners separately
- Test EventListenerRegistry can handle both launchpad and marketplace events

## Migration Plan

### Phase 1: Complete Service Implementation
1. Finish implementing missing methods in `activity-listener-simplified.ts`:
   - `ensureLaunchpadRegistered()`
   - `autoSyncLaunchpad()`
   - `registerEventHandlers()`
   - `recreateFilters()`
   - `isDuplicateActivity()`

2. Add missing helper methods for event processing

3. Fix all TypeScript compilation errors

### Phase 2: Refactor Event Registration
1. Create generic event registration methods
2. Replace 20+ individual `listenToXXX()` methods with configuration-driven approach
3. Use `EventListenerRegistry.setupLaunchpadEventListeners()` for all events

### Phase 3: Testing
1. Write unit tests for all services
2. Write property-based tests for correctness properties
3. Run integration tests
4. Run backward compatibility tests

### Phase 4: Migration
1. Backup current `activity-listener.ts` (already exists as `.backup`)
2. Replace with simplified version
3. Update imports in dependent files
4. Test in development environment

### Phase 5: Refactor Marketplace Listener
1. Update `marketplace-event-listener.ts` to use shared services
2. Use ProviderService for provider management
3. Use ErrorTrackingService for error tracking
4. Use EventListenerRegistry for listener setup
5. Test all marketplace types

### Phase 6: Cleanup and Backup
1. Create `backup/` folder in root project
2. Create `backup/docs/` subfolder
3. Move `activity-listener.ts.backup` to `backup/`
4. Move old refactoring docs to `backup/docs/`:
   - REFACTORING_SUMMARY.md
   - REFACTORING_COMPLETE_PHASE1.md
   - CLEAN_CODE_REFACTORING_DONE.md
   - REFACTORING_QUICK_GUIDE.md
   - MINT_BATCH_FIX.md
   - BATCH_MINT_GUARANTEE.md
5. Update documentation (ARCHITECTURE.md, README.md, REFACTORING_GUIDE.md)
6. Verify no temporary files remain in src/lib/blockchain

## Performance Considerations

### Rate Limiting
- HTTP providers: 400-1000ms delay between listener setups (based on launchpad count)
- WebSocket providers: 100ms delay
- Polling intervals: 10-20 seconds (based on launchpad count)

### Concurrent Processing
- Max concurrent mint processing: 10
- Queue-based processing for large batches
- Prevents memory issues with large airdrops

### Filter Recreation
- Preventive recreation every 4 minutes
- Prevents filter expiration on HTTP providers
- Only for HTTP providers (WebSocket doesn't need this)

### Database Optimization
- Retry logic with exponential backoff
- Duplicate detection before writes
- Connection pooling via Prisma

## Monitoring and Observability

### Metrics to Track
- Events processed per second (by type)
- Error rate per event type
- RPC response time
- Database write latency
- Filter expiration rate
- Active listeners count

### Logging Levels
- **DEBUG**: Detailed event processing
- **INFO**: Normal operations (listener started, event processed)
- **WARN**: Non-critical issues (filter expired, retry attempt)
- **ERROR**: Processing errors (validation failed, handler error)
- **CRITICAL**: System failures (threshold exceeded, connection lost)

### Alerts
- Error threshold exceeded for any event type
- RPC connection lost
- Database connection issues
- Filter recreation failures
- Memory usage high

## Rollback Plan

If issues are discovered after deployment:

1. **Immediate Rollback**
   - Restore files from `backup/` folder:
     - `backup/activity-listener.ts.backup` → `src/lib/blockchain/activity-listener.ts`
     - `backup/marketplace-event-listener.ts.backup` → `src/lib/blockchain/marketplace-event-listener.ts` (if exists)
   - Restart services
   - Monitor for stability

2. **Investigation**
   - Review error logs
   - Identify root cause
   - Fix issues in refactored version

3. **Re-deployment**
   - Test fixes thoroughly
   - Deploy again with monitoring
   - Gradual rollout (one chain at a time)

4. **Backup Retention**
   - Keep backup files for at least 30 days after successful deployment
   - Document any issues found and fixes applied
   - Update refactoring guide with lessons learned

## Success Criteria

Refactoring is considered successful when:

1. ✅ File `activity-listener.ts` has ≤ 800 lines
2. ✅ File `marketplace-event-listener.ts` has ≤ 600 lines
3. ✅ All 24 launchpad event types function correctly
4. ✅ All 4 marketplace types (OpenSea, Blur, LooksRare, Magic Eden) function correctly
5. ✅ All tests pass (unit, property-based, integration)
6. ✅ No increase in error rates
7. ✅ No performance degradation
8. ✅ Code duplication < 5%
9. ✅ Cyclomatic complexity ≤ 10 per method
10. ✅ Documentation updated
11. ✅ No backup or temporary files remain
12. ✅ Team can easily understand and maintain new structure
13. ✅ Both listeners use shared services (ProviderService, ErrorTrackingService, EventListenerRegistry)
