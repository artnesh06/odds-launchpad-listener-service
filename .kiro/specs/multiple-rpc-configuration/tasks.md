# Implementation Plan

- [ ] 1. Create core data structures and configuration parser
  - [ ] 1.1 Define RPCEndpoint interface and types
    - Create `RPCEndpoint` interface with all required fields (url, priority, weight, enabled, healthStatus, etc.)
    - Define health status type: `'healthy' | 'unhealthy' | 'unknown'`
    - Define strategy type: `'priority' | 'round-robin' | 'random' | 'weighted'`
    - _Requirements: 1.1, 1.2_

  - [ ] 1.2 Implement RPC configuration parser
    - Create `RPCConfigParser` class in `src/config/rpc-config-parser.ts`
    - Implement `parseRPCUrls()` to parse comma-separated URLs with optional priority notation
    - Support formats: "url1,url2,url3" and "url1:1,url2:2,url3:3"
    - Implement `validateEndpoints()` to validate URL format and configuration
    - Implement `getDefaultEndpoints()` for each supported chain
    - _Requirements: 1.4, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 1.3 Write property test for configuration parsing
    - **Property 7: Configuration Parsing Is Idempotent**
    - Generate rand