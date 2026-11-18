# Design Document: Multiple RPC Configuration System

## Overview

This design document outlines the implementation of a multiple RPC configuration system for the blockchain indexer. The system will enable each supported blockchain network to utilize multiple RPC endpoints with automatic failover, health monitoring, and flexible load balancing strategies.

The current implementation uses a single RPC endpoint per chain, creating a single point of failure. The new system will provide resilience through multiple RPC providers while maintaining backward compatibility with existing code.

### Key Features

- Multiple RPC endpoints per chain with priority ordering
- Automatic failover when primary endpoints fail
- Continuous health monitoring of all endpoints
- Flexible selection strategies (priority-based, round-robin, random)
- Runtime endpoint management (enable/disable)
- Comprehensive logging and metrics
- Backward compatible with existing code

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│  (MultiChainListenerManager, ActivityListener, etc.)        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              RPC Connection Manager                          │
│  - Provider Pool Management                                  │
│  - Health Monitoring                                         │
│  - Failover Logic                                           │
│  - Load Balancing                                           │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   ┌────────┐  ┌────────┐  ┌────────┐
   │ RPC #1 │  │ RPC #2 │  │ RPC #3 │
   │(Tatum) │  │(Timothy)│  │(Alchemy)│
   └────────┘  └────────┘  └────────┘
```

### Component Interaction Flow

```
1. Application requests provider
   ↓
2. Connection Manager selects healthy endpoint
   ↓
3. Returns wrapped provider with failover
   ↓
4. Application makes RPC calls
   ↓
5. If call fails → Connection Manager tries next endpoint
   ↓
6. Health monitor updates endpoint status
```

## Components and Interfaces

### 1. Enhanced Chain Configuration

**File**: `src/config/chains.ts`

```typescript
export interface RPCEndpoint {
  url: string;
  priority: number;        // Lower number = higher priority
  weight?: number;         // For weighted load balancing
  enabled: boolean;        // Can be disabled at runtime
  healthStatus: 'healthy' | 'unhealthy' | 'unknown';
  lastHealthCheck?: Date;
  failureCount: number;
  successCount: number;
  averageResponseTime?: number;
}

export interface ChainConfig {
  id: number;
  name: string;
  network: string;
  rpcEndpoints: RPCEndpoint[];  // NEW: Multiple endpoints
  rpcUrl: string;               // MODIFIED: Computed property for backward compatibility
  blockExplorer: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  launchpadFactoryAddress?: string;
  oddsTemplateAddress?: string;
  isTestnet: boolean;
  icon: string;
  blockTime?: number;
  rpcStrategy?: 'priority' | 'round-robin' | 'random' | 'weighted';  // NEW: Strategy selection
}
```

**Key Changes**:

1. **New `rpcEndpoints` array**: Replaces single `rpcUrl` as the source of truth
2. **Backward compatible `rpcUrl`**: Implemented as a getter that returns the primary (highest priority) endpoint URL
3. **New `rpcStrategy` field**: Allows per-chain strategy configuration
4. **RPCEndpoint interface**: Encapsulates all endpoint-related state and metadata

**Backward Compatibility**:

Existing code that accesses `chainConfig.rpcUrl` will continue to work:

```typescript
// Old code (still works)
const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);

// New code (recommended)
const connectionManager = new RPCConnectionManager({
  chainId: chainConfig.id,
  endpoints: chainConfig.rpcEndpoints,
  strategy: chainConfig.rpcStrategy || 'priority',
  // ... other config
});
const provider = await connectionManager.getProvider();
```

### 2. RPC Connection Manager

**File**: `src/lib/blockchain/rpc-connection-manager.ts`

```typescript
export interface ConnectionManagerConfig {
  chainId: number;
  endpoints: RPCEndpoint[];
  strategy: 'priority' | 'round-robin' | 'random' | 'weighted';
  healthCheckInterval: number;  // milliseconds
  unhealthyCooldown: number;    // milliseconds
  maxRetries: number;
  retryDelay: number;          // milliseconds
}

