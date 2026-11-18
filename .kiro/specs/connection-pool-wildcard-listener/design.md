# Design Document: Connection Pool Wildcard Listener Implementation

## Overview

This design refactors the blockchain event listening system from individual event listeners (20+ per launchpad) to wildcard listeners (1 per launchpad) integrated with a WebSocket Connection Pool. This enables unlimited scaling by reducing concurrent subscriptions from O(n × 20) to O(n), where n is the number of launchpads.

**Current State:**
- 2 launchpads × 20 events = 40 subscriptions
- Limit: ~200 launchpads (hitting 200 concurrent request limit)

**Target State:**
- 2 launchpads × 1 wildcard = 2 subscriptions
- Limit: Unlimited (180 launchpads per connection, auto-scaling)

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Activity Listener                          │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         WebSocket Connection Pool                     │  │
│  │                                                        │  │
│  │  Connection #0 (180 launchpads max)                  │  │
│  │  ├─ Launchpad 1 → Wildcard Listener                  │  │
│  │  ├─ Launchpad 2 → Wildcard Listener                  │  │
│  │  └─ ...                                               │  │
│  │                                                        │  │
│  │  Connection #1 (auto-created at 181 launchpads)      │  │
│  │  ├─ Launchpad 181 → Wildcard Listener                │  │
│  │  └─ ...                                               │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Event Router                                  │  │
│  │  Wildcard Event → Route by name → Event Handler      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Component Interaction Flow

```
1. addLaunchpad(address)
   ↓
2. ConnectionPool.getConnectionForLaunchpad(address)
   ↓
3. Assign to Connection #N (or create new if full)
   ↓
4. Create Contract with Connection's Provider
   ↓
5. Register Wildcard Listener: contract.on('*', handler)
   ↓
6. On Event: routeEvent(eventName, address, event)
   ↓
7. Call appropriate handler (handleMintEvent, handleBurnedEvent, etc.)
```

## Components and Interfaces

### 1. WebSocketConnectionPool

**Purpose:** Manages multiple WebSocket connections, each supporting up to 180 launchpads.

**Key Methods:**
```typescript
class WebSocketConnectionPool {
  // Get or create connection for a launchpad
  getConnectionForLaunchpad(address: string): {
    provider: ethers.WebSocketProvider;
    connectionId: number;
  }
  
  // Mark connection as active (received event)
  markConnectionActive(connectionId: number): void
  
  // Remove launchpad from pool
  removeLaunchpad(address: string): void
  
  // Get pool statistics
  getStats(): PoolStats
  
  // Cleanup all connections
  destroy(): Promise<void>
}
```

**Configuration:**
- `MAX_LAUNCHPADS_PER_CONNECTION = 180` (safety margin from 200 limit)
- `CONNECTION_TIMEOUT_MS = 30000`
- `RECONNECT_DELAY_MS = 5000`

**Load Balancing Strategy:**
1. Check if launchpad already assigned → return existing connection
2. Find connection with available capacity → assign to that connection
3. All connections full → create new connection

### 2. ActivityListener (Modified)

**New Properties:**
```typescript
private connectionPool?: WebSocketConnectionPool;
```

**Modified Methods:**

**addLaunchpad(address: string):**
- Old: Register 20+ individual event listeners
- New: Register 1 wildcard listener via connection pool

```typescript
async addLaunchpad(address: string): Promise<void> {
  // 1. Validate address
  // 2. Get connection from pool
  // 3. Create contract with pool's provider
  // 4. Register wildcard listener: contract.on('*', handler)
  // 5. Log pool statistics
}
```

**routeEvent(eventName: string, address: string, event: EventLog):**
- New method to route wildcard events to appropriate handlers
- Maps event names to handler methods
- Maintains backward compatibility with existing handlers

```typescript
private async routeEvent(
  eventName: string,
  launchpadAddress: string,
  event: ethers.EventLog
): Promise<void> {
  switch (eventName) {
    case 'Transfer':
      await this.handleMintEvent({...});
      break;
    case 'Burned':
      await this.userEventHandler.handleBurnedEvent({...});
      break;
    // ... other event types
  }
}
```

**removeLaunchpad(address: string):**
- Old: Remove individual event listeners
- New: Remove wildcard listener and update connection pool

**stop():**
- Old: Cleanup individual listeners
- New: Cleanup wildcard listeners and destroy connection pool

### 3. Event Handlers (Unchanged)

