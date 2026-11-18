# Implementation Plan: Connection Pool Wildcard Listener

## Overview

This plan implements the refactoring from individual event listeners (20+ per launchpad) to wildcard listeners (1 per launchpad) with WebSocket Connection Pool integration. The implementation is broken down into discrete steps that build incrementally.

## Architecture Clarification

**Connection Pool Concept:**
- 1 launchpad = 1 wildcard subscription (instead of 20+ individual subscriptions)
- 1 WebSocket connection = 180 launchpads max (180 subscriptions per connection)
- Pool auto-scales: When connection reaches 180 launchpads, create new connection

**Scaling Example:**
```
Connection #0: 180 launchpads × 1 wildcard = 180 subscriptions
Connection #1: 180 launchpads × 1 wildcard = 180 subscriptions
Connection #2: 180 launchpads × 1 wildcard = 180 subscriptions
```

**Performance Impact:**
- Before: 2 launchpads × 20 events = 40 subscriptions (limit: ~10 launchpads per connection)
- After: 2 launchpads × 1 wildcard = 2 subscriptions (limit: 180 launchpads per connection)
- Reduction: 95% per launchpad!

## Tasks

- [x] 1. Replace addLaunchpad method with wildcard listener implementation
  - Open `src/lib/blockchain/activity-listener.ts`
  - Locate method `async addLaunchpad(launchpadAddress: string)` (around line 3406)
  - Delete entire method (from `async addLaunchpad` to closing `}` before `async removeLaunchpad`)
  - Copy implementation from `src/lib/blockchain/addLaunchpad-new.ts`
  - Paste into activity-listener.ts
  - Verify imports are correct (ethers, OddsLaunchpadABI)
  - _Requirements: 1.1, 1.2, 1.3, 2.1_

- [x] 2. Verify wildcard listener registration
  - Start service: `npm run dev`
  - Check logs for "🏊 Using WebSocket Connection Pool for unlimited launchpads"
  - Check logs for "🔍 Registering wildcard listener for 0x..."
  - Check logs for "📊 Pool: 2 launchpads across 1 connections (1.1% utilized)"
  - Verify NO logs like "✅ Listening to NEW Transfer events"
  - Verify NO logs like "✅ Listening to NEW Burned events"
  - Verify exactly 2 wildcard subscriptions (not 40 individual subscriptions)
  - _Requirements: 1.1, 1.4, 5.1, 5.2, 5.3, 5.4_

- [x] 3. Test event routing with real blockchain events
  - Trigger a Transfer event on one of the launchpads
  - Verify event is received by wildcard listener
  - Verify event is routed to handleMintEvent
  - Verify event is processed correctly (database updated)
  - Check logs for event processing confirmation
  - _Requirements: 1.2, 3.1, 3.2, 4.1, 4.2_

- [x] 4. Test connection pool statistics
  - Add 2 launchpads
  - Verify pool shows: "2 launchpads across 1 connections (1.1% utilized)"
  - Verify 2 wildcard subscriptions total (1 per launchpad)
  - Remove 1 launchpad
  - Verify pool shows: "1 launchpads across 1 connections (0.6% utilized)"
  - Verify 1 wildcard subscription remaining
  - _Requirements: 2.4_

- [x] 5. Checkpoint - Verify basic functionality
  - Ensure all tests pass
  - Ensure service starts without errors
  - Ensure events are being processed
  - Ask the user if questions arise

- [ ]* 6. Write unit tests for wildcard listener
  - [ ]* 6.1 Test wildcard listener registration
    - Create mock launchpad contract
    - Call addLaunchpad
    - Verify exactly 1 listener registered (not 20+)
    - _Requirements: 1.1_
  
  - [ ]* 6.2 Test event routing for Transfer events
    - Create mock Transfer event
    - Call routeEvent with event
    - Verify handleMintEvent is called
    - _Requirements: 3.2_
  
  - [ ]* 6.3 Test event routing for Burned events
    - Create mock Burned event
    - Call routeEvent with event
    - Verify handleBurnedEvent is called
    - _Requirements: 3.3_
  
  - [ ]* 6.4 Test invalid event structure handling
    - Create event with missing blockNumber
    - Process event
    - Verify warning is logged
    - Verify event is skipped
    - _Requirements: 4.3_
  
  - [ ]* 6.5 Test block number filtering
    - Create event with blockNumber < startingBlock
    - Process event
    - Verify event is skipped
    - _Requirements: 4.2_
  
  - [ ]* 6.6 Test disabled event type handling
    - Disable Transfer event type
    - Create Transfer event
    - Process event
    - Verify event is skipped
    - _Requirements: 4.4_