export interface ProviderMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  lastUsed: Date;
}

export class RPCConnectionManager {
  private config: ConnectionManagerConfig;
  private providers: Map<string, ethers.Provider>;
  private metrics: Map<string, ProviderMetrics>;
  private currentIndex: number;  // For round-robin
  private healthCheckInterval?: NodeJS.Timeout;
  
  constructor(config: ConnectionManagerConfig);
  
  // Provider management
  async getProvider(): Promise<ethers.Provider>;
  async getProviderForEndpoint(url: string): Promise<ethers.Provider>;
  
  // Health monitoring
  async performHealthCheck(endpoint: RPCEndpoint): Promise<boolean>;
  async performAllHealthChecks(): Promise<void>;
  startHealthMonitoring(): void;
  stopHealthMonitoring(): void;
  
  // Endpoint selection strategies
  private selectEndpointPriority(): RPCEndpoint | null;
  private selectEndpointRoundRobin(): RPCEndpoint | null;
  private selectEndpointRandom(): RPCEndpoint | null;
  private selectEndpointWeighted(): RPCEndpoint | null;
  
  // Failover handling
  async executeWithFailover<T>(
    operation: (provider: ethers.Provider) => Promise<T>
  ): Promise<T>;
  
  // Runtime management
  async enableEndpoint(url: string): Promise<void>;
  async disableEndpoint(url: string): Promise<void>;
  
  // Metrics and status
  getEndpointStatus(): RPCEndpoint[];
  getMetrics(): Map<string, ProviderMetrics>;
  getHealthyEndpointCount(): number;
}
```

### 3. Resilient Provider Wrapper

**File**: `src/lib/blockchain/resilient-provider.ts`

```typescript
export class ResilientProvider extends ethers.Provider {
  private connectionManager: RPCConnectionManager;
  private currentProvider: ethers.Provider;
  
  constructor(connectionManager: RPCConnectionManager);
  
  // Override ethers.Provider methods to add failover
  async getBlockNumber(): Promise<number>;
  async getBlock(blockHashOrBlockTag: BlockTag): Promise<Block>;
  async getTransaction(hash: string): Promise<TransactionResponse>;
  async call(transaction: TransactionRequest): Promise<string>;
  async estimateGas(transaction: TransactionRequest): Promise<bigint>;
  async sendTransaction(signedTransaction: string): Promise<TransactionResponse>;
  
  // Event handling with failover
  on(event: EventFilter | string, listener: Listener): this;
  off(event: EventFilter | string, listener?: Listener): this;
  
  // Internal failover logic
  private async executeWithRetry<T>(
    operation: (provider: ethers.Provider) => Promise<T>
  ): Promise<T>;
}
```

### 4. Configuration Parser

**File**: `src/config/rpc-config-parser.ts`

```typescript
export class RPCConfigParser {
  /**
   * Parse environment variables into RPCEndpoint array
   * Supports comma-separated URLs with optional priority
   * Example: "url1:1,url2:2,url3:3" or "url1,url2,url3"
   */
  static parseRPCUrls(envValue: string): RPCEndpoint[];
  
  /**
   * Parse chain configuration from environment
   */
  static parseChainConfig(chainId: number): ChainConfig;
  
  /**
   * Get default endpoints for a chain
   */
  static getDefaultEndpoints(chainId: number): RPCEndpoint[];
  
  /**
   * Validate endpoint configuration
   */
  static validateEndpoints(endpoints: RPCEndpoint[]): void;
  
