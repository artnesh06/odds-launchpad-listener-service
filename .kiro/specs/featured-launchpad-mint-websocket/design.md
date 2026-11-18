# Design Document: Featured Launchpad Mint WebSocket

## Overview

This design implements a hybrid event monitoring system that combines WebSocket-based real-time listening for mint events on featured launchpads with the existing polling mechanism for all other events. The system uses ethers.js `contract.on()` for WebSocket connections and maintains backward compatibility with the current polling infrastructure.

The key architectural principle is selective real-time monitoring: only mint events on featured launchpads receive WebSocket treatment, optimizing resource usage while providing immediate notifications where they matter most.

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Event Listener System                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │  WebSocket       │         │   Polling        │          │
│  │  Manager         │         │   Manager        │          │
│  │                  │         │                  │          │
│  │ - Featured       │         │ - All non-mint   │          │
│  │   Launchpads     │         │   events         │          │
│  │ - Mint events    │         │ - Non-featured   │          │
│  │   only           │         │   launchpads     │          │
│  └────────┬─────────┘         └────────┬─────────┘          │
│           │                            │                     │
│           └────────────┬───────────────┘                     │
│                        │                                     │
│                 ┌──────▼──────┐                              │
│                 │   Event     │                              │
│                 │  Processor  │                              │
│                 │             │                              │
│                 │ - Dedup     │                              │
│                 │ - Handler   │                              │
│                 │   Routing   │                              │
│                 └──────┬──────┘                              │
│                        │                                     │
└────────────────────────┼─────────────────────────────────────┘
                         │
                  ┌──────▼──────┐
                  │  Database   │
                  │  (Prisma)   │
                  └─────────────┘