- [ ]* 7. Write property-based tests for wildcard listener
  - [ ]* 7.1 Property test: One wildcard listener per launchpad
    - **Property 1: One Wildcard Listener Per Launchpad**
    - **Validates: Requirements 1.1**
    - **Status: BLOCKED - Needs Prisma client regeneration**
    - Generate random launchpad addresses (10-50)
    - Add each to Activity_Listener
    - Verify exactly 1 subscription per launchpad
    - Verify total subscriptions = number of launchpads
  
  - [ ]* 7.2 Property test: Event routing correctness
    - **Property 2: Event Routing Correctness**
    - **Validates: Requirements 1.2, 3.1, 3.4**
    - Generate random events with different event names (Transfer, Burned, Airdropped, etc.)
    - Route each event
    - Verify correct handler method is called for each event type
    - Verify handler receives correct parameters
  
  - [ ]* 7.3 Property test: Connection pool assignment
    - **Property 3: Connection Pool Assignment**
    - **Validates: Requirements 2.1**
    - Generate random launchpad addresses (10-50)
    - Add each to Activity_Listener
    - Verify each is assigned to a valid connection
    - Verify assignment is tracked in pool
  
  - [ ]* 7.4 Property test: Pool statistics accuracy
    - **Property 4: Pool Statistics Accuracy**
    - **Validates: Requirements 2.4**
    - Generate random sequences of add/remove operations (20-100 operations)
    - Execute operations
    - After each operation, verify statistics match actual state
    - Verify totalLaunchpads, totalConnections, utilizationPercent are correct
  
  - [ ]* 7.5 Property test: Launchpad removal cleanup
    - **Property 5: Launchpad Removal Cleanup**
    - **Validates: Requirements 2.3, 6.3**
    - Generate random launchpad addresses (10-50)
    - Add each, then remove each
    - Verify removal from pool
    - Verify wildcard listener unregistered
    - Verify pool statistics updated correctly
  
  - [ ]* 7.6 Property test: Event validation before processing
    - **Property 6: Event Validation Before Processing**
    - **Validates: Requirements 4.1, 4.3**
    - Generate random events with valid and invalid structures
    - Process each event
    - Verify invalid events are skipped
    - Verify valid events are processed
  
  - [ ]* 7.7 Property test: Block number filtering
    - **Property 7: Block Number Filtering**
    - **Validates: Requirements 4.2**
    - Generate random events with various block numbers
    - Set starting block = 1000
    - Process events
    - Verify events with blockNumber < 1000 are skipped
    - Verify events with blockNumber >= 1000 are processed
  
  - [ ] 7.8 Property test: Event enable configuration respected

    - **Property 8: Event Enable Configuration Respected**
    - **Validates: Requirements 4.4**
    - Generate random events of different types
    - Enable/disable different event types randomly
    - Process events
    - Verify only enabled events are processed

- [x] 8. Test auto-scaling with 181 launchpads
  - Create script to add 181 launchpads
  - Run script
  - Verify 2 connections are created
  - Verify first connection has 180 launchpads (180 subscriptions)
  - Verify second connection has 1 launchpad (1 subscription)
  - Verify total: 181 subscriptions across 2 connections
  - Verify pool statistics show correct utilization
  - _Requirements: 2.2_

- [x] 9. Test connection reconnection
  - Start service with 2 launchpads
  - Simulate WebSocket connection drop
  - Verify auto-reconnect is triggered
  - Verify events continue to be processed after reconnect
  - Verify reconnect count is incremented
  - _Requirements: 6.4_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Run all unit tests: `npm test`
  - Run all property tests: `npm test -- --grep "Property"`
  - Verify service starts without errors
  - Verify events are being processed correctly
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (minimum 100 iterations each)
- Unit tests validate specific examples and edge cases
- The main implementation task is Task 1 (replace addLaunchpad method)
- Tasks 2-5 are verification and testing of the implementation
- Tasks 6-7 are comprehensive test coverage (optional for MVP)
- Tasks 8-10 are advanced testing and validation

## Key Concept Reminder

**1 launchpad = 1 wildcard subscription** (not 20+ individual subscriptions)
**1 connection = 180 launchpads max** (180 subscriptions per connection)
**Pool auto-scales:** When connection reaches 180 launchpads, create new connection

This means:
- 2 launchpads = 2 subscriptions (in 1 connection)
- 180 launchpads = 180 subscriptions (in 1 connection)
- 181 launchpads = 181 subscriptions (in 2 connections: 180 + 1)
- 360 launchpads = 360 subscriptions (in 2 connections: 180 + 180)