  /**
   * Merge environment config with defaults
   */
  static mergeWithDefaults(
    envEndpoints: RPCEndpoint[],
    defaultEndpoints: RPCEndpoint[]
  ): RPCEndpoint[];
}
```

**Parsing Logic**:

The parser supports multiple formats for RPC URL configuration:

1. **Simple comma-separated URLs**: `url1,url2,url3`
   - Priority assigned based on order (1, 2, 3, ...)
   
2. **URLs with explicit priority**: `url1:1,url2:2,url3:3`
   - Priority explicitly specified after colon
   
3. **Mixed format**: `url1:1,url2,url3:5`
   - Some URLs with priority, others without
   - URLs without priority get auto-assigned priority

**Example Parsing**:

```typescript
// Input: "https://rpc1.com,https://rpc2.com,https://rpc3.com"
// Output: [
//   { url: "https://rpc1.com", priority: 1, enabled: true, ... },
//   { url: "https://rpc2.com", priority: 2, enabled: true, ... },
//   { url: "https://rpc3.com", priority: 3, enabled: true, ... }
// ]

// Input: "https://rpc1.com:10,https://rpc2.com:5,https://rpc3.com:1"
// Output: [
//   { url: "https://rpc3.com", priority: 1, enabled: true, ... },
//   { url: "https://rpc2.com", priority: 5, enabled: true, ... },
//   { url: "https://rpc1.com", priority: 10, enabled: true, ... }
// ]
```

## Data Models

### RPCEndpoint State Machine

```
┌─────────┐
│ Unknown │ (Initial state)
└────┬────┘
     │
     ▼
┌─────────┐  Health Check Success  ┌─────────┐
│ Healthy │◄──────────────────────│Unhealthy│
└────┬────┘                        └────┬────┘
     │                                  │
     │  Health Check Failure            │
     └──────────────────────────────────┘
     
     
