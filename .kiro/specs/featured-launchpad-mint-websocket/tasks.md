# Implementation Plan: Featured Launchpad Mint WebSocket

## Overview

This implementation plan breaks down the feature into discrete coding tasks that build incrementally. The approach follows a phased strategy: database schema first, core components second, integration third, and testing throughout. Each task references specific requirements and includes testing sub-tasks to validate functionality early.

## Tasks

- [ ] 1. Database schema migration and models
  - [x] 1.1 Create Prisma migration for isFeatured field
    - Add `isFeatured Boolean @default(false)` to Launchpad model
    - Add index on isFeatured field
    - Generate and apply migration
    - _Requirements: 1.1, 1.2_
  
  - [x] 1.2 Create ProcessedEvent model for deduplication
    - Add ProcessedEvent model with transactionHash, logIndex, processedAt fields
    - Add unique constraint on (transactionHash, logIndex)
    - Add index on processedAt for cleanup queries
    - Generate and apply migration
    - _Requirements: 6.2_
  
  - [ ]* 1.3 Write property test for isFeatured default value
    - **Property 1: Default isFeatured Value**
    - **Validates: Requirements 1.2**
  
  - [ ]* 1.4 Write property test for isFeatured query filtering
    - **Property 2: Featured Status Query Filtering**
    - **Validates: Requirements 1.3**
  
  - [ ]* 1.5 Write property test for isFeatured validation
    - **Property 3: Boolean Validation for isFeatured**
    - **Validates: Requirements 1.4**

- [ ] 2. Configuration and environment setup
  - [x] 2.1 Create blockchain configuration file
    - Create `config/blockchain.ts` with WebSocket and polling configuration
    - Add environment variable definitions (WEBSOCKET_ENABLED, WEBSOCKET_PROVIDER_URL)
    - Implement configuration validation function
    - _Requirements: 7.1, 7.3_
  
  - [x] 2.2 Add configuration validation on startup
    - Call validateConfiguration() during application initialization
    - Log WebSocket feature status
    - Throw ConfigurationError if validation fails
    - _Requirements: 7.3_
  
  - [ ]* 2.3 Write unit tests for configuration validation
    - Test missing WEBSOCKET_PROVIDER_URL when enabled
    - Test invalid WebSocket URL format
    - Test invalid reconnection configuration
    - _Requirements: 7.1_

- [ ] 3. Implement EventProcessor with deduplication
  - [x] 3.1 Create EventProcessor class
    - Implement in-memory cache using Set for processed events
    - Implement isEventProcessed() method checking cache and database
    - Implement markEventProcessed() method updating cache and database
    - Implement processMintEvent() method with deduplication logic
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  
  - [x] 3.2 Add cache size management
    - Implement FIFO eviction when cache exceeds 10,000 entries
    - Ensure cache operations are efficient
    - _Requirements: 6.2_
  
  - [ ]* 3.3 Write property test for event deduplication
    - **Property 11: Event Deduplication Across Sources**
    - **Validates: Requirements 4.4, 6.3**
  
  - [ ]* 3.4 Write property test for event identity
    - **Property 16: Event Identity by Transaction Hash and Log Index**
    - **Validates: Requirements 6.2**
  
  - [ ]* 3.5 Write property test for handler routing consistency
    - **Property 15: WebSocket Events Routed to Existing Handler**
    - **Validates: Requirements 6.1, 6.4**

- [ ] 4. Implement WebSocketManager core functionality
  - [x] 4.1 Create WebSocketManager class structure
    - Create class with connections Map and provider properties
    - Implement constructor accepting WebSocketProvider and EventProcessor
    - Create ConnectionStatus interface
    - _Requirements: 2.1, 5.5_
  
  - [x] 4.2 Implement addListener method
    - Create ethers.Contract instance for launchpad address
    - Register 'Mint' event listener using contract.on()
    - Store connection reference in connections Map
    - Setup error handling for the connection
    - _Requirements: 2.1, 2.2, 5.2_
  
  - [x] 4.3 Implement removeListener method
    - Remove event listener from contract
    - Clean up connection from connections Map
    - Log connection removal
    - _Requirements: 4.2_
  
  - [x] 4.4 Implement initialize method
    - Query database for all featured launchpads (isFeatured=true)
    - Call addListener for each featured launchpad
    - Log initialization status
    - _Requirements: 2.4, 5.1_
  
  - [ ]* 4.5 Write property test for WebSocket establishment based on featured status
    - **Property 4: WebSocket Connection Establishment Based on Featured Status**
    - **Validates: Requirements 2.1, 2.3, 7.4**
  
  - [ ]* 4.6 Write property test for initialization
    - **Property 6: WebSocket Initialization on Startup**
    - **Validates: Requirements 2.4, 5.1**
  
  - [ ]* 4.7 Write property test for Mint-only listeners
    - **Property 12: WebSocket Listeners for Mint Events Only**
    - **Validates: Requirements 5.2**

