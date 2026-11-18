# Queue System

Reliable, scalable event processing using Bull (Redis-based queue).

## Quick Start

### 1. Install Redis

```bash
# Using Docker
docker run -d -p 6379:6379 --name redis redis:alpine

# Or using Homebrew (macOS)
brew install redis
brew services start redis

# Or using apt (Ubuntu/Debian)
sudo apt-get install redis-server
sudo systemctl start redis
```

### 2. Configure Environment

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
ALCHEMY_API_KEY=your_key_here
```

### 3. Start Service

The queue system starts automatically with the main service:

```bash
npm start
```

## Architecture

```
Event Listener → Queue Manager → Redis → Queue Workers → Processors → Database
```

## Queues

| Queue | Purpose | Concurrency | Priority |
|-------|---------|-------------|----------|
| mint-events | Process NFT mints | 10 | High |
| nft-metadata | Fetch metadata | 5 | Medium |
| marketplace-events | Process sales/listings | 8 | Medium |
| activity-events | General activities | 5 | Low |
| historical-sync | Backfill data | 2 | Low |
| notifications | Send notifications | 3 | High |

## Usage

### Adding Jobs

```typescript
import { getQueueManager } from './lib/queue';

const queueManager = getQueueManager();

// Add mint event
await queueManager.addMintEventJob({
  chainId: 1,
  launchpadAddress: '0x...',
  to: '0x...',
  tokenId: '1',
  txHash: '0x...',
  blockNumber: 12345678,
  logIndex: 0,
  timestamp: new Date(),
});
```

### Monitoring

```typescript
// Get queue stats
const stats = await queueManager.getQueueStats(QueueName.MINT_EVENTS);

// Get all stats
const allStats = await queueManager.getAllQueueStats();
```

### Management

```typescript
// Pause queue
await queueManager.pauseQueue(QueueName.MINT_EVENTS);

// Resume queue
await queueManager.resumeQueue(QueueName.MINT_EVENTS);

// Retry failed jobs
await queueManager.retryAllFailedJobs(QueueName.MINT_EVENTS);
```

## Health Check

```bash
curl http://localhost:3001/health
```

## Files

```
queue/
├── queue-config.ts          # Queue configurations
├── queue-manager.ts         # Queue management
├── queue-worker.ts          # Worker orchestration
├── processors/              # Job processors
│   ├── mint-event-processor.ts
│   ├── nft-metadata-processor.ts
│   ├── marketplace-event-processor.ts
│   ├── activity-event-processor.ts
│   ├── historical-sync-processor.ts
│   └── notification-processor.ts
└── index.ts                 # Exports
```

## Benefits

✅ **Reliability**: Automatic retries with exponential backoff
✅ **Scalability**: Process thousands of events concurrently
✅ **Monitoring**: Real-time queue statistics
✅ **Decoupling**: Separate event detection from processing
✅ **Priority**: High-priority events processed first
✅ **Persistence**: Jobs survive service restarts

## Documentation

See [QUEUE_SYSTEM.md](../../../docs/QUEUE_SYSTEM.md) for detailed documentation.