Manual Disable → Disabled State (not shown in health checks)
```

### Configuration Priority

1. Environment variables (highest priority)
2. Default configuration in code
3. Fallback to single RPC (backward compatibility)

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Endpoint Selection Always Returns Healthy Endpoint

*For any* chain configuration with multiple RPC endpoints, when at least one endpoint is healthy, the Connection Manager should always return a healthy endpoint when getProvider() is called.

**Validates: Requirements 2.1, 2.3, 2.5**

**Rationale**: This ensures that the system never attempts to use an endpoint that is known to be unhealthy, preventing unnecessary failures and delays.

### Property 2: Failover Preserves Request Semantics

*For any* RPC operation, if the operation fails on one endpoint and succeeds on another, the result should be equivalent to what would have been returned if the first endpoint had succeeded.

**Validates: Requirements 2.1, 5.2, 5.4**

**Rationale**: Failover should be transparent to the caller - switching endpoints mid-operation should not change the semantics or results of blockchain queries.

### Property 3: Health Status Transitions Are Monotonic Within Check Cycle

*For any* RPC endpoint, during a single health check cycle, the health status should transition at most once (unknown→healthy, unknown→unhealthy, healthy→unhealthy, or unhealthy→healthy).

**Validates: Requirements 3.3, 3.4**

**Rationale**: This prevents rapid status oscillation that could cause instability in endpoint selection.

### Property 4: Priority Strategy Respects Ordering

*For any* chain configuration using priority-based strategy, when multiple healthy endpoints exist, the Connection Manager should always select the endpoint with the lowest priority number.

**Validates: Requirements 1.2, 6.2**

**Rationale**: Priority-based selection must be deterministic and respect the configured ordering to ensure predictable behavior.

### Property 5: Round-Robin Strategy Distributes Evenly

*For any* chain configuration using round-robin strategy with N healthy endpoints, after N consecutive requests, each healthy endpoint should have been selected exactly once.

**Validates: Requirements 6.3**

**Rationale**: Round-robin should distribute load evenly across all healthy endpoints to prevent overloading any single provider.

### Property 6: Disabled Endpoints Are Never Selected

*For any* RPC endpoint that is manually disabled, the Connection Manager should never select it for requests, regardless of its health status.

**Validates: Requirements 8.1, 8.4**

**Rationale**: Manual disable should take precedence over automatic health checks to allow operators to control endpoint usage.

### Property 7: Configuration Parsing Is Idempotent

*For any* valid environment variable string representing RPC URLs, parsing it multiple times should produce identical RPCEndpoint arrays.

**Validates: Requirements 1.4**

**Rationale**: Configuration parsing should be deterministic and repeatable to ensure consistent system behavior across restarts.

### Property 8: Backward Compatibility Preserved

*For any* existing code that accesses chainConfig.rpcUrl, the returned value should be a valid RPC URL that can be used to create a working provider.

**Validates: Requirements 5.3**

**Rationale**: Existing code should continue to work without modification, ensuring smooth migration to the new system.

### Property 9: Health Check Cooldown Prevents Premature Retry

*For any* unhealthy endpoint with a configured cooldown period, the Connection Manager should not attempt to use that endpoint until the cooldown period has elapsed.

**Validates: Requirements 2.5**

**Rationale**: Cooldown periods prevent overwhelming failing endpoints with repeated requests and allow time for recovery.

### Property 10: At Least One Endpoint Required

*For any* chain configuration, the system should ensure at least one RPC endpoint is configured, either from environment variables or default configuration.

**Validates: Requirements 1.5, 4.5**

**Rationale**: The system cannot function without at least one RPC endpoint per chain, so this must be validated at initialization.

### Property 11: Endpoint State Transitions Are Valid

*For any* RPC endpoint, all health status transitions should follow valid state machine paths: unknown→healthy, unknown→unhealthy, healthy→unhealthy, unhealthy→healthy, or any→disabled.

**Validates: Requirements 2.3, 2.4, 3.3, 3.4**

**Rationale**: Invalid state transitions could lead to inconsistent behavior and should be prevented.

### Property 12: Strategy Selection Is Deterministic

*For any* chain configuration with a specified strategy, multiple calls to the strategy selection logic with the same healthy endpoint set should produce results consistent with that strategy's rules.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

**Rationale**: Strategy selection must be predictable and follow documented behavior to ensure reliable load distribution.

### Property 13: Logging Captures All State Changes

*For any* significant state change (endpoint selection, failure, health status change, manual enable/disable), the Connection Manager should emit a log entry with relevant context.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

**Rationale**: Comprehensive logging is essential for debugging and monitoring the system's behavior.

### Property 14: Metrics Reflect Actual Usage

*For any* RPC endpoint, the success and failure counts in metrics should equal the sum of all successful and failed operations performed through that endpoint.

**Validates: Requirements 7.5**

**Rationale**: Accurate metrics are essential for monitoring and optimization decisions.

### Property 15: Manual Disable Overrides Health Status

*For any* RPC endpoint that is manually disabled, it should not be selected for requests even if its health status is healthy.

**Validates: Requirements 8.1, 8.3, 8.4**

**Rationale**: Manual control should take precedence over automatic health checks to allow operators to override system decisions.

## Error Handling

### Error Categories

1. **Configuration Errors**
   - Missing RPC URLs for a chain
   - Invalid URL format
   - Duplicate endpoint URLs
   - Invalid priority values

2. **Runtime Errors**
   - All endpoints unhealthy
   - Network connectivity issues
   - RPC provider rate limiting
   - Invalid RPC responses

3. **Health Check Errors**
   - Timeout during health check
   - Connection refused
   - Invalid response format

### Error Handling Strategies

#### Configuration Validation

```typescript
// At startup, validate all chain configurations
for (const chainId of getSupportedChainIds()) {
  const config = getChainConfig(chainId);
  if (!config.rpcEndpoints || config.rpcEndpoints.length === 0) {
    throw new Error(`No RPC endpoints configured for chain ${chainId}`);
  }
  
  // Validate URL format
  for (const endpoint of config.rpcEndpoints) {
    try {
      new URL(endpoint.url);
    } catch (error) {
      throw new Error(`Invalid RPC URL for chain ${chainId}: ${endpoint.url}`);
    }
  }
}
```

#### Failover Error Handling

```typescript
async executeWithFailover<T>(
  operation: (provider: ethers.Provider) => Promise<T>
): Promise<T> {
  const errors: Error[] = [];
  
  for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
    const endpoint = this.selectEndpoint();
    
    if (!endpoint) {
      // No healthy endpoints available
      if (attempt < this.config.maxRetries - 1) {
        await this.sleep(this.config.retryDelay * Math.pow(2, attempt));
        await this.performAllHealthChecks(); // Re-check all endpoints
        continue;
      }
      throw new Error(
        `All RPC endpoints failed for chain ${this.config.chainId}. ` +
        `Errors: ${errors.map(e => e.message).join(', ')}`
      );
    }
    
    try {
      const provider = await this.getProviderForEndpoint(endpoint.url);
      const result = await operation(provider);
      
      // Success - update metrics
      this.updateMetrics(endpoint.url, true);
      return result;
      
    } catch (error) {
      errors.push(error as Error);
      this.updateMetrics(endpoint.url, false);
      this.markEndpointUnhealthy(endpoint.url);
      
      console.warn(
        `RPC request failed on ${endpoint.url} (attempt ${attempt + 1}/${this.config.maxRetries}):`,
        error
      );
      
      if (attempt < this.config.maxRetries - 1) {
        await this.sleep(this.config.retryDelay);
      }
    }
  }
  
  throw new Error(`Failed after ${this.config.maxRetries} attempts`);
}
```

#### Health Check Error Handling

```typescript
async performHealthCheck(endpoint: RPCEndpoint): Promise<boolean> {
  try {
    const provider = await this.getProviderForEndpoint(endpoint.url);
    
    // Simple health check: get latest block number with timeout
    const blockNumberPromise = provider.getBlockNumber();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Health check timeout')), 5000)
    );
    
    await Promise.race([blockNumberPromise, timeoutPromise]);
    
    return true;
    
  } catch (error) {
    console.warn(`Health check failed for ${endpoint.url}:`, error);
    return false;
  }
}
```

### Logging Strategy

All errors should be logged with appropriate context:

- **Error Level**: All endpoints failed, configuration errors
- **Warn Level**: Individual endpoint failures, health check failures
- **Info Level**: Successful failover, endpoint recovery
- **Debug Level**: Endpoint selection, metrics updates

## Testing Strategy

### Unit Testing

Unit tests will verify specific behaviors and edge cases:

1. **Configuration Parsing Tests**
   - Parse single URL
   - Parse multiple comma-separated URLs
   - Parse URLs with priority notation (url:priority)
   - Handle malformed input gracefully
   - Validate default endpoints

2. **Endpoint Selection Tests**
   - Priority strategy selects lowest priority healthy endpoint
   - Round-robin cycles through endpoints
   - Random strategy selects from healthy endpoints
   - Weighted strategy respects weights
   - Disabled endpoints are skipped

3. **Health Check Tests**
   - Successful health check marks endpoint healthy
   - Failed health check marks endpoint unhealthy
   - Cooldown period prevents premature retry
   - Health check timeout handling

4. **Failover Tests**
   - Failover to next endpoint on error
   - All endpoints exhausted throws error
   - Successful retry after failure
   - Metrics updated correctly

5. **Backward Compatibility Tests**
   - chainConfig.rpcUrl returns primary endpoint
   - Existing code works without modification

### Property-Based Testing

Property-based tests will verify universal properties across many inputs using **fast-check** library (minimum 100 iterations per test):

1. **Property Test: Endpoint Selection Consistency**
   - Generate random chain configurations with varying numbers of healthy/unhealthy endpoints
   - Verify that getProvider() always returns a healthy endpoint when one exists
   - **Validates: Property 1**

2. **Property Test: Priority Ordering**
   - Generate random endpoint configurations with different priorities
   - Verify that priority strategy always selects the lowest priority healthy endpoint
   - **Validates: Property 4**

3. **Property Test: Round-Robin Distribution**
   - Generate random endpoint configurations
   - Make N requests and verify each healthy endpoint is selected exactly once
   - **Validates: Property 5**

4. **Property Test: Configuration Parsing Idempotence**
   - Generate random valid RPC URL strings
   - Parse multiple times and verify identical results
   - **Validates: Property 7**

5. **Property Test: Disabled Endpoint Exclusion**
   - Generate random endpoint configurations with some disabled
   - Verify disabled endpoints are never selected regardless of health status
   - **Validates: Property 6**

6. **Property Test: Cooldown Enforcement**
   - Generate random endpoint configurations with failures
   - Verify unhealthy endpoints are not retried before cooldown expires
   - **Validates: Property 9**

### Integration Testing

Integration tests will verify the system works end-to-end:

1. **Multi-Chain Listener Integration**
   - Start listeners with multiple RPC endpoints
   - Verify events are received correctly
   - Simulate endpoint failure and verify failover

2. **Real RPC Provider Testing**
   - Test against actual RPC providers (Tatum, Timothy, Alchemy)
   - Verify all endpoints work correctly
   - Test failover with real network conditions

3. **Metrics and Monitoring**
   - Verify metrics are collected correctly
   - Test health monitoring over time
   - Verify logging output

### Testing Framework

- **Unit Tests**: Vitest (existing framework)
- **Property-Based Tests**: fast-check
- **Mocking**: Vitest mocking capabilities for ethers.Provider
- **Test Configuration**: Separate test configuration with mock endpoints

## Implementation Notes

### Design Decisions and Rationales

1. **Backward Compatibility via rpcUrl Property**
   - **Decision**: Keep `rpcUrl` as a computed property that returns the primary endpoint
   - **Rationale**: Allows existing code to work without modification while new code can use `rpcEndpoints` array
   - **Trade-off**: Slight API complexity, but worth it for smooth migration

2. **Health Check Strategy**
   - **Decision**: Use simple `getBlockNumber()` call for health checks
   - **Rationale**: Lightweight, fast, and reliable indicator of endpoint health
   - **Alternative Considered**: More complex checks (getBlock, getTransaction) - rejected as too heavy

3. **Failover at Connection Manager Level**
   - **Decision**: Implement failover in Connection Manager rather than wrapping every provider method
   - **Rationale**: Centralized logic, easier to maintain, consistent behavior
   - **Trade-off**: Requires explicit use of `executeWithFailover` for operations

4. **Priority-Based Default Strategy**
   - **Decision**: Default to priority-based selection
   - **Rationale**: Most predictable behavior, aligns with common use case of primary/backup endpoints
   - **Alternative**: Round-robin could distribute load better but less predictable

5. **Separate Health Monitoring Thread**
   - **Decision**: Run health checks on interval independent of request flow
   - **Rationale**: Proactive detection of endpoint recovery, doesn't slow down requests
   - **Trade-off**: Additional background processing, but minimal overhead

6. **MegaETH Endpoint Priority Order**
   - **Decision**: Tatum → Timothy → Alchemy
   - **Rationale**: Based on reliability testing and provider recommendations
   - **Note**: Can be overridden via environment variables

### MegaETH Specific Configuration

The MegaETH chain (chainId: 6343) will be configured with three RPC endpoints in priority order:

1. **Tatum Gateway** (Priority 1): `https://megaeth-carrot.gateway.tatum.io`
   - Primary endpoint
   - Reliable and well-tested
   