All existing event handlers remain unchanged:
- `handleMintEvent()`
- `userEventHandler.handleBurnedEvent()`
- `airdropEventHandler.handleAirdropEvent()`
- `adminEventHandler.handlePhaseAddedEvent()`
- etc.

## Data Models

### ConnectionStats
```typescript
interface ConnectionStats {
  connectionId: number;
  launchpadCount: number;
  createdAt: Date;
  lastEventAt: Date;
  status: 'active' | 'closed' | 'error' | 'failed';
  reconnectCount: number;
}
```

### PoolStats
```typescript
interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  totalLaunchpads: number;
  maxCapacity: number;
  utilizationPercent: number;
  connections: ConnectionStats[];
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: One Wildcard Listener Per Launchpad

*For any* launchpad address, when added to the Activity_Listener, exactly one wildcard listener should be registered (not 20+ individual listeners).

**Validates: Requirements 1.1**

### Property 2: Event Routing Correctness

*For any* wildcard event received with a valid event name, the Event_Router should call the appropriate event handler method that corresponds to that event name.

**Validates: Requirements 1.2, 3.1, 3.4**

### Property 3: Connection Pool Assignment

*For any* launchpad address, when added to the Activity_Listener, it should be assigned to a connection from the Connection_Pool, and that assignment should be tracked correctly.

**Validates: Requirements 2.1**

### Property 4: Pool Statistics Accuracy

*For any* sequence of addLaunchpad and removeLaunchpad operations, the Connection_Pool statistics (totalLaunchpads, totalConnections, utilizationPercent) should always accurately reflect the current state.

**Validates: Requirements 2.4**

### Property 5: Launchpad Removal Cleanup

*For any* launchpad that has been added, when removed from the Activity_Listener, it should be removed from the Connection_Pool and its wildcard listener should be unregistered.

**Validates: Requirements 2.3, 6.3**

### Property 6: Event Validation Before Processing

*For any* wildcard event received, if the event log structure is invalid (missing blockNumber, transactionHash, etc.), the Activity_Listener should skip processing and log a warning.

**Validates: Requirements 4.1, 4.3**

### Property 7: Block Number Filtering

*For any* wildcard event received, if the event's block number is less than the starting block for that launchpad, the Activity_Listener should skip processing that event.

**Validates: Requirements 4.2**

### Property 8: Event Enable Configuration Respected

*For any* event type that is disabled via isEventEnabled configuration, wildcard events of that type should be skipped and not processed.

**Validates: Requirements 4.4**

## Error Handling

### Connection Errors

**Scenario:** WebSocket connection drops or encounters an error

**Handling:**
1. Connection status updated to 'error' or 'closed'
2. Error logged with connection ID
3. Auto-reconnect triggered after `RECONNECT_DELAY_MS`
4. Reconnect count incremented
5. If reconnect fails, status set to 'failed'

### Invalid Events

**Scenario:** Wildcard event received with invalid structure

**Handling:**
1. Validate event log structure (blockNumber, transactionHash, etc.)
2. If invalid, log warning with launchpad address
3. Skip processing, continue listening
4. Do not throw error (prevents listener from stopping)

### Event Routing Errors

**Scenario:** Error occurs while routing event to handler

**Handling:**
1. Catch error in wildcard listener
2. Log error with event name and launchpad address
3. Continue processing other events
4. Do not throw error (prevents listener from stopping)

### Pool Capacity

**Scenario:** Connection reaches 180 launchpads

**Handling:**
1. Detect capacity reached in `getConnectionForLaunchpad`
2. Automatically create new connection
3. Assign new launchpad to new connection
4. Log new connection creation with statistics

## Testing Strategy

### Unit Tests

**Focus:** Specific examples and edge cases

1. **Connection Pool Creation**
   - Test creating first connection
   - Test creating second connection when first is full
   - Test empty pool statistics

2. **Launchpad Assignment**
   - Test assigning launchpad to connection #0
   - Test assigning 181st launchpad creates connection #1
   - Test reassigning launchpad after connection removal

3. **Event Routing**
   - Test routing Transfer event calls handleMintEvent
   - Test routing Burned event calls handleBurnedEvent
   - Test routing unknown event logs warning

4. **Error Handling**
   - Test invalid event structure is skipped
   - Test event with old block number is skipped
   - Test disabled event type is skipped

5. **Cleanup**
   - Test removeLaunchpad removes from pool
   - Test stop() destroys connection pool
   - Test empty connection is closed

### Property-Based Tests

**Focus:** Universal properties across all inputs

**Configuration:** Minimum 100 iterations per test

**Property Test 1: One Wildcard Listener Per Launchpad**
- Generate random launchpad addresses
- Add each to Activity_Listener
- Verify exactly 1 subscription per launchpad (not 20+)
- **Feature: connection-pool-wildcard-listener, Property 1: One Wildcard Listener Per Launchpad**

**Property Test 2: Event Routing Correctness**
- Generate random events with different event names
- Route each event
- Verify correct handler method is called for each event type
- **Feature: connection-pool-wildcard-listener, Property 2: Event Routing Correctness**

**Property Test 3: Connection Pool Assignment**
- Generate random launchpad addresses
- Add each to Activity_Listener
- Verify each is assigned to a valid connection
- Verify assignment is tracked in pool
- **Feature: connection-pool-wildcard-listener, Property 3: Connection Pool Assignment**

**Property Test 4: Pool Statistics Accuracy**
- Generate random sequences of add/remove operations
- Execute operations
- Verify statistics always match actual state
- **Feature: connection-pool-wildcard-listener, Property 4: Pool Statistics Accuracy**

**Property Test 5: Launchpad Removal Cleanup**
- Generate random launchpad addresses
- Add each, then remove each
- Verify removal from pool
- Verify wildcard listener unregistered
- **Feature: connection-pool-wildcard-listener, Property 5: Launchpad Removal Cleanup**

**Property Test 6: Event Validation Before Processing**
- Generate random events with valid and invalid structures
- Process each event
- Verify invalid events are skipped
- Verify valid events are processed
- **Feature: connection-pool-wildcard-listener, Property 6: Event Validation Before Processing**

**Property Test 7: Block Number Filtering**
- Generate random events with various block numbers
- Process events with starting block = 1000
- Verify events with blockNumber < 1000 are skipped
- Verify events with blockNumber >= 1000 are processed
- **Feature: connection-pool-wildcard-listener, Property 7: Block Number Filtering**

**Property Test 8: Event Enable Configuration Respected**
- Generate random events of different types
- Enable/disable different event types
- Verify only enabled events are processed
- **Feature: connection-pool-wildcard-listener, Property 8: Event Enable Configuration Respected**

### Integration Tests

1. **End-to-End Wildcard Listener**
   - Start Activity_Listener with connection pool
   - Add 2 launchpads
   - Simulate events from blockchain
   - Verify events are routed and processed correctly

2. **Auto-Scaling**
   - Add 181 launchpads
   - Verify 2 connections are created
   - Verify launchpads are distributed correctly

3. **Reconnection**
   - Start Activity_Listener
   - Simulate connection drop
   - Verify auto-reconnect happens
   - Verify events continue to be processed

## Implementation Notes

### Migration Strategy

1. **Phase 1:** Create WebSocketConnectionPool class ✅
2. **Phase 2:** Add connectionPool property to ActivityListener ✅
3. **Phase 3:** Add routeEvent method to ActivityListener ✅
4. **Phase 4:** Replace addLaunchpad method with wildcard implementation ⏳
5. **Phase 5:** Update removeLaunchpad and stop methods ✅
6. **Phase 6:** Test with 2 launchpads, verify 2 subscriptions
7. **Phase 7:** Test with 181 launchpads, verify 2 connections

### Backward Compatibility

- All existing event handlers remain unchanged
- Event handler method signatures remain unchanged
- Event data structures remain unchanged
- Only the listener registration mechanism changes

### Performance Improvements

- **Subscription Reduction:** 98% reduction (40 → 2 for 2 launchpads)
- **Memory Usage:** Lower memory footprint (fewer listener objects)
- **Scalability:** Unlimited launchpads (auto-scaling connections)
- **Maintainability:** Simpler code (1 wildcard listener vs 20+ individual listeners)

### Logging Changes

**Old Logs:**
```
✅ Listening to NEW Transfer events on chain 6343 (from block 9135613) for 2 launchpads
✅ Listening to NEW Burned events on chain 6343 (from block 9135613)
✅ Listening to NEW Airdropped events on chain 6343 (from block 9135614)
... (20+ lines)
```

**New Logs:**
```
🏊 Using WebSocket Connection Pool for unlimited launchpads
🔌 Created new WebSocket connection #0 for chain 6343
📍 Assigned launchpad 0x89c0... to connection #0 (1/180)
🔍 Registering wildcard listener for 0x89c0...
✅ Wildcard listener registered for 0x89c0...
📊 Pool: 1 launchpads across 1 connections (0.6% utilized)
```
