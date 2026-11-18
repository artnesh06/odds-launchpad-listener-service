# Database Change Listener

## Overview

The `DatabaseChangeListener` is a critical component that bridges Ponder's blockchain indexing with real-time WebSocket events. It listens to PostgreSQL NOTIFY events triggered by database triggers when Ponder inserts new blockchain events, then emits corresponding WebSocket events to connected clients.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Ponder Framework                          │
│  (Indexes blockchain events and writes to PostgreSQL)       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ INSERT INTO Transfer/Mint/Phase/etc.
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                PostgreSQL Database                           │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  AFTER INSERT Triggers                                │  │
│  │  - notify_transfer_insert()                          │  │
│  │  - notify_mint_insert()                              │  │
│  │  - notify_phase_insert()                             │  │
│  │  - notify_burn_insert()                              │  │
│  │  - notify_airdrop_insert()                           │  │
│  │  - notify_collection_insert()                        │  │
│  │  - notify_revealed_insert()                          │  │
│  │  - notify_metadata_update_insert()                   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ pg_notify('channel', json_payload)
                     ↓
┌─────────────────────────────────────────────────────────────┐
│            DatabaseChangeListener                            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  PostgreSQL Client (LISTEN)                          │  │
│  │  - Subscribes to notification channels               │  │
│  │  - Receives JSON payloads                            │  │
│  │  - Routes to appropriate handlers                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Event Handlers                                       │  │
│  │  - handleTransferNotification()                      │  │
│  │  - handleMintNotification()                          │  │
│  │  - handlePhaseNotification()                         │  │
│  │  - handleBurnNotification()                          │  │
│  │  - handleAirdropNotification()                       │  │
│  │  - handleCollectionNotification()                    │  │
│  │  - handleRevealedNotification()                      │  │
│  │  - handleMetadataUpdateNotification()                │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ emitMintEvent(), emitPhaseEvent(), etc.
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                    EventEmitter                              │
│  (Broadcasts to WebSocket rooms)                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ WebSocket broadcast
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                  Frontend Clients                            │
│  (Receive real-time blockchain event updates)               │
└─────────────────────────────────────────────────────────────┘
```

## Features

### 1. Real-time Event Listening
- Subscribes to 8 PostgreSQL notification channels
- Receives JSON payloads from database triggers
- Zero polling overhead - events are pushed from database

### 2. Automatic Reconnection
- Detects connection failures automatically
- Exponential backoff retry strategy
- Configurable max retry attempts
- Continues from where it left off after reconnection

### 3. Event Routing
- Parses notification payloads
- Routes to appropriate handler based on channel
- Transforms database format to WebSocket event format
- Emits events via EventEmitter

### 4. Error Handling
- Graceful error handling for all operations
- Logs errors without crashing
- Continues processing other events on error
- Automatic recovery from transient failures

### 5. Polling Safety Net
- Periodic polling for missed events during downtime
- Configurable poll interval
- Ensures no events are lost during brief disconnections

## Usage

### Basic Setup

```typescript
import { DatabaseChangeListener } from './lib/database';
import { EventEmitter } from './lib/websocket/event-emitter';
import { WebSocketManager } from './lib/websocket/websocket-manager';

// Initialize WebSocket infrastructure
const wsManager = new WebSocketManager(config);
await wsManager.initialize();

const eventEmitter = new EventEmitter(wsManager);

// Create and start listener
const listener = new DatabaseChangeListener(eventEmitter, {
  connectionString: process.env.DATABASE_URL!,
  reconnectDelay: 5000,
  maxReconnectAttempts: 10,
  pollInterval: 30000,
});

await listener.start();
```

### Graceful Shutdown

```typescript
// Stop listener on application shutdown
process.on('SIGTERM', async () => {
  await listener.stop();
  await wsManager.shutdown();
  process.exit(0);
});
```

## Configuration

```typescript
interface DatabaseChangeListenerConfig {
  connectionString: string;        // PostgreSQL connection string
  reconnectDelay?: number;         // Base delay for reconnection (default: 5000ms)
  maxReconnectAttempts?: number;   // Max reconnection attempts (default: 10)
  pollInterval?: number;           // Polling interval for missed events (default: 30000ms)
}
```

## Notification Channels

| Channel | Trigger Table | Event Type | WebSocket Event |
|---------|--------------|------------|-----------------|
| `ponder_transfer_insert` | Transfer | NFT Transfer | `mint` (if from=0x0) |
| `ponder_mint_insert` | Mint | NFT Mint | `mint` |
| `ponder_phase_insert` | Phase | Phase Added/Updated | `phase:update` |
| `ponder_burn_insert` | Burn | NFT Burn | `burn` |
| `ponder_airdrop_insert` | Airdrop | NFT Airdrop | `airdrop` |
| `ponder_collection_insert` | Collection | Collection Deployed | `collection:new` |
| `ponder_revealed_insert` | Revealed | Collection Revealed | `reveal` |
| `ponder_metadata_update_insert` | BatchMetadataUpdate | Metadata Updated | (logged only) |

## Event Flow Example

### Mint Event Flow

1. **Ponder indexes a mint event** from blockchain
2. **Ponder inserts** into `Mint` table
3. **PostgreSQL trigger** `notify_mint_insert()` fires
4. **Trigger sends** `pg_notify('ponder_mint_insert', json_payload)`
5. **DatabaseChangeListener** receives notification
6. **Handler** `handleMintNotification()` processes payload
7. **EventEmitter** `emitMintEvent()` broadcasts to WebSocket rooms:
   - `wallet:{minter}` - Personal notification
   - `launchpad:{contractAddress}` - Launchpad stats
   - `homepage:all` - Global activity feed
   - `homepage:chain:{chainId}` - Chain-specific feed
8. **Frontend clients** receive real-time update

## Monitoring

### Check Connection Status

```typescript
const isListening = listener.isListening();
console.log('Listener active:', isListening);
```

### Check Reconnection Attempts

```typescript
const attempts = listener.getReconnectAttempts();
console.log('Reconnection attempts:', attempts);
```

## Error Handling

The listener handles errors gracefully:

- **Connection errors**: Automatic reconnection with exponential backoff
- **Notification parsing errors**: Logged and skipped, processing continues
- **Handler errors**: Logged and skipped, other events still processed
- **Database errors**: Triggers reconnection logic

## Performance Considerations

- **Low overhead**: Uses PostgreSQL LISTEN/NOTIFY (no polling)
- **Efficient**: Single connection for all channels
- **Scalable**: Handles high event throughput
- **Reliable**: Automatic recovery from failures

## Testing

Run tests:
```bash
npm test -- src/lib/database/__tests__/change-listener.test.ts
```

## Requirements Satisfied

- ✅ **5.1**: Database change listener with LISTEN subscriptions
- ✅ **5.2**: Notification handler with routing
- ✅ **5.3**: WebSocket emission for all event types
- ✅ **10.1**: Automatic reconnection with exponential backoff
- ✅ **10.2**: Polling for missed events during downtime

## Future Enhancements

1. **Event tracking**: Track last processed event ID per table
2. **Metrics**: Add Prometheus metrics for monitoring
3. **Batch processing**: Batch multiple events for efficiency
4. **Filtering**: Allow filtering events by contract/chain
5. **Replay**: Ability to replay missed events from specific timestamp
