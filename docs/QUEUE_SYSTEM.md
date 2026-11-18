# Queue System Documentation

## Overview

The Queue System provides reliable, scalable event processing using Bull (Redis-based queue). It decouples event detection from event processing, allowing for better performance, retry logic, and monitoring.

## Architecture

```
┌─────────────────┐
│  Event Listener │ ──┐
└─────────────────┘   │
                      │  Add Jobs
┌─────────────────┐   │
│  Event Listener │ ──┼──► ┌──────────────┐
└─────────────────┘   │    │ Queue Manager│
                      │    └──────────────┘
┌─────────────────┐   │           │
│  Event Listener │ ──┘           │
└─────────────────┘                │
                                   ▼
                          ┌─────────────────┐
                          │  Redis (Bull)   │
                          └─────────────────┘
                                   │
                                   ▼
                          ┌─────────────────┐
                          │  Queue Workers  │
                          └─────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
            ┌──────────┐   ┌──────────┐   ┌──────────┐
            │Processor │   │Processor │   │Processor │
            └──────────┘   └──────────┘   └──────────┘
                    │              │              │
                    └──────────────┼──────────────┘
                                   ▼
                          ┌─────────────────┐
                          │    Database     │
                          └─────────────────┘
```

## Queues

### 1. Mint Events Queue
- **Purpose**: Process NFT mint events
- **Concurrency**: 10 workers
- **Priority**: High (1)
- **Retry**: 5 attempts with exponential backoff
- **Features**:
  - Duplicate detection
  - Metadata fetching (Alchemy)
  - Spam detection
  - WebSocket broadcasting

### 2. NFT Metadata Queue
- **Purpose**: Fetch and store NFT metadata
- **Concurrency**: 5 workers
- **Priority**: Medium (2)
- **Timeout**: 30 seconds
- **Features**:
  - Alchemy API integration
  - Attribute extraction
  - Image caching

### 3. Marketplace Events Queue
- **Purpose**: Process marketplace events (sales, listings, offers)
- **Concurrency**: 8 workers
- **Priority**: Medium (2)
- **Features**:
  - Multi-marketplace support
  - Analytics updates
  - Floor price tracking

### 4. Activity Events Queue
- **Purpose**: Process general activity events
- **Concurrency**: 5 workers
- **Priority**: Low (3)
- **Features**:
  - Event type mapping
  - Activity logging
  - Description generation

### 5. Historical Sync Queue
- **Purpose**: Backfill historical blockchain data
- **Concurrency**: 2 workers
- **Priority**: Low (4)
- **Timeout**: 10 minutes
- **Features**:
  - Chunked processing
  - Progress tracking
  - Rate limiting

### 6. Notifications Queue
- **Purpose**: Send notifications (WebSocket, email, SMS)
- **Concurrency**: 3 workers
- **Priority**: High (1)
- **Features**:
  - Multi-channel support
  - Priority-based delivery
  - Retry logic

## Configuration

### Environment Variables

```env
# Redis Configuration
REDIS_HOST="localhost"
REDIS_PORT="6379"
REDIS_PASSWORD=""
REDIS_DB="0"

# Alchemy API (for metadata)
ALCHEMY_API_KEY="your_key_here"
```

### Queue Options

Each queue can be configured in `src/lib/queue/queue-config.ts`:

```typescript
{
  name: 'queue-name',
  concurrency: 10,        // Number of concurrent workers
  priority: 1,            // 1 (high) to 4 (low)
  jobOptions: {
    attempts: 3,          // Retry attempts
    backoff: {
      type: 'exponential',
      delay: 2000         // Initial delay in ms
    },
    timeout: 30000,       // Job timeout in ms
    removeOnComplete: {
      age: 86400,         // Keep for 24 hours
      count: 1000         // Keep last 1000 jobs
    }
  }
}
```

## Usage

### Adding Jobs to Queue

```typescript
import { getQueueManager } from './lib/queue';

const queueManager = getQueueManager();

// Add mint event job
await queueManager.addMintEventJob({
  chainId: 1,
  launchpadAddress: '0x...',
  from: '0x0000000000000000000000000000000000000000',
  to: '0x...',
  tokenId: '1',
  txHash: '0x...',
  blockNumber: 12345678,
  logIndex: 0,
  timestamp: new Date(),
});

// Add metadata job
await queueManager.addNFTMetadataJob({
  chainId: 1,
  contractAddress: '0x...',
  tokenId: '1',
  forceRefresh: false,
});

// Add marketplace event job
await queueManager.addMarketplaceEventJob({
  chainId: 1,
  marketplace: 'opensea',
  eventType: 'sale',
  contractAddress: '0x...',
  tokenId: '1',
  data: { buyer: '0x...', seller: '0x...', price: '1000000000000000000' },
  txHash: '0x...',
  blockNumber: 12345678,
  timestamp: new Date(),
});
```

### Monitoring Queues

