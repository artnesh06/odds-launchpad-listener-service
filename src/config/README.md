# Configuration Files

This directory contains configuration modules for the NFT Listener Service.

## blockchain.ts

Blockchain event monitoring configuration with support for both WebSocket and polling mechanisms.

### Features

- **Hybrid Event Monitoring**: Supports both WebSocket (real-time) and polling mechanisms
- **Feature Flag Control**: Global enable/disable for WebSocket listening
- **Reconnection Management**: Configurable exponential backoff for WebSocket reconnections
- **Validation**: Comprehensive configuration validation with detailed error messages

### Environment Variables

#### WebSocket Configuration

- `WEBSOCKET_ENABLED` (default: `false`)
  - Enable/disable WebSocket listening for real-time mint events
  - Set to `true` to enable WebSocket connections for featured launchpads

- `WEBSOCKET_PROVIDER_URL` (required when enabled)
  - WebSocket provider URL for blockchain connection
  - Must use `wss://` protocol for secure connections
  - Example: `wss://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY`

- `WEBSOCKET_MAX_RECONNECT_ATTEMPTS` (default: `10`)
  - Maximum number of reconnection attempts before alerting
  - Must be at least 1

- `WEBSOCKET_RECONNECT_BASE_DELAY` (default: `1000`)
  - Base delay for exponential backoff in milliseconds
  - Must be at least 100ms

- `WEBSOCKET_RECONNECT_MAX_DELAY` (default: `30000`)
  - Maximum delay between reconnection attempts in milliseconds
  - Must be greater than or equal to base delay

#### Polling Configuration

- `POLLING_INTERVAL` (default: `5000`)
  - Polling interval for non-WebSocket events in milliseconds
  - Must be at least 1000ms to avoid excessive load

- `POLLING_BATCH_SIZE` (default: `100`)
  - Batch size for polling queries
  - Must be between 1 and 1000

### Usage

```typescript
import { getBlockchainConfig, logBlockchainConfigStatus } from './config/blockchain';

// Get validated configuration
const config = getBlockchainConfig();

// Log configuration status on startup
logBlockchainConfigStatus(config);

// Access configuration values
if (config.websocket.enabled) {
  console.log('WebSocket provider:', config.websocket.providerUrl);
  console.log('Max reconnection attempts:', config.websocket.reconnection.maxAttempts);
}

console.log('Polling interval:', config.polling.interval);
console.log('Polling batch size:', config.polling.batchSize);
```

### Configuration Validation

The configuration is automatically validated when calling `getBlockchainConfig()`. If validation fails, a `ConfigurationError` is thrown with detailed error messages.

**Validation Rules:**

When WebSocket is enabled:
- `WEBSOCKET_PROVIDER_URL` must be set
- Provider URL must use `wss://` protocol
- `maxAttempts` must be at least 1
- `baseDelay` must be at least 100ms
- `maxDelay` must be >= `baseDelay`

Always validated:
- `POLLING_INTERVAL` must be at least 1000ms
- `POLLING_BATCH_SIZE` must be between 1 and 1000

### Example .env Configuration

```bash
# Enable WebSocket listening for featured launchpads
WEBSOCKET_ENABLED="true"

# WebSocket provider URL (Alchemy example)
WEBSOCKET_PROVIDER_URL="wss://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY"

# Reconnection configuration
WEBSOCKET_MAX_RECONNECT_ATTEMPTS="10"
WEBSOCKET_RECONNECT_BASE_DELAY="1000"
WEBSOCKET_RECONNECT_MAX_DELAY="30000"

# Polling configuration
POLLING_INTERVAL="5000"
POLLING_BATCH_SIZE="100"
```

### Testing

Run tests for the blockchain configuration:

```bash
npm test -- src/config/__tests__/blockchain.test.ts
```

## Other Configuration Files

- **chains.ts**: Supported blockchain networks and their configurations
- **database.ts**: Database connection and Prisma client management
- **marketplace-contracts.ts**: Marketplace contract addresses and configurations
- **swagger.ts**: API documentation configuration
- **websocket.ts**: WebSocket server configuration for Socket.IO