- [x] 5. Checkpoint - Ensure core components work
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement WebSocket error handling and reconnection
  - [x] 6.1 Implement setupErrorHandling method
    - Register error handler on contract provider
    - Log errors with launchpad address context
    - Trigger reconnection on error
    - _Requirements: 2.5_
  
  - [x] 6.2 Implement handleReconnection method
    - Implement exponential backoff calculation (1s, 2s, 4s, 8s, 16s, max 30s)
    - Track reconnection attempts in connection status
    - Remove old listener and add new listener
    - Reset reconnection counter on success
    - Send alert if max attempts exceeded
    - _Requirements: 2.5, 5.3_
  
  - [x] 6.3 Implement getConnectionStatus method
    - Return ConnectionStatus for given launchpad address
    - Include isConnected, connectedAt, lastError, reconnectAttempts
    - _Requirements: 5.5_
  
  - [x] 6.4 Implement shutdown method
    - Iterate through all connections
    - Call removeListener for each connection
    - Clear connections Map
    - Log shutdown completion
    - _Requirements: 5.4_
  
  - [ ]* 6.5 Write property test for reconnection with exponential backoff
    - **Property 7: Reconnection on WebSocket Failure**
    - **Validates: Requirements 2.5, 5.3**
  
  - [ ]* 6.6 Write property test for graceful shutdown
    - **Property 13: Graceful Shutdown of WebSocket Connections**
    - **Validates: Requirements 5.4**
  
  - [ ]* 6.7 Write property test for connection registry accuracy
    - **Property 14: WebSocket Connection Registry Accuracy**
    - **Validates: Requirements 5.5**

- [x] 7. Implement LaunchpadService extension
  - [x] 7.1 Extend LaunchpadService with updateFeaturedStatus method
    - Accept launchpadId and isFeatured boolean parameters
    - Query current launchpad from database
    - Update isFeatured in database
    - Add WebSocket listener if changing to featured=true
    - Remove WebSocket listener if changing to featured=false
    - _Requirements: 4.2, 4.3_
  
  - [x] 7.2 Implement getFeaturedLaunchpads method
    - Query database for launchpads where isFeatured=true
    - Return array of Launchpad objects
    - _Requirements: 1.3_
  
  - [ ]* 7.3 Write property test for featured status transitions
    - **Property 10: Featured Status Transition Handling**
    - **Validates: Requirements 4.2, 4.3**
  
  - [ ]* 7.4 Write unit tests for LaunchpadService
    - Test updateFeaturedStatus with non-existent launchpad
    - Test getFeaturedLaunchpads returns correct results
    - _Requirements: 4.2, 4.3_

- [ ] 8. Integrate WebSocket system with event listener
  - [x] 8.1 Initialize WebSocketManager in event listener startup
    - Create WebSocketProvider instance from configuration
    - Instantiate WebSocketManager with provider and EventProcessor
    - Call initialize() method during event listener startup
    - Only initialize if WebSocket is globally enabled
    - _Requirements: 2.4, 7.2, 7.4_
  
  - [x] 8.2 Ensure polling continues for non-mint events
    - Verify existing polling logic remains unchanged
    - Verify Transfer, Marketplace, Activity events use polling
    - Verify non-featured launchpads use polling for all events
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 4.1_
  
  - [x] 8.3 Wire EventProcessor to existing mint event handler
    - Update EventProcessor.processMintEvent to call existing handler
    - Ensure event data format matches handler expectations
    - _Requirements: 6.1, 6.4_
  
  - [ ]* 8.4 Write property test for selective event handling
    - **Property 8: Mint Events Use WebSocket, Other Events Use Polling**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  
  - [ ]* 8.5 Write property test for non-featured launchpad polling
    - **Property 9: Non-Featured Launchpads Use Polling**
    - **Validates: Requirements 4.1**
  
  - [ ]* 8.6 Write property test for global disable fallback
    - **Property 17: Global WebSocket Disable Fallback**
    - **Validates: Requirements 7.2**

