/**
 * Data Processors Module
 * 
 * This module contains processors for transforming and enriching data:
 * - Metadata processor: Fetches and processes NFT metadata from various sources
 * - Ownership tracker: Tracks NFT ownership changes and history
 * - Image processor: Processes and caches NFT images
 * - Attribute processor: Extracts and normalizes NFT attributes
 * - Event processor: Handles event deduplication and processing
 * 
 * Implementation files are already created in Phase 2:
 * - Metadata fetching and storage
 * - Ownership tracking with history
 * - Contract metadata syncing
 * 
 * See implementation in:
 * - Phase 2 deliverables (Metadata and ownership processing)
 * - Phase 8 deliverables (Attribute normalization)
 */

// Placeholder exports - actual implementations in Phase 2
// export * from './metadata-processor';
// export * from './ownership-tracker';

// Event processor for WebSocket and polling event deduplication
export * from './event-processor';
