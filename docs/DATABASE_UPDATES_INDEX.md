# Database Updates Documentation Index

This document provides an index of all database-related documentation in the NFT Listener Service.

## Phase Index Consistency

**Critical**: Phase indices must be consistent between database and smart contracts.

- **[PHASE_INDEX_CONSISTENCY.md](./PHASE_INDEX_CONSISTENCY.md)** - Complete guide to phase index consistency
  - 0-based indexing convention
  - System flow across components
  - Verification and repair tools
  - Troubleshooting guide
  - Best practices

- **[PHASE_INDEX_QUICK_REFERENCE.md](./PHASE_INDEX_QUICK_REFERENCE.md)** - Quick reference guide
  - Core concepts
  - Quick commands
  - Common patterns
  - Troubleshooting flowcharts

- **[phase-index-verification-cli.md](./phase-index-verification-cli.md)** - Verification tool
  - CLI usage and options
  - Report formats
  - Examples and workflows

- **[phase-index-repair-cli.md](./phase-index-repair-cli.md)** - Repair tool
  - CLI usage and options
  - Safety features
  - Dry-run mode
  - Examples and workflows

- **[phase-index-repair-service.md](./phase-index-repair-service.md)** - Service implementation
  - Technical details
  - Rollback mechanism
  - Error handling

## Event Database Updates

- **[ALL_EVENTS_DATABASE_UPDATES_SUMMARY.md](./ALL_EVENTS_DATABASE_UPDATES_SUMMARY.md)** - Summary of all event handlers
- **[ACTIVITY_EVENT_DATABASE_UPDATES.md](./ACTIVITY_EVENT_DATABASE_UPDATES.md)** - Activity event updates
- **[MARKETPLACE_EVENT_DATABASE_UPDATES.md](./MARKETPLACE_EVENT_DATABASE_UPDATES.md)** - Marketplace event updates
- **[MINT_EVENT_DATABASE_UPDATES.md](./MINT_EVENT_DATABASE_UPDATES.md)** - Mint event updates
- **[NFT_METADATA_EVENT_DATABASE_UPDATES.md](./NFT_METADATA_EVENT_DATABASE_UPDATES.md)** - Metadata event updates
- **[TRANSFER_EVENT_DATABASE_UPDATES.md](./TRANSFER_EVENT_DATABASE_UPDATES.md)** - Transfer event updates

## Database Schema

- **[DATABASE_SCHEMA.sql](./DATABASE_SCHEMA.sql)** - Complete database schema
- **[../prisma/schema.prisma](../prisma/schema.prisma)** - Prisma schema definition

## Integration Documentation

- **[NFT_INTEGRATION_FINAL_REPORT.md](./NFT_INTEGRATION_FINAL_REPORT.md)** - NFT integration report
- **[NFT_INTEGRATION_STATUS.md](./NFT_INTEGRATION_STATUS.md)** - Integration status
- **[NFT_INTEGRATION_VERIFICATION.md](./NFT_INTEGRATION_VERIFICATION.md)** - Verification guide
- **[NFT_INTEGRATION_TESTING_GUIDE.md](./NFT_INTEGRATION_TESTING_GUIDE.md)** - Testing guide
- **[MARKETPLACE_INTEGRATION_COMPLETE.md](./MARKETPLACE_INTEGRATION_COMPLETE.md)** - Marketplace integration
- **[MINT_TABLE_INTEGRATION.md](./MINT_TABLE_INTEGRATION.md)** - Mint table integration

## Quick Links

### For Developers
- Start here: [PHASE_INDEX_CONSISTENCY.md](./PHASE_INDEX_CONSISTENCY.md)
- Quick reference: [PHASE_INDEX_QUICK_REFERENCE.md](./PHASE_INDEX_QUICK_REFERENCE.md)
- Event handlers: [ALL_EVENTS_DATABASE_UPDATES_SUMMARY.md](./ALL_EVENTS_DATABASE_UPDATES_SUMMARY.md)

### For Operators
- Verification: [phase-index-verification-cli.md](./phase-index-verification-cli.md)
- Repair: [phase-index-repair-cli.md](./phase-index-repair-cli.md)
- Troubleshooting: [PHASE_INDEX_CONSISTENCY.md#troubleshooting-guide](./PHASE_INDEX_CONSISTENCY.md#troubleshooting-guide)

### For Troubleshooting
- Phase index issues: [PHASE_INDEX_CONSISTENCY.md#troubleshooting-guide](./PHASE_INDEX_CONSISTENCY.md#troubleshooting-guide)
- Quick diagnostics: [PHASE_INDEX_QUICK_REFERENCE.md#quick-diagnostics](./PHASE_INDEX_QUICK_REFERENCE.md#quick-diagnostics)
- Common mistakes: [PHASE_INDEX_QUICK_REFERENCE.md#common-mistakes](./PHASE_INDEX_QUICK_REFERENCE.md#common-mistakes)

## Related Documentation

- **[API_DOCUMENTATION.md](./API_DOCUMENTATION.md)** - REST API reference
- **[EVENT_HANDLERS_API.md](./EVENT_HANDLERS_API.md)** - Event handler API
- **[OPERATIONAL_RUNBOOKS.md](./OPERATIONAL_RUNBOOKS.md)** - Operations guide

---

**Last Updated**: 2024-01-15
