# Room Strategy Usage Guide

The `RoomStrategy` class provides utilities for creating and validating WebSocket room names following a consistent naming convention.

## Room Naming Convention

- **Homepage (all chains)**: `homepage:all`
- **Homepage (specific chain)**: `homepage:chain:{chainId}`
- **Launchpad (specific contract)**: `launchpad:{contractAddress}`
- **Wallet (specific address)**: `wallet:{walletAddress}`

## Usage Examples

### Creating Room Names

```typescript
import { roomStrategy } from './lib/websocket';

// Homepage rooms
const allChainsRoom = roomStrategy.getHomepageRoom(); // "homepage:all"
const ethereumRoom = roomStrategy.getHomepageRoom(1); // "homepage:chain:1"
const polygonRoom = roomStrategy.getHomepageRoom(137); // "homepage:chain:137"

// Launchpad rooms
const launchpadRoom = roomStrategy.getLaunchpadRoom('0x1234567890123456789012345678901234567890');
// "launchpad:0x1234567890123456789012345678901234567890"

// Wallet rooms
const walletRoom = roomStrategy.getWalletRoom('0xabcdef1234567890123456789012345678901234');
// "wallet:0xabcdef1234567890123456789012345678901234"
```

### Validating Room Names

```typescript
import { roomStrategy } from './lib/websocket';

// Validate room format
const isValid = roomStrategy.isValidRoom('homepage:chain:1'); // true
const isInvalid = roomStrategy.isValidRoom('invalid-room'); // false
```

### Parsing Room Information

```typescript
import { roomStrategy } from './lib/websocket';

// Parse homepage room
const homepageInfo = roomStrategy.parseRoomInfo('homepage:chain:137');
// { type: 'homepage', chainId: 137 }

// Parse launchpad room
const launchpadInfo = roomStrategy.parseRoomInfo('launchpad:0x1234567890123456789012345678901234567890');
// { type: 'launchpad', contractAddress: '0x1234567890123456789012345678901234567890' }

// Parse wallet room
const walletInfo = roomStrategy.parseRoomInfo('wallet:0xabcdef1234567890123456789012345678901234');
// { type: 'wallet', walletAddress: '0xabcdef1234567890123456789012345678901234' }
```

## Integration with WebSocket Manager

The `RoomStrategy` can be used when clients join rooms:

```typescript
import { roomStrategy, WebSocketManager } from './lib/websocket';

// Client wants to join homepage for Ethereum
const room = roomStrategy.getHomepageRoom(1);
websocketManager.joinRoom(socketId, room);

// Client wants to join specific launchpad
const launchpadRoom = roomStrategy.getLaunchpadRoom(contractAddress);
websocketManager.joinRoom(socketId, launchpadRoom);
```

## Frontend Usage

The same room strategy logic should be implemented in the frontend to ensure consistency:

```typescript
// Frontend example (to be implemented)
const room = getHomepageRoom(chainId);
socket.emit('join', { room });
```

## Validation and Error Handling

The room strategy validates inputs and throws descriptive errors:

```typescript
try {
  const room = roomStrategy.getLaunchpadRoom('invalid-address');
} catch (error) {
  console.error(error.message); // "Invalid contract address format"
}

try {
  const info = roomStrategy.parseRoomInfo('invalid:room:format');
} catch (error) {
  console.error(error.message); // "Unknown room type: invalid:room:format"
}
```

## Address Normalization

All Ethereum addresses are normalized to lowercase for consistency:

```typescript
const room1 = roomStrategy.getLaunchpadRoom('0xABCDEF1234567890123456789012345678901234');
const room2 = roomStrategy.getLaunchpadRoom('0xabcdef1234567890123456789012345678901234');

console.log(room1 === room2); // true
// Both produce: "launchpad:0xabcdef1234567890123456789012345678901234"
```

## Multi-Chain Support

The room strategy supports multi-chain scenarios:

```typescript
// Broadcast to all chains
websocketManager.broadcastToRoom(
  roomStrategy.getHomepageRoom(),
  'mint',
  mintData
);

// Broadcast to specific chain only
websocketManager.broadcastToRoom(
  roomStrategy.getHomepageRoom(137), // Polygon only
  'mint',
  mintData
);

// Broadcast to specific launchpad (chain-agnostic at room level)
websocketManager.broadcastToRoom(
  roomStrategy.getLaunchpadRoom(contractAddress),
  'mint',
  mintData
);
```
