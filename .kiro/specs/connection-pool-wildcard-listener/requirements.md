# Requirements Document: Connection Pool Wildcard Listener Implementation

## Introduction

This feature refactors the blockchain event listening system to use a WebSocket Connection Pool with wildcard listeners instead of individual event listeners. This enables unlimited scaling by reducing the number of concurrent subscriptions from 20+ per launchpad to 1 per launchpad.

## Glossary

- **Connection_Pool**: A pool of WebSocket connections that manages multiple launchpad contracts, with each connection supporting up to 180 launchpads
- **Wildcard_Listener**: A single event listener that captures all events from a contract using `contract.on('*', handler)` instead of individual event listeners
- **Activity_Listener**: The main class responsible for listening to blockchain events from launchpad contracts
- **Launchpad_Contract**: An NFT launchpad smart contract that emits various events (Transfer, Burned, Airdropped, etc.)
- **Event_Router**: A method that routes wildcard events to appropriate event handlers based on event name

## Requirements

### Requirement 1: Replace Individual Event Listeners with Wildcard Listener

**User Story:** As a developer, I want to use wildcard listeners instead of individual event listeners, so that I can reduce the number of concurrent subscriptions and support unlimited launchpads.

#### Acceptance Criteria

1. WHEN a launchpad is added, THE Activity_Listener SHALL register exactly one wildcard listener per launchpad contract
2. WHEN a wildcard event is received, THE Activity_Listener SHALL route it to the appropriate event handler based on event name
3. THE Activity_Listener SHALL NOT register individual event listeners for Transfer, Burned, Airdropped, or any other event types
4. WHEN the service starts with 2 launchpads, THE system SHALL create exactly 2 wildcard subscriptions (not 40+ individual subscriptions)

### Requirement 2: Integrate with WebSocket Connection Pool

**User Story:** As a system administrator, I want launchpads to be distributed across connection pool connections, so that I can scale to thousands of launchpads without hitting concurrent request limits.

#### Acceptance Criteria

1. WHEN a launchpad is added, THE Activity_Listener SHALL assign it to a connection from the Connection_Pool
2. WHEN a connection reaches 180 launchpads, THE Connection_Pool SHALL create a new connection for additional launchpads
3. WHEN a launchpad is removed, THE Activity_Listener SHALL remove it from the Connection_Pool
4. THE Connection_Pool SHALL maintain statistics showing total connections, total launchpads, and utilization percentage

### Requirement 3: Maintain Event Handler Compatibility

**User Story:** As a developer, I want existing event handlers to continue working without modification, so that I don't need to refactor the entire event handling system.

#### Acceptance Criteria

1. WHEN a wildcard event is routed, THE Event_Router SHALL call the same event handler methods that were previously called by individual listeners
2. WHEN a Transfer event is received, THE Event_Router SHALL call handleMintEvent with the same parameters
3. WHEN a Burned event is received, THE Event_Router SHALL call handleBurnedEvent with the same parameters
4. FOR ALL event types (Transfer, Burned, Airdropped, PhaseAdded, etc.), THE Event_Router SHALL maintain backward compatibility with existing handlers

### Requirement 4: Preserve Event Filtering and Validation

**User Story:** As a developer, I want event filtering and validation to continue working, so that only valid events from the correct block range are processed.

#### Acceptance Criteria

1. WHEN a wildcard event is received, THE Activity_Listener SHALL validate the event log structure before processing
2. WHEN an event's block number is less than the starting block, THE Activity_Listener SHALL skip processing that event
3. WHEN an event has invalid data (missing blockNumber, transactionHash, etc.), THE Activity_Listener SHALL log a warning and skip processing
4. THE Activity_Listener SHALL continue to respect the isEventEnabled configuration for each event type

### Requirement 5: Update Logging to Reflect Connection Pool Usage

**User Story:** As a system administrator, I want clear logging that shows connection pool statistics, so that I can monitor system health and scaling.

#### Acceptance Criteria

1. WHEN a launchpad is added, THE system SHALL log which connection it was assigned to and the current launchpad count for that connection
2. WHEN a wildcard listener is registered, THE system SHALL log the launchpad address, connection number, and starting block
3. WHEN the service starts, THE system SHALL log "Using WebSocket Connection Pool for unlimited launchpads"
4. AFTER each launchpad addition, THE system SHALL log pool statistics showing total launchpads, total connections, and utilization percentage

### Requirement 6: Handle Connection Pool Lifecycle

**User Story:** As a developer, I want the connection pool to be properly initialized and cleaned up, so that there are no resource leaks.

#### Acceptance Criteria

1. WHEN the Activity_Listener starts, THE Connection_Pool SHALL be initialized with the WebSocket provider
2. WHEN the Activity_Listener stops, THE Connection_Pool SHALL be properly cleaned up and all connections closed
3. WHEN a launchpad is removed, THE Activity_Listener SHALL remove the wildcard listener and update the Connection_Pool
4. THE Connection_Pool SHALL handle reconnection automatically when a WebSocket connection drops