```typescript
// Get queue statistics
const stats = await queueManager.getQueueStats(QueueName.MINT_EVENTS);
console.log(stats);
// {
//   waiting: 10,
//   active: 5,
//   completed: 1000,
//   failed: 2,
//   delayed: 0,
//   paused: 0
// }

// Get all queue stats
const allStats = await queueManager.getAllQueueStats();
```

### Managing Queues

```typescript
// Pause a queue
await queueManager.pauseQueue(QueueName.MINT_EVENTS);

// Resume a queue
await queueManager.resumeQueue(QueueName.MINT_EVENTS);

// Clean completed jobs
await queueManager.cleanQueue(QueueName.MINT_EVENTS, 86400000); // 24 hours

// Get failed jobs
const failedJobs = await queueManager.getFailedJobs(QueueName.MINT_EVENTS, 0, 10);

// Retry a failed job
await queueManager.retryFailedJob(QueueName.MINT_EVENTS, 'job-id');

// Retry all failed jobs
await queueManager.retryAllFailedJobs(QueueName.MINT_EVENTS);
```

## Health Check

Queue status is included in the health check endpoint:

```bash
curl http://localhost:3001/health
```

Response:
```json
{
  "status": "healthy",
  "queue": {
    "initialized": true,
    "workerActive": true,
    "queues": {
      "mint-events": {
        "waiting": 5,
        "active": 3,
        "completed": 1000,
        "failed": 1
      },
      "nft-metadata": {
        "waiting": 2,
        "active": 1,
        "completed": 500,
        "failed": 0
      }
    }
  }
}
```

## Bull Board (Optional)

For visual monitoring, you can add Bull Board:

```bash
npm install @bull-board/express @bull-board/api
```

```typescript
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullAdapter(mintEventsQueue),
    new BullAdapter(nftMetadataQueue),
    // ... other queues
  ],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());
```

Access at: `http://localhost:3001/admin/queues`

## Performance Tuning

### Concurrency

Adjust concurrency based on:
- Database connection pool size
- RPC rate limits
- Memory constraints

```typescript
// High volume, fast processing
MINT_EVENTS: { concurrency: 10 }

// External API calls, rate limited
NFT_METADATA: { concurrency: 5 }

// Long-running tasks
HISTORICAL_SYNC: { concurrency: 2 }
```

### Retry Strategy

```typescript
jobOptions: {
  attempts: 5,
  backoff: {
    type: 'exponential',  // or 'fixed'
    delay: 2000           // 2s, 4s, 8s, 16s, 32s
  }
}
```

### Job Cleanup

```typescript
removeOnComplete: {
  age: 86400,    // Keep for 24 hours
  count: 1000    // Keep last 1000 jobs
},
removeOnFail: {
  age: 604800,   // Keep for 7 days
  count: 5000    // Keep last 5000 jobs
}
```

## Troubleshooting

### Queue Not Processing

1. Check Redis connection:
```bash
redis-cli ping
```

2. Check worker status:
```typescript
const worker = getQueueWorker();
console.log(worker.isActive()); // Should be true
```

3. Check queue stats:
```typescript
const stats = await queueManager.getAllQueueStats();
console.log(stats);
```

### High Memory Usage

1. Reduce concurrency
2. Increase job cleanup frequency
3. Monitor with Bull Board

### Failed Jobs

1. View failed jobs:
```typescript
const failed = await queueManager.getFailedJobs(QueueName.MINT_EVENTS);
```

2. Retry failed jobs:
```typescript
await queueManager.retryAllFailedJobs(QueueName.MINT_EVENTS);
```

3. Check error logs in job data

## Best Practices

1. **Idempotency**: Use unique job IDs to prevent duplicates
2. **Timeouts**: Set appropriate timeouts for long-running jobs
3. **Monitoring**: Regularly check queue stats and failed jobs
4. **Cleanup**: Configure job retention policies
5. **Retry Logic**: Use exponential backoff for transient errors
6. **Graceful Shutdown**: Always close queues on shutdown

## Migration from Direct Processing

To migrate from direct processing to queue-based:

1. **Install Redis**:
```bash
docker run -d -p 6379:6379 redis:alpine
```

2. **Update Environment**:
```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

3. **Replace Direct Calls**:
```typescript
// Before
await handleMintEvent(data);

// After
await queueManager.addMintEventJob(data);
```

4. **Start Workers**:
Workers start automatically with the service.

## Monitoring & Alerts

### Metrics to Monitor

- Queue depth (waiting jobs)
- Processing rate (jobs/second)
- Failed job count
- Average processing time
- Memory usage

### Alert Thresholds

- Waiting jobs > 1000
- Failed jobs > 100
- Processing time > 30s
- Memory usage > 80%

## References

- [Bull Documentation](https://github.com/OptimalBits/bull)
- [Redis Documentation](https://redis.io/documentation)
- [Bull Board](https://github.com/felixmosh/bull-board)