2. **Timothy RPC** (Priority 2): `https://timothy.megaeth.com/rpc`
   - Secondary endpoint
   - MegaETH-specific provider
   
3. **Alchemy** (Priority 3): `https://megaeth-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY`
   - Tertiary endpoint
   - Existing endpoint, kept for backward compatibility

This configuration can be overridden via the `MEGAETH_RPC_URL` environment variable using comma-separated URLs with optional priority notation:

```bash
# With explicit priorities
MEGAETH_RPC_URL="https://megaeth-carrot.gateway.tatum.io:1,https://timothy.megaeth.com/rpc:2,https://megaeth-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY:3"

# Without priorities (uses order as priority)
MEGAETH_RPC_URL="https://megaeth-carrot.gateway.tatum.io,https://timothy.megaeth.com/rpc,https://megaeth-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY"
```

### Migration Path

1. **Phase 1**: Add new configuration structure alongside existing
2. **Phase 2**: Update Connection Manager to use multiple endpoints
3. **Phase 3**: Update chain configs with multiple endpoints (starting with MegaETH)
4. **Phase 4**: Monitor and optimize based on metrics
5. **Phase 5**: (Optional) Remove backward compatibility layer

### Performance Considerations

- Health checks run every 30 seconds (configurable)
- Failed endpoints have 60-second cooldown (configurable)
- Provider instances are cached and reused
- Metrics collection has minimal overhead
- Round-robin uses simple counter (O(1) selection)