```

### Component Interaction Flow

1. **Initialization**: System queries database for featured launchpads
2. **WebSocket Setup**: Establishes `contract.on('Mint', ...)` for each featured launchpad
3. **Polling Continuation**: Existing polling continues for all other events
4. **Event Reception**: Events arrive via WebSocket (mint) or polling (others)
5. **Deduplication**: Event processor checks for duplicates using tx hash + log index
6. **Handler Routing**: Events routed to appropriate handlers
7. **Database Update**: Processed events stored in database

## Components and Interfaces

### 1. Database Schema Extension

**Prisma Schema Addition:**

```prisma
model Launchpad {
  id          String   @id @default(cuid())
  address     String   @unique
  name        String
  isFeatured  Boolean  @default(false)
  // ... existing fields
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

**Migration:**
- Add `isFeatured` column with default value `false`
- Create index on `isFeatured` for efficient querying

### 2. WebSocket Manager

**Purpose:** Manages WebSocket connections for featured launchpads

**Interface:**

```typescript
interface WebSocketManager {
  // Initialize WebSocket connections for all featured launchpads
  initialize(): Promise<void>;
  
  // Add WebSocket listener for a specific launchpad
  addListener(launchpadAddress: string): Promise<void>;
  
  // Remove WebSocket listener for a specific launchpad
  removeListener(launchpadAddress: string): Promise<void>;
  
  // Get connection status for a launchpad
  getConnectionStatus(launchpadAddress: string): ConnectionStatus;
  
  // Gracefully shutdown all connections
  shutdown(): Promise<void>;
}

interface ConnectionStatus {
  isConnected: boolean;
  launchpadAddress: string;
  connectedAt?: Date;
  lastError?: Error;
  reconnectAttempts: number;
}
```

**Implementation Details:**

```typescript
class WebSocketManager {
  private connections: Map<string, ContractConnection>;
  private provider: ethers.providers.WebSocketProvider;
  private eventProcessor: EventProcessor;
  
  async initialize() {
    // 1. Query database for featured launchpads
    const featuredLaunchpads = await prisma.launchpad.findMany({
      where: { isFeatured: true }
    });
    
    // 2. Establish WebSocket connection for each
    for (const launchpad of featuredLaunchpads) {
      await this.addListener(launchpad.address);
    }
  }
  
  async addListener(launchpadAddress: string) {
    // 1. Create contract instance
    const contract = new ethers.Contract(
      launchpadAddress,
      LAUNCHPAD_ABI,
      this.provider
    );
    
    // 2. Register Mint event listener
    const listener = (from, tokenId, event) => {
      this.eventProcessor.processMintEvent({
        from,
        tokenId,
        transactionHash: event.transactionHash,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        launchpadAddress,
        source: 'websocket'
      });
    };
    
    contract.on('Mint', listener);
    
    // 3. Store connection reference
    this.connections.set(launchpadAddress, {
      contract,
      listener,
      connectedAt: new Date(),
      reconnectAttempts: 0
    });
    
    // 4. Setup error handling
    this.setupErrorHandling(launchpadAddress, contract);
  }
  
  private setupErrorHandling(address: string, contract: ethers.Contract) {
    contract.provider.on('error', async (error) => {
      logger.error(`WebSocket error for ${address}:`, error);
      await this.handleReconnection(address);
    });
  }
  
  private async handleReconnection(address: string) {
    const connection = this.connections.get(address);
    if (!connection) return;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
    const delay = Math.min(
      1000 * Math.pow(2, connection.reconnectAttempts),
      30000
    );
    
    connection.reconnectAttempts++;
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      await this.removeListener(address);
      await this.addListener(address);
      connection.reconnectAttempts = 0;
    } catch (error) {
      logger.error(`Reconnection failed for ${address}:`, error);
    }
  }
}
```

### 3. Event Processor

**Purpose:** Processes events from both WebSocket and polling sources with deduplication

**Interface:**

```typescript
interface EventProcessor {
  // Process a mint event from any source
  processMintEvent(event: MintEventData): Promise<void>;
  
  // Check if event has already been processed
  isEventProcessed(txHash: string, logIndex: number): Promise<boolean>;
  
  // Mark event as processed
  markEventProcessed(txHash: string, logIndex: number): Promise<void>;
}

interface MintEventData {
  from: string;
  tokenId: string;
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
  launchpadAddress: string;
  source: 'websocket' | 'polling';
}
```

**Implementation Details:**

```typescript
class EventProcessor {
  private processedEvents: Set<string>; // In-memory cache
  private readonly CACHE_SIZE = 10000;
  
  async processMintEvent(event: MintEventData) {
    // 1. Create unique event identifier
    const eventId = `${event.transactionHash}-${event.logIndex}`;
    
    // 2. Check if already processed
    if (await this.isEventProcessed(event.transactionHash, event.logIndex)) {
      logger.debug(`Skipping duplicate event: ${eventId}`);
      return;
    }
    
    // 3. Mark as processed
    await this.markEventProcessed(event.transactionHash, event.logIndex);
    
    // 4. Route to existing mint event handler
    await mintEventHandler.handle(event);
    
    // 5. Log metrics
    metrics.incrementCounter(`mint_events_${event.source}`);
  }
  
  async isEventProcessed(txHash: string, logIndex: number): Promise<boolean> {
    const eventId = `${txHash}-${logIndex}`;
    
    // Check in-memory cache first
    if (this.processedEvents.has(eventId)) {
      return true;
    }
    
    // Check database
    const existing = await prisma.processedEvent.findUnique({
      where: {
        transactionHash_logIndex: {
          transactionHash: txHash,
          logIndex: logIndex
        }
      }
    });
    
    if (existing) {
      this.processedEvents.add(eventId);
      return true;
    }
    
    return false;
  }
  
  async markEventProcessed(txHash: string, logIndex: number): Promise<void> {
    const eventId = `${txHash}-${logIndex}`;
    
    // Add to in-memory cache
    this.processedEvents.add(eventId);
    
    // Maintain cache size
    if (this.processedEvents.size > this.CACHE_SIZE) {
      const firstItem = this.processedEvents.values().next().value;
      this.processedEvents.delete(firstItem);
    }
    
    // Store in database
    await prisma.processedEvent.create({
      data: {
        transactionHash: txHash,
        logIndex: logIndex,
        processedAt: new Date()
      }
    });
  }
}
```

### 4. Configuration Manager

**Purpose:** Manages feature flags and configuration

**Interface:**

```typescript
interface ConfigManager {
  isWebSocketEnabled(): boolean;
  getWebSocketProviderUrl(): string;
  getReconnectionConfig(): ReconnectionConfig;
}

interface ReconnectionConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
}
```

**Configuration File (config/blockchain.ts):**

```typescript
export const blockchainConfig = {
  websocket: {
    enabled: process.env.WEBSOCKET_ENABLED === 'true',
    providerUrl: process.env.WEBSOCKET_PROVIDER_URL || 'wss://...',
    reconnection: {
      maxAttempts: 10,
      baseDelay: 1000,
      maxDelay: 30000
    }
  },
  polling: {
    interval: 5000, // existing polling interval
    batchSize: 100
  }
};
```

### 5. Launchpad Service Extension

**Purpose:** Manages launchpad featured status changes

**Interface:**

```typescript
interface LaunchpadService {
  // Update featured status and manage WebSocket connection
  updateFeaturedStatus(
    launchpadId: string,
    isFeatured: boolean
  ): Promise<void>;
  
  // Get all featured launchpads
  getFeaturedLaunchpads(): Promise<Launchpad[]>;
}
```

**Implementation:**

```typescript
class LaunchpadService {
  constructor(
    private webSocketManager: WebSocketManager,
    private prisma: PrismaClient
  ) {}
  
  async updateFeaturedStatus(
    launchpadId: string,
    isFeatured: boolean
  ): Promise<void> {
    // 1. Get current launchpad
    const launchpad = await this.prisma.launchpad.findUnique({
      where: { id: launchpadId }
    });
    
    if (!launchpad) {
      throw new Error(`Launchpad ${launchpadId} not found`);
    }
    
    // 2. Update database
    await this.prisma.launchpad.update({
      where: { id: launchpadId },
      data: { isFeatured }
    });
    
    // 3. Manage WebSocket connection
    if (isFeatured && !launchpad.isFeatured) {
      // Becoming featured: add WebSocket listener
      await this.webSocketManager.addListener(launchpad.address);
    } else if (!isFeatured && launchpad.isFeatured) {
      // No longer featured: remove WebSocket listener
      await this.webSocketManager.removeListener(launchpad.address);
    }
  }
}
```

## Data Models

### ProcessedEvent Model

New model to track processed events for deduplication:

```prisma
model ProcessedEvent {
  id              String   @id @default(cuid())
  transactionHash String
  logIndex        Int
  processedAt     DateTime @default(now())
  
  @@unique([transactionHash, logIndex])
  @@index([processedAt])
}
```

### Launchpad Model Extension

```prisma
model Launchpad {
  id          String   @id @default(cuid())
  address     String   @unique
  name        String
  isFeatured  Boolean  @default(false)
  // ... existing fields
  
  @@index([isFeatured])
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Default isFeatured Value

*For any* launchpad created without explicitly setting isFeatured, the isFeatured field should default to false.

**Validates: Requirements 1.2**

### Property 2: Featured Status Query Filtering

*For any* set of launchpads with mixed isFeatured values, querying by isFeatured=true should return only launchpads where isFeatured is true, and querying by isFeatured=false should return only launchpads where isFeatured is false.

**Validates: Requirements 1.3**

### Property 3: Boolean Validation for isFeatured

*For any* non-boolean value provided for isFeatured during launchpad creation or update, the system should reject the operation with a validation error.

**Validates: Requirements 1.4**

### Property 4: WebSocket Connection Establishment Based on Featured Status

*For any* launchpad, a WebSocket connection should be established if and only if isFeatured is true and WebSocket listening is globally enabled.

**Validates: Requirements 2.1, 2.3, 7.4**

### Property 5: Mint Events Received via WebSocket for Featured Launchpads

*For any* mint event occurring on a featured launchpad with WebSocket enabled, the event should be received through the contract.on() WebSocket listener.

**Validates: Requirements 2.2**

### Property 6: WebSocket Initialization on Startup

*For any* system startup with WebSocket enabled, all launchpads where isFeatured=true should have WebSocket connections established.

**Validates: Requirements 2.4, 5.1**

### Property 7: Reconnection on WebSocket Failure

*For any* WebSocket connection failure, the system should attempt reconnection with exponential backoff up to the configured maximum delay.

**Validates: Requirements 2.5, 5.3**

### Property 8: Mint Events Use WebSocket, Other Events Use Polling

*For any* featured launchpad with WebSocket enabled, mint events should be received via WebSocket while all other event types (Transfer, Marketplace, Activity) should be received via polling.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 9: Non-Featured Launchpads Use Polling

*For any* launchpad where isFeatured=false, all events including mint events should be received via the polling mechanism.

**Validates: Requirements 4.1**

### Property 10: Featured Status Transition Handling

*For any* launchpad whose isFeatured status changes, the system should gracefully transition between WebSocket and polling: closing WebSocket connections when changing from true to false, and establishing WebSocket connections when changing from false to true, without disrupting other event monitoring.

**Validates: Requirements 4.2, 4.3**

### Property 11: Event Deduplication Across Sources

*For any* mint event with a specific transaction hash and log index, if the event is received from both WebSocket and polling sources, it should be processed exactly once.

**Validates: Requirements 4.4, 6.3**

### Property 12: WebSocket Listeners for Mint Events Only

*For any* WebSocket connection established for a featured launchpad, the registered event listener should only listen for Mint events, not other event types.

**Validates: Requirements 5.2**

### Property 13: Graceful Shutdown of WebSocket Connections

*For any* system shutdown, all active WebSocket connections should be gracefully closed without errors.

**Validates: Requirements 5.4**

### Property 14: WebSocket Connection Registry Accuracy

*For any* point in time, the WebSocket connection registry should contain exactly the set of launchpad addresses that are featured and have active WebSocket connections.

**Validates: Requirements 5.5**

### Property 15: WebSocket Events Routed to Existing Handler

*For any* mint event received via WebSocket, the event should be processed by the same mint event handler used for polling-based events, ensuring consistent processing logic.

**Validates: Requirements 6.1, 6.4**

### Property 16: Event Identity by Transaction Hash and Log Index

*For any* two mint events, they should be considered identical if and only if they have the same transaction hash and log index.

**Validates: Requirements 6.2**

### Property 17: Global WebSocket Disable Fallback

*For any* system configuration where WebSocket listening is globally disabled, all events including mint events on featured launchpads should be received via polling.

**Validates: Requirements 7.2**

### Property 18: Connection Logging Completeness

*For any* WebSocket connection lifecycle event (establishment, failure, mint event reception), the system should log the event with all required contextual information (launchpad address, connection status, transaction hash, error details as applicable).

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 19: Metrics Accuracy for WebSocket Connections

*For any* point in time, the exposed metric for active WebSocket connections should equal the actual number of established WebSocket connections.

**Validates: Requirements 8.4**

### Property 20: Metrics Accuracy for Event Sources

*For any* mint event processed, the metrics should correctly increment the counter for either WebSocket or polling source based on how the event was actually received.

**Validates: Requirements 8.5**

## Error Handling

### WebSocket Connection Errors

**Error Types:**
1. **Initial Connection Failure**: Provider unreachable, invalid URL
2. **Connection Drop**: Network interruption, provider restart
3. **Event Processing Error**: Malformed event data, handler exception

**Handling Strategy:**

```typescript
class WebSocketErrorHandler {
  async handleConnectionError(
    launchpadAddress: string,
    error: Error
  ): Promise<void> {
    // 1. Log error with context
    logger.error('WebSocket connection error', {
      launchpadAddress,
      error: error.message,
      stack: error.stack
    });
    
    // 2. Update connection status
    this.updateConnectionStatus(launchpadAddress, {
      isConnected: false,
      lastError: error
    });
    
    // 3. Trigger reconnection
    await this.webSocketManager.handleReconnection(launchpadAddress);
    
    // 4. Alert if max reconnection attempts exceeded
    const status = this.webSocketManager.getConnectionStatus(launchpadAddress);
    if (status.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      await this.alertService.sendAlert({
        type: 'WEBSOCKET_CONNECTION_FAILED',
        launchpadAddress,
        attempts: status.reconnectAttempts
      });
    }
  }
  
  async handleEventProcessingError(
    event: MintEventData,
    error: Error
  ): Promise<void> {
    // 1. Log error with event context
    logger.error('Event processing error', {
      transactionHash: event.transactionHash,
      launchpadAddress: event.launchpadAddress,
      source: event.source,
      error: error.message
    });
    
    // 2. Store failed event for retry
    await prisma.failedEvent.create({
      data: {
        transactionHash: event.transactionHash,
        logIndex: event.logIndex,
        launchpadAddress: event.launchpadAddress,
        error: error.message,
        eventData: JSON.stringify(event)
      }
    });
    
    // 3. Don't mark as processed (allow retry)
    // Event will be reprocessed on next poll or reconnection
  }
}
```

### Database Errors

**Error Types:**
1. **Connection Timeout**: Database unreachable
2. **Constraint Violation**: Duplicate event, invalid foreign key
3. **Query Timeout**: Slow query, database overload

**Handling Strategy:**

```typescript
async function handleDatabaseError(error: Error, operation: string) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': // Unique constraint violation
        logger.warn('Duplicate event detected', { operation });
        // This is expected for deduplication, not a real error
        return;
      
      case 'P2025': // Record not found
        logger.error('Record not found', { operation, error });
        throw new NotFoundError(error.message);
      
      default:
        logger.error('Database error', { operation, code: error.code });
        throw error;
    }
  }
  
  // Connection errors - retry with backoff
  if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
    logger.error('Database connection error', { operation });
    await retryWithBackoff(() => operation);
  }
  
  throw error;
}
```

### Configuration Errors

**Error Types:**
1. **Missing Environment Variables**: WebSocket URL not set
2. **Invalid Configuration**: Negative reconnection delay
3. **Provider Initialization Failure**: Invalid WebSocket URL format

**Handling Strategy:**

```typescript
function validateConfiguration() {
  const errors: string[] = [];
  
  if (blockchainConfig.websocket.enabled) {
    if (!blockchainConfig.websocket.providerUrl) {
      errors.push('WEBSOCKET_PROVIDER_URL is required when WebSocket is enabled');
    }
    
    if (!blockchainConfig.websocket.providerUrl.startsWith('wss://')) {
      errors.push('WEBSOCKET_PROVIDER_URL must use wss:// protocol');
    }
    
    if (blockchainConfig.websocket.reconnection.maxDelay < 
        blockchainConfig.websocket.reconnection.baseDelay) {
      errors.push('maxDelay must be greater than baseDelay');
    }
  }
  
  if (errors.length > 0) {
    logger.error('Configuration validation failed', { errors });
    throw new ConfigurationError(errors.join('; '));
  }
}
```

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests to ensure comprehensive coverage:

- **Unit Tests**: Verify specific examples, edge cases, and integration points
- **Property Tests**: Verify universal properties across all inputs using randomized testing

### Property-Based Testing Configuration

**Library Selection:**
- **TypeScript/JavaScript**: Use `fast-check` library for property-based testing
- Each property test should run minimum 100 iterations
- Each test must be tagged with a comment referencing the design property

**Tag Format:**
```typescript
// Feature: featured-launchpad-mint-websocket, Property 1: Default isFeatured Value
```

### Unit Testing Focus Areas

**1. Database Schema Tests**
- Test isFeatured field exists and accepts boolean values
- Test default value is false
- Test querying by isFeatured status
- Test validation rejects non-boolean values

**2. WebSocket Manager Tests**
- Test initialization establishes connections for featured launchpads
- Test addListener creates contract instance and registers Mint listener
- Test removeListener cleans up connection properly
- Test error handling triggers reconnection
- Test exponential backoff timing
- Test graceful shutdown closes all connections

**3. Event Processor Tests**
- Test deduplication using transaction hash + log index
- Test events from both sources are processed identically
- Test duplicate events are skipped
- Test in-memory cache behavior
- Test cache size limits

**4. Launchpad Service Tests**
- Test updateFeaturedStatus updates database
- Test changing to featured=true adds WebSocket listener
- Test changing to featured=false removes WebSocket listener
- Test error handling for non-existent launchpad

**5. Configuration Tests**
- Test configuration validation catches invalid values
- Test global disable flag prevents WebSocket connections
- Test feature flag is logged on startup

**6. Integration Tests**
- Test end-to-end flow: featured launchpad → mint event → WebSocket → handler → database
- Test transition from non-featured to featured
- Test transition from featured to non-featured
- Test system behavior with mixed featured/non-featured launchpads
- Test polling continues for non-mint events on featured launchpads

### Property-Based Testing Focus Areas

**Property Tests** (each property from Correctness Properties section should have a corresponding test):

1. **Property 1**: Generate random launchpads without isFeatured, verify default is false
2. **Property 2**: Generate random launchpad sets, verify query filtering
3. **Property 3**: Generate random non-boolean values, verify rejection
4. **Property 4**: Generate random launchpads with various featured/config combinations, verify WebSocket establishment logic
5. **Property 5**: Generate random mint events on featured launchpads, verify WebSocket reception
6. **Property 6**: Generate random featured launchpad sets, verify all get connections on startup
7. **Property 7**: Simulate random connection failures, verify reconnection with backoff
8. **Property 8**: Generate random events on featured launchpads, verify mint uses WebSocket, others use polling
9. **Property 9**: Generate random events on non-featured launchpads, verify all use polling
10. **Property 10**: Generate random featured status transitions, verify graceful handling
11. **Property 11**: Generate random duplicate events from both sources, verify single processing
12. **Property 12**: Generate random WebSocket connections, verify only Mint listeners registered
13. **Property 13**: Generate random shutdown scenarios, verify all connections closed
14. **Property 14**: Generate random connection states, verify registry accuracy
15. **Property 15**: Generate random WebSocket mint events, verify handler routing
16. **Property 16**: Generate random event pairs, verify identity logic
17. **Property 17**: Generate random events with WebSocket disabled, verify polling fallback
18. **Property 18**: Generate random connection lifecycle events, verify logging completeness
19. **Property 19**: Generate random connection states, verify metrics accuracy
20. **Property 20**: Generate random mint events from both sources, verify metrics tracking

### Test Data Generation

**For Property-Based Tests:**

```typescript
// Arbitrary generators for fast-check
const arbLaunchpadAddress = fc.hexaString({ minLength: 40, maxLength: 40 })
  .map(hex => `0x${hex}`);

