# Event Emitter Usage Guide

## Overview

The EventEmitter bridges blockchain events from the ActivityListener to the WebSocket Manager, enabling real-time updates to connected frontend clients.

## Architecture

```
ActivityListener → EventEmitter → WebSocket Manager → Frontend Clients
```

## Integration

### 1. Initialize WebSocket Manager and EventEmitter

```typescript
import { WebSocketManager } from './lib/websocket/websocket-manager';
import { EventEmitter } from './lib/websocket/event-emitter';
import { getWebSocketConfig } from './config/websocket';

// Initialize WebSocket Manager
const wsConfig = getWebSocketConfig();
const wsManager = new WebSocketManager(wsConfig);
await wsManager.initialize();

// Initialize Event Emitter
const eventEmitter = new EventEmitter(wsManager);
eventEmitter.enable();
```

### 2. Pass EventEmitter to ActivityListener

```typescript
import { ActivityListener } from './lib/blockchain/activity-listener';

// Create activity listener with event emitter
const activityListener = new ActivityListener(
  {
    chainId: 1,
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY',
    factoryAddress: '0x...',
    launchpadAddresses: ['0x...'],
  },
  eventEmitter // Pass the event emitter
);

await activityListener.start();
```

### 3. Events are Automatically Emitted

Once integrated, the ActivityListener will automatically emit WebSocket events when:

- **Mint events occur**: Emitted to homepage, launchpad, and wallet rooms
- **Collections are deployed**: Emitted to homepage rooms
- **Phases are added/updated**: Emitted to launchpad rooms

## Event Types

### Mint Event

```typescript
{
  type: 'mint',
  data: {
    contractAddress: '0x...',
    chainId: 1,
    minter: '0x...',
    tokenId: '123',
    quantity: 1,
    timestamp: '2024-01-01T00:00:00.000Z',
    transactionHash: '0x...',
    phaseId?: '1',
    imageUrl?: 'https://...'
  }
}
```

**Broadcast to:**
- `homepage:all` - All chains
- `homepage:chain:1` - Specific chain
- `launchpad:0x...` - Specific launchpad
- `wallet:0x...` - Minter's wallet

### Collection Event

```typescript
{
  type: 'collection:new',
  data: {
    contractAddress: '0x...',
    chainId: 1,
    name: 'My Collection',
    creator: '0x...',
    totalSupply: 10000,
    imageUrl?: 'https://...',
    timestamp: '2024-01-01T00:00:00.000Z'
  }
}
```

**Broadcast to:**
- `homepage:all` - All chains
- `homepage:chain:1` - Specific chain
- `launchpad:0x...` - Specific launchpad

### Phase Event

```typescript
{
  type: 'phase:update',
  data: {
    contractAddress: '0x...',
    phaseId: '1',
    minted: 100,
    isActive: true,
    timestamp: '2024-01-01T00:00:00.000Z'
  }
}
```

**Broadcast to:**
- `launchpad:0x...` - Specific launchpad

## Batch Event Processing

The EventEmitter supports batch event processing with automatic deduplication:

```typescript
const events = [
  { type: 'mint', data: { ... } },
  { type: 'mint', data: { ... } },
  { type: 'collection', data: { ... } }
];

eventEmitter.emitBatchEvents(events);
```

**Deduplication rules:**
- Mint events: `txHash + tokenId`
- Collection events: `contractAddress`
- Phase events: `contractAddress + phaseId`

## Error Handling

The EventEmitter includes comprehensive error handling:

- Errors are logged but don't crash the ActivityListener
- Failed emissions are logged with full context
- The ActivityListener continues processing events even if WebSocket emission fails

## Disabling WebSocket Emission

If you want to run the ActivityListener without WebSocket support:

```typescript
// Simply don't pass the eventEmitter parameter
const activityListener = new ActivityListener(config);
await activityListener.start();
```

## Room Strategy

Events are routed to rooms based on the RoomStrategy:

- **Homepage rooms**: `homepage:all` or `homepage:chain:{chainId}`
- **Launchpad rooms**: `launchpad:{contractAddress}`
- **Wallet rooms**: `wallet:{address}`

See `ROOM_STRATEGY_USAGE.md` for more details on room naming conventions.

## Requirements

This implementation satisfies:
- **Requirement 4.2**: Activity listener events passed to WebSocket Manager
- **Requirement 7.4**: Update batching and throttling
- **Requirement 10.1**: Multi-chain event routing

## Example: Complete Setup

```typescript
import { WebSocketManager } from './lib/websocket/websocket-manager';
import { EventEmitter } from './lib/websocket/event-emitter';
import { ActivityListener } from './lib/blockchain/activity-listener';
import { getWebSocketConfig } from './config/websocket';

async function startService() {
  // 1. Initialize WebSocket Manager
  const wsConfig = getWebSocketConfig();
  const wsManager = new WebSocketManager(wsConfig);
  await wsManager.initialize();
  console.log('✅ WebSocket Manager initialized');

  // 2. Initialize Event Emitter
  const eventEmitter = new EventEmitter(wsManager);
  eventEmitter.enable();
  console.log('✅ Event Emitter enabled');

  // 3. Initialize Activity Listener with Event Emitter
  const activityListener = new ActivityListener(
    {
      chainId: 1,
      rpcUrl: process.env.RPC_URL!,
      factoryAddress: process.env.FACTORY_ADDRESS!,
      launchpadAddresses: process.env.LAUNCHPAD_ADDRESSES!.split(','),
    },
    eventEmitter
  );

  await activityListener.start();
  console.log('✅ Activity Listener started with WebSocket support');

  // 4. Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await activityListener.stop();
    await wsManager.shutdown();
    process.exit(0);
  });
}

startService().catch(console.error);
```

## Testing

To test the integration:

1. Start the service with WebSocket support
2. Connect a WebSocket client to the server
3. Subscribe to a room (e.g., `homepage:all`)
4. Trigger a blockchain event (mint, deploy, etc.)
5. Verify the event is received by the client

Example client test:

```typescript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');

socket.on('connect', () => {
  console.log('Connected to WebSocket server');
  socket.emit('join', { room: 'homepage:all' });
});

socket.on('mint', (data) => {
  console.log('Mint event received:', data);
});

socket.on('collection:new', (data) => {
  console.log('Collection event received:', data);
});
```