### Security Considerations

- RPC URLs may contain API keys - ensure proper logging sanitization
- Validate all URLs to prevent injection attacks
- Rate limiting should be handled at provider level
- No sensitive data in metrics or logs

## Monitoring and Observability

### Metrics to Track

1. **Per-Endpoint Metrics**
   - Total requests
   - Successful requests
   - Failed requests
   - Average response time
   - Current health status
   - Last health check timestamp
   - Consecutive failure count

2. **Per-Chain Metrics**
   - Total failover events
   - Number of healthy endpoints
   - Current active endpoint
   - Strategy in use

3. **System-Wide Metrics**
   - Total RPC requests across all chains
   - Overall success rate
   - Average failover time

### Health Check Dashboard

The system should expose endpoint status via a query interface:

```typescript
interface EndpointStatus {
  url: string;
  priority: number;
  enabled: boolean;
  healthStatus: 'healthy' | 'unhealthy' | 'unknown';
  lastHealthCheck: Date;
  metrics: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    successRate: number;
    averageResponseTime: number;
  };
}

interface ChainStatus {
  chainId: number;
  chainName: string;
  strategy: string;
  endpoints: EndpointStatus[];
  healthyEndpointCount: number;
  currentEndpoint: string;
}
```

### Log Levels and Messages