const arbLaunchpad = fc.record({
  id: fc.uuid(),
  address: arbLaunchpadAddress,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  isFeatured: fc.boolean()
});

const arbMintEvent = fc.record({
  from: arbLaunchpadAddress,
  tokenId: fc.bigInt({ min: 0n, max: 1000000n }).map(n => n.toString()),
  transactionHash: fc.hexaString({ minLength: 64, maxLength: 64 })
    .map(hex => `0x${hex}`),
  logIndex: fc.integer({ min: 0, max: 100 }),
  blockNumber: fc.integer({ min: 1, max: 20000000 }),
  launchpadAddress: arbLaunchpadAddress,
  source: fc.constantFrom('websocket', 'polling')
});
```

### Test Environment Setup

**Prerequisites:**
- Test database with Prisma migrations applied
- Mock WebSocket provider for testing without real blockchain
- Mock ethers.js Contract for event listener testing
- Test configuration with WebSocket enabled

**Mock Setup:**

```typescript
// Mock WebSocket Provider
class MockWebSocketProvider extends ethers.providers.WebSocketProvider {
  private eventHandlers: Map<string, Function[]> = new Map();
  
  simulateEvent(eventName: string, ...args: any[]) {
    const handlers = this.eventHandlers.get(eventName) || [];
    handlers.forEach(handler => handler(...args));
  }
  