- [x] 9. Checkpoint - Ensure integration works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement monitoring and observability
  - [x] 10.1 Add logging for WebSocket lifecycle events
    - Log connection establishment with launchpad address
    - Log connection failures with error details
    - Log mint events received via WebSocket with transaction hash
    - _Requirements: 8.1, 8.2, 8.3_
  
  - [x] 10.2 Implement metrics collection
    - Add counter for active WebSocket connections
    - Add counter for mint events received via WebSocket
    - Add counter for mint events received via polling
    - Add counter for WebSocket reconnection attempts
    - Add counter for WebSocket errors
    - _Requirements: 8.4, 8.5_
  
  - [x] 10.3 Update EventProcessor to increment metrics
    - Increment appropriate counter based on event source
    - Update metrics in processMintEvent method
    - _Requirements: 8.5_
  
  - [ ]* 10.4 Write property test for logging completeness
    - **Property 18: Connection Logging Completeness**
    - **Validates: Requirements 8.1, 8.2, 8.3**
  
  - [ ]* 10.5 Write property test for connection metrics accuracy
    - **Property 19: Metrics Accuracy for WebSocket Connections**
    - **Validates: Requirements 8.4**
  
  - [ ]* 10.6 Write property test for event source metrics accuracy
    - **Property 20: Metrics Accuracy for Event Sources**
    - **Validates: Requirements 8.5**

- [ ] 11. Implement error handling utilities
  - [x] 11.1 Create WebSocketErrorHandler class
    - Implement handleConnectionError method
    - Implement handleEventProcessingError method
    - Create FailedEvent model for storing failed events
    - _Requirements: 2.5_
  
  - [x] 11.2 Create database error handler
    - Implement handleDatabaseError function
    - Handle Prisma error codes (P2002, P2025)
    - Implement retry with backoff for connection errors
    - _Requirements: 6.3_
  
  - [ ]* 11.3 Write unit tests for error handlers
    - Test connection error handling and reconnection trigger
    - Test event processing error storage
    - Test database error code handling
    - _Requirements: 2.5_

- [ ] 12. Create integration tests
  - [ ]* 12.1 Write end-to-end test for featured launchpad mint flow
    - Create featured launchpad in test database
    - Initialize WebSocketManager
    - Simulate mint event via mock WebSocket
    - Verify event processed and stored in database
    - _Requirements: 2.1, 2.2, 6.1_
  
  - [ ]* 12.2 Write test for featured status transition
    - Create non-featured launchpad
    - Change to featured=true
    - Verify WebSocket connection established
    - Change to featured=false
    - Verify WebSocket connection removed
    - _Requirements: 4.2, 4.3_
  
  - [ ]* 12.3 Write test for mixed launchpad scenarios
    - Create multiple featured and non-featured launchpads
    - Simulate various events (Mint, Transfer, Marketplace)
    - Verify mint events on featured use WebSocket
    - Verify all other events use polling
    - _Requirements: 3.1, 3.2, 4.1_

- [ ] 13. Final checkpoint - Comprehensive testing
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Documentation and deployment preparation
  - [x] 14.1 Update environment variable documentation
    - Document WEBSOCKET_ENABLED flag
    - Document WEBSOCKET_PROVIDER_URL requirement
    - Document reconnection configuration options
    - _Requirements: 7.1_
  
  - [ ] 14.2 Create migration guide
    - Document database migration steps
    - Document configuration changes needed
    - Document feature flag rollout strategy
    - _Requirements: 1.1, 1.2_
  
  - [ ] 14.3 Create monitoring dashboard configuration
    - Define dashboard panels for WebSocket metrics
    - Define alert rules for connection failures
    - Define alert rules for event processing errors
    - _Requirements: 8.4, 8.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties with minimum 100 iterations each
- Unit tests validate specific examples, edge cases, and integration points
- The implementation follows a phased approach: schema → core → integration → monitoring
- WebSocket connections are only established for launchpads with isFeatured=true
- All non-mint events continue using the existing polling mechanism
- Event deduplication ensures each event is processed exactly once regardless of source