**ERROR Level**:
- All endpoints failed for a chain
- Configuration validation errors
- Critical failover failures

**WARN Level**:
- Individual endpoint failure
- Health check failure
- Endpoint marked unhealthy
- Retry attempts

**INFO Level**:
- Endpoint marked healthy after recovery
- Successful failover
- Manual endpoint enable/disable
- Health check status changes

**DEBUG Level**:
- Endpoint selection details
- Strategy execution details
- Metrics updates
- Individual request routing

### Example Log Output

```
[INFO] RPC Connection Manager initialized for chain 6343 (MegaETH Testnet V2) with 3 endpoints
[DEBUG] Selected endpoint https://megaeth-carrot.gateway.tatum.io (priority: 1, strategy: priority)
[WARN] RPC request failed on https://megaeth-carrot.gateway.tatum.io: Network timeout
[INFO] Failover: https://megaeth-carrot.gateway.tatum.io → https://timothy.megaeth.com/rpc
[DEBUG] Request succeeded on https://timothy.megaeth.com/rpc (response time: 245ms)
[WARN] Health check failed for https://megaeth-carrot.gateway.tatum.io
[INFO] Endpoint https://megaeth-carrot.gateway.tatum.io marked unhealthy (cooldown: 60s)
[INFO] Endpoint https://megaeth-carrot.gateway.tatum.io recovered, marked healthy
```