  on(eventName: string, handler: Function) {
    const handlers = this.eventHandlers.get(eventName) || [];
    handlers.push(handler);
    this.eventHandlers.set(eventName, handlers);
  }
}

// Mock Contract
class MockContract extends ethers.Contract {
  private listeners: Map<string, Function[]> = new Map();
  
  on(eventName: string, listener: Function) {
    const listeners = this.listeners.get(eventName) || [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
    return this;
  }
  
  simulateMintEvent(from: string, tokenId: string, event: any) {
    const listeners = this.listeners.get('Mint') || [];
    listeners.forEach(listener => listener(from, tokenId, event));
  }
}
```

### Test Execution

**Unit Tests:**
```bash
npm test -- --testPathPattern=websocket
```

**Property Tests:**
```bash
npm test -- --testPathPattern=properties
```

**Integration Tests:**
```bash
npm test -- --testPathPattern=integration
```

### Coverage Goals

- **Line Coverage**: Minimum 90%
- **Branch Coverage**: Minimum 85%
- **Property Test Iterations**: Minimum 100 per property
- **Critical Paths**: 100% coverage for WebSocket connection management and event deduplication

## Implementation Notes

### Migration Strategy

1. **Phase 1: Database Migration**
   - Add isFeatured column to Launchpad table
   - Create ProcessedEvent table
   - Add indexes

2. **Phase 2: Core Implementation**
   - Implement WebSocketManager
   - Implement EventProcessor with deduplication
   - Update LaunchpadService

3. **Phase 3: Integration**
   - Wire WebSocketManager into event listener system
   - Ensure polling continues for non-mint events
   - Add configuration and feature flags

4. **Phase 4: Testing & Monitoring**
   - Deploy to staging with WebSocket disabled
   - Enable WebSocket for one test launchpad
   - Monitor metrics and logs
   - Gradually enable for more launchpads

### Performance Considerations

**WebSocket Connections:**
- Each WebSocket connection consumes memory and network resources
- Limit featured launchpads to a reasonable number (recommend < 100)
- Monitor connection count metrics

**Event Deduplication:**
- In-memory cache reduces database queries
- Cache size of 10,000 events should handle typical load
- Consider Redis for distributed deployments

**Database Queries:**
- Index on isFeatured enables efficient featured launchpad queries
- Composite unique index on (transactionHash, logIndex) enables fast deduplication
- Consider partitioning ProcessedEvent table by date for long-term scalability

### Monitoring and Alerts

**Key Metrics:**
- `websocket_connections_active`: Current number of active WebSocket connections
- `mint_events_websocket_total`: Total mint events received via WebSocket
- `mint_events_polling_total`: Total mint events received via polling
- `websocket_reconnections_total`: Total reconnection attempts
- `websocket_errors_total`: Total WebSocket errors

**Alerts:**
- Alert if WebSocket connection fails after max reconnection attempts
- Alert if mint event processing fails repeatedly
- Alert if deduplication cache hit rate drops below threshold
- Alert if WebSocket connection count exceeds expected number

### Security Considerations

**WebSocket Provider:**
- Use authenticated WebSocket provider (wss://)
- Validate provider URL format
- Use environment variables for sensitive configuration

**Event Validation:**
- Validate event data structure before processing
- Sanitize launchpad addresses
- Verify event signatures if available

**Rate Limiting:**
- Implement rate limiting for event processing
- Prevent DoS from malicious event flooding
- Monitor event processing rate

## Deployment Checklist

- [ ] Database migration applied (isFeatured column, ProcessedEvent table)
- [ ] Environment variables configured (WEBSOCKET_PROVIDER_URL, WEBSOCKET_ENABLED)
- [ ] WebSocket provider credentials secured
- [ ] Monitoring dashboards created
- [ ] Alerts configured
- [ ] Feature flag set to disabled initially
- [ ] Staging deployment tested
- [ ] One test launchpad marked as featured
- [ ] WebSocket feature enabled in staging
- [ ] Metrics validated
- [ ] Gradual rollout plan documented
- [ ] Rollback procedure documented
