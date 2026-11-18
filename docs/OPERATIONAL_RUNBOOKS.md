# Operational Runbooks

## Overview

This document provides step-by-step procedures for diagnosing and resolving common operational issues in the NFT Indexer & Marketplace system. These runbooks are designed for system operators, DevOps engineers, and on-call personnel.

---

## Table of Contents

1. [Event Processing Failures](#event-processing-failures)
2. [Analytics Discrepancies](#analytics-discrepancies)
3. [Performance Tuning](#performance-tuning)
4. [Monitoring and Alerting Setup](#monitoring-and-alerting-setup)
5. [Database Issues](#database-issues)
6. [Queue System Issues](#queue-system-issues)
7. [WebSocket Connection Issues](#websocket-connection-issues)
8. [External Service Failures](#external-service-failures)

---

## Event Processing Failures

### Symptom: Events Not Being Processed

**Indicators:**
- Queue depth increasing continuously
- No new database records for recent blocks
- WebSocket clients not receiving updates
- Error logs showing processing failures

**Diagnosis Steps:**

1. **Check Queue Status**
```bash
# Access health check endpoint
curl http://localhost:3001/health

# Check queue statistics
curl http://localhost:3001/admin/queues
```

2. **Check Error Logs**
```sql
-- Query recent errors
SELECT * FROM error_logs 
WHERE resolved = false 
ORDER BY "createdAt" DESC 
LIMIT 50;

-- Group errors by type
SELECT "errorType", COUNT(*) as count, MAX("createdAt") as latest
FROM error_logs 
WHERE resolved = false 
GROUP BY "errorType" 
ORDER BY count DESC;
```

3. **Check Blockchain Listener Status**
```bash
# Check logs for listener errors
docker logs <container-name> | grep -i "listener"

# Check if listeners are connected
curl http://localhost:3001/api/listeners/status
```

**Resolution Steps:**

### Issue 1: Database Connection Errors

**Error Code:** `DATABASE_ERROR`, `P1001`, `P1002`, `P2037`

**Steps:**
1. Check database connection pool:
```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity;

-- Check max connections
SHOW max_connections;
```

2. If pool exhausted, restart the service:
```bash
# Docker
docker restart <container-name>

# PM2
pm2 restart nft-indexer

# Systemd
systemctl restart nft-indexer
```

3. Increase connection pool size (if needed):
```env
# .env
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=20"
```

4. Monitor connection usage after restart

### Issue 2: Blockchain RPC Errors

**Error Code:** `EXTERNAL_SERVICE_ERROR`, RPC timeout

**Steps:**
1. Check RPC provider status:
```bash
# Test RPC endpoint
curl -X POST <RPC_URL> \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

2. Switch to backup RPC provider:
```typescript
// Update in src/config/chains.ts
export const CHAIN_CONFIGS = {
  [chainId]: {
    rpcUrls: [
      'https://backup-rpc-url.com',  // Move backup to primary
      'https://primary-rpc-url.com'
    ]
  }
};
```

3. Restart listeners to use new RPC

4. Monitor RPC response times

### Issue 3: Duplicate Event Detection Failing

**Error Code:** `DUPLICATE_EVENT` not being caught

**Steps:**
1. Check for missing unique indexes:
```sql
-- Check indexes on nft_transfers
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'nft_transfers';

-- Should have index on (txHash, logIndex)
```

2. Create missing indexes if needed:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS "nft_transfers_txHash_logIndex_key" 
ON "nft_transfers"("txHash", "logIndex");
```

3. Clear duplicate records:
```sql
-- Find duplicates
SELECT "txHash", "logIndex", COUNT(*) 
FROM "nft_transfers" 
GROUP BY "txHash", "logIndex" 
HAVING COUNT(*) > 1;

-- Delete duplicates (keep oldest)
DELETE FROM "nft_transfers" a
USING "nft_transfers" b
WHERE a.id > b.id 
  AND a."txHash" = b."txHash" 
  AND a."logIndex" = b."logIndex";
```

### Issue 4: Transaction Rollback Errors

**Error Code:** `TRANSACTION_ROLLBACK`, `P2034` (deadlock)

**Steps:**
1. Identify deadlock patterns:
```sql
-- Check for long-running transactions
SELECT pid, now() - pg_stat_activity.query_start AS duration, query 
FROM pg_stat_activity 
WHERE state = 'active' 
ORDER BY duration DESC;
```

2. Kill blocking transactions (if safe):
```sql
-- Identify blocking queries
SELECT blocked_locks.pid AS blocked_pid,
       blocking_locks.pid AS blocking_pid,
       blocked_activity.query AS blocked_query,
       blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- Terminate blocking query (use with caution)
SELECT pg_terminate_backend(<blocking_pid>);
```

3. Reduce concurrency temporarily:
```typescript
// In queue-config.ts
export const QUEUE_CONFIGS = {
  [QueueName.MINT_EVENTS]: {
    concurrency: 5,  // Reduce from 10
    // ...
  }
};
```

4. Restart service and monitor

### Issue 5: Launchpad Not Found Errors

**Error Code:** `LAUNCHPAD_NOT_FOUND`

**Steps:**
1. Check if launchpad exists in database:
```sql
SELECT * FROM launchpads 
WHERE "contractAddress" = '<address>';
```

2. If missing, manually sync launchpad:
```bash
# Run sync script
npm run script:sync-launchpad -- --address=<address> --chain=<chainId>
```

3. Verify launchpad was created:
```sql
SELECT * FROM launchpads 
WHERE "contractAddress" = '<address>';
```

4. Retry failed events:
```typescript
// Via queue manager
await queueManager.retryAllFailedJobs(QueueName.MINT_EVENTS);
```

**Prevention:**
- Enable auto-sync in event handlers
- Monitor for new launchpad deployments
- Set up alerts for LAUNCHPAD_NOT_FOUND errors

---

## Analytics Discrepancies

### Symptom: Analytics Numbers Don't Match Reality

**Indicators:**
- uniqueHolders count incorrect
- totalSupply doesn't match contract
- Volume metrics inconsistent
- Floor price outdated

**Diagnosis Steps:**

1. **Compare Database vs Blockchain**
```sql
-- Check total supply in database
SELECT "contractAddress", "totalSupply" 
FROM nft_contracts 
WHERE "contractAddress" = '<address>';

-- Check unique holders
SELECT COUNT(DISTINCT "ownerAddress") 
FROM nft_ownership 
WHERE "isCurrent" = true 
  AND nft_id IN (
    SELECT id FROM nfts WHERE "contractAddress" = '<address>'
  );
```

```typescript
// Check on-chain total supply
const contract = new ethers.Contract(address, abi, provider);
const totalSupply = await contract.totalSupply();
console.log('On-chain supply:', totalSupply.toString());
```

2. **Check for Missing Events**
```sql
-- Check for gaps in block numbers
SELECT "blockNumber", COUNT(*) 
FROM nft_transfers 
WHERE "contractAddress" = '<address>' 
GROUP BY "blockNumber" 
ORDER BY "blockNumber" DESC 
LIMIT 100;
```

3. **Check Analytics Update Timestamps**
```sql
SELECT "contractAddress", "updatedAt", "uniqueHolders", "totalSupply"
FROM nft_collection_analytics 
WHERE "contractAddress" = '<address>';
```

**Resolution Steps:**

### Issue 1: Incorrect Unique Holders Count

**Steps:**
1. Recalculate unique holders:
```sql
-- Manual recalculation
UPDATE nft_collection_analytics 
SET "uniqueHolders" = (
  SELECT COUNT(DISTINCT "ownerAddress") 
  FROM nft_ownership 
  WHERE "isCurrent" = true 
    AND nft_id IN (
      SELECT id FROM nfts WHERE "contractAddress" = '<address>'
    )
)
WHERE "contractAddress" = '<address>';
```

2. Verify the update:
```sql
SELECT "contractAddress", "uniqueHolders" 
FROM nft_collection_analytics 
WHERE "contractAddress" = '<address>';
```

3. Check for orphaned ownership records:
```sql
-- Find ownership records without current owner
SELECT COUNT(*) 
FROM nft_ownership o1
WHERE "isCurrent" = true
  AND EXISTS (
    SELECT 1 FROM nft_ownership o2 
    WHERE o2.nft_id = o1.nft_id 
      AND o2.id != o1.id 
      AND o2."isCurrent" = true
  );
```

4. Clean up orphaned records:
```sql
-- Mark duplicates as not current (keep most recent)
UPDATE nft_ownership o1
SET "isCurrent" = false
WHERE "isCurrent" = true
  AND EXISTS (
    SELECT 1 FROM nft_ownership o2 
    WHERE o2.nft_id = o1.nft_id 
      AND o2.id > o1.id 
      AND o2."isCurrent" = true
  );
```

### Issue 2: Incorrect Total Supply

**Steps:**
1. Compare with on-chain data:
```typescript
// Get on-chain supply
const onChainSupply = await contract.totalSupply();

// Get database supply
const dbSupply = await prisma.nFTContract.findUnique({
  where: { contractAddress: address },
  select: { totalSupply: true }
});

console.log('On-chain:', onChainSupply.toString());
console.log('Database:', dbSupply.totalSupply);
```

2. If mismatch, resync supply:
```sql
-- Count actual minted tokens
SELECT COUNT(*) FROM nfts 
WHERE "contractAddress" = '<address>';

-- Update supply
UPDATE nft_contracts 
SET "totalSupply" = (
  SELECT COUNT(*) FROM nfts 
  WHERE "contractAddress" = '<address>'
)
WHERE "contractAddress" = '<address>';
```

3. Update analytics:
```sql
UPDATE nft_collection_analytics 
SET "totalSupply" = (
  SELECT "totalSupply" FROM nft_contracts 
  WHERE "contractAddress" = '<address>'
)
WHERE "contractAddress" = '<address>';
```

### Issue 3: Stale Floor Price

**Steps:**
1. Check last floor price update:
```sql
SELECT "contractAddress", "floorPrice", "floorPriceUpdatedAt" 
FROM nft_collection_analytics 
WHERE "contractAddress" = '<address>';
```

2. Manually trigger floor price refresh:
```bash
# Run floor price update script
npm run script:update-floor-prices -- --contract=<address>
```

3. Verify update:
```sql
SELECT "contractAddress", "floorPrice", "floorPriceUpdatedAt" 
FROM nft_collection_analytics 
WHERE "contractAddress" = '<address>';
```

### Issue 4: Volume Metrics Incorrect

**Steps:**
1. Recalculate volume from sales:
```sql
-- Calculate total volume
SELECT SUM(CAST("price" AS NUMERIC)) as total_volume
FROM marketplace_sales 
WHERE "contractAddress" = '<address>';

-- Calculate 24h volume
SELECT SUM(CAST("price" AS NUMERIC)) as volume_24h
FROM marketplace_sales 
WHERE "contractAddress" = '<address>'
  AND "timestamp" > NOW() - INTERVAL '24 hours';
```

2. Update analytics:
```sql
UPDATE nft_collection_analytics 
SET 
  "totalVolume" = (
    SELECT COALESCE(SUM(CAST("price" AS NUMERIC)), 0)
    FROM marketplace_sales 
    WHERE "contractAddress" = '<address>'
  ),
  "volume24h" = (
    SELECT COALESCE(SUM(CAST("price" AS NUMERIC)), 0)
    FROM marketplace_sales 
    WHERE "contractAddress" = '<address>'
      AND "timestamp" > NOW() - INTERVAL '24 hours'
  )
WHERE "contractAddress" = '<address>';
```

**Prevention:**
- Schedule periodic analytics recalculation (daily)
- Monitor analytics update timestamps
- Set up alerts for stale analytics (>24 hours old)
- Implement analytics validation checks

---

## Performance Tuning

### Symptom: Slow Event Processing

**Indicators:**
- High queue depth
- Slow database queries
- High CPU/memory usage
- Increased processing latency

**Diagnosis Steps:**

1. **Check System Resources**
```bash
# CPU usage
top -bn1 | grep "Cpu(s)"

# Memory usage
free -h

# Disk I/O
iostat -x 1 5
```

2. **Check Database Performance**
```sql
-- Slow queries
SELECT query, mean_exec_time, calls 
FROM pg_stat_statements 
ORDER BY mean_exec_time DESC 
LIMIT 10;

-- Table sizes
SELECT schemaname, tablename, 
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Index usage
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes 
ORDER BY idx_scan ASC;
```

3. **Check Queue Performance**
```bash
# Queue statistics
curl http://localhost:3001/health | jq '.queue'

# Redis memory usage
redis-cli info memory
```

**Resolution Steps:**

### Optimization 1: Database Query Optimization

**Steps:**
1. Add missing indexes:
```sql
-- Index for ownership queries
CREATE INDEX IF NOT EXISTS idx_nft_ownership_current 
ON nft_ownership("isCurrent", "ownerAddress") 
WHERE "isCurrent" = true;

-- Index for transfer queries
CREATE INDEX IF NOT EXISTS idx_nft_transfers_contract_block 
ON nft_transfers("contractAddress", "blockNumber" DESC);

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_marketplace_sales_contract_timestamp 
ON marketplace_sales("contractAddress", "timestamp" DESC);
```

2. Analyze and vacuum tables:
```sql
-- Analyze tables for query planner
ANALYZE nft_ownership;
ANALYZE nft_transfers;
ANALYZE marketplace_sales;

-- Vacuum to reclaim space
VACUUM ANALYZE nft_ownership;
```

3. Monitor query performance:
```sql
-- Enable query logging (temporarily)
ALTER DATABASE <dbname> SET log_min_duration_statement = 1000; -- Log queries >1s
```

### Optimization 2: Increase Queue Concurrency

**Steps:**
1. Monitor current concurrency:
```typescript
// Check queue-config.ts
console.log(QUEUE_CONFIGS[QueueName.MINT_EVENTS].concurrency);
```

2. Gradually increase concurrency:
```typescript
// In queue-config.ts
export const QUEUE_CONFIGS = {
  [QueueName.MINT_EVENTS]: {
    concurrency: 15,  // Increase from 10
    // ...
  }
};
```

3. Monitor impact:
- Database connection pool usage
- CPU usage
- Memory usage
- Processing latency

4. Adjust if needed (increase or decrease)

### Optimization 3: Implement Batch Processing

**Steps:**
1. Enable batch processing for high-volume events:
```typescript
// In event handler
const BATCH_SIZE = 100;
const batches = [];

for (let i = 0; i < events.length; i += BATCH_SIZE) {
  batches.push(events.slice(i, i + BATCH_SIZE));
}

for (const batch of batches) {
  await processBatch(batch);
}
```

2. Update analytics once per batch:
```typescript
await prisma.$transaction(async (tx) => {
  // Process all events in batch
  for (const event of batch) {
    await processEvent(tx, event);
  }
  
  // Update analytics once
  await updateAnalytics(tx, contractAddress);
});
```

### Optimization 4: Implement Caching

**Steps:**
1. Cache frequently accessed data:
```typescript
// Launchpad cache
const launchpadCache = new Map<string, { data: any, expiry: number }>();

async function getCachedLaunchpad(address: string) {
  const cached = launchpadCache.get(address);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
  
  const launchpad = await prisma.launchpad.findUnique({
    where: { contractAddress: address }
  });
  
  launchpadCache.set(address, {
    data: launchpad,
    expiry: Date.now() + 300000 // 5 minutes
  });
  
  return launchpad;
}
```

2. Monitor cache hit rate:
```typescript
let cacheHits = 0;
let cacheMisses = 0;

// Log periodically
setInterval(() => {
  const hitRate = cacheHits / (cacheHits + cacheMisses);
  console.log(`Cache hit rate: ${(hitRate * 100).toFixed(2)}%`);
}, 60000);
```

### Optimization 5: Database Connection Pooling

**Steps:**
1. Optimize connection pool size:
```env
# .env
DATABASE_URL="postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=10"
```

2. Monitor connection usage:
```sql
SELECT count(*) as active_connections 
FROM pg_stat_activity 
WHERE state = 'active';
```

3. Adjust based on:
- Number of queue workers
- Concurrent requests
- Database server capacity

**Performance Targets:**
- Event processing: <500ms per event
- Queue depth: <100 waiting jobs
- Database queries: <100ms average
- Memory usage: <80% of available
- CPU usage: <70% average

---

## Monitoring and Alerting Setup

### Metrics to Monitor

#### 1. Event Processing Metrics

**Key Metrics:**
- Events processed per second
- Average processing time per event type
- Queue depth and lag
- Failed event count
- Retry success rate

**Implementation:**
```typescript
// Prometheus metrics example
import { Counter, Histogram, Gauge } from 'prom-client';

const eventsProcessed = new Counter({
  name: 'events_processed_total',
  help: 'Total number of events processed',
  labelNames: ['event_type', 'status']
});

const processingDuration = new Histogram({
  name: 'event_processing_duration_seconds',
  help: 'Event processing duration',
  labelNames: ['event_type'],
  buckets: [0.1, 0.5, 1, 2, 5]
});

const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Number of jobs waiting in queue',
  labelNames: ['queue_name']
});
```

#### 2. Database Metrics

**Key Metrics:**
- Query execution time
- Connection pool utilization
- Transaction rollback rate
- Table sizes
- Index hit rate

**Queries:**
```sql
-- Connection pool usage
SELECT count(*) * 100.0 / (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as pool_usage_percent
FROM pg_stat_activity;

-- Cache hit rate
SELECT 
  sum(heap_blks_read) as heap_read,
  sum(heap_blks_hit) as heap_hit,
  sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as cache_hit_ratio
FROM pg_statio_user_tables;
```

#### 3. Error Metrics

**Key Metrics:**
- Error rate by event type
- Error rate by error category
- Unresolved error count
- Error threshold breaches

**Implementation:**
```typescript
const errorRate = new Counter({
  name: 'errors_total',
  help: 'Total number of errors',
  labelNames: ['error_type', 'severity', 'component']
});

// Track in error handler
errorRate.inc({
  error_type: error.code,
  severity: error.severity,
  component: 'NFTEventHandler'
});
```

### Alert Configuration

#### Critical Alerts (Immediate Response)

**1. High Error Rate**
```yaml
alert: HighErrorRate
expr: rate(errors_total[5m]) > 0.05
for: 5m
labels:
  severity: critical
annotations:
  summary: "Error rate exceeds 5%"
  description: "{{ $labels.component }} error rate is {{ $value }}"
```

**2. Queue Overload**
```yaml
alert: QueueOverload
expr: queue_depth > 1000
for: 10m
labels:
  severity: critical
annotations:
  summary: "Queue depth exceeds 1000"
  description: "{{ $labels.queue_name }} has {{ $value }} waiting jobs"
```

**3. Database Connection Pool Exhausted**
```yaml
alert: DatabasePoolExhausted
expr: database_connections_active / database_connections_max > 0.9
for: 5m
labels:
  severity: critical
annotations:
  summary: "Database connection pool >90% utilized"
```

#### Warning Alerts (Monitor Closely)

**1. Slow Event Processing**
```yaml
alert: SlowEventProcessing
expr: histogram_quantile(0.95, event_processing_duration_seconds) > 2
for: 15m
labels:
  severity: warning
annotations:
  summary: "95th percentile processing time >2s"
```

**2. Stale Analytics**
```yaml
alert: StaleAnalytics
expr: time() - analytics_last_update_timestamp > 86400
for: 1h
labels:
  severity: warning
annotations:
  summary: "Analytics not updated in 24 hours"
```

**3. High Memory Usage**
```yaml
alert: HighMemoryUsage
expr: process_resident_memory_bytes / node_memory_MemTotal_bytes > 0.8
for: 10m
labels:
  severity: warning
annotations:
  summary: "Memory usage >80%"
```

### Monitoring Dashboard

**Recommended Tools:**
- **Grafana**: Visualization and dashboards
- **Prometheus**: Metrics collection
- **Loki**: Log aggregation
- **AlertManager**: Alert routing and notification

**Dashboard Panels:**

1. **Event Processing Overview**
   - Events processed per second (line chart)
   - Processing duration by event type (heatmap)
   - Error rate (line chart)
   - Queue depth (line chart)

2. **Database Performance**
   - Query execution time (histogram)
   - Connection pool usage (gauge)
   - Transaction rate (line chart)
   - Cache hit rate (gauge)

3. **System Resources**
   - CPU usage (line chart)
   - Memory usage (line chart)
   - Disk I/O (line chart)
   - Network traffic (line chart)

4. **Business Metrics**
   - NFTs minted per hour (bar chart)
   - Marketplace sales per hour (bar chart)
   - Active collections (gauge)
   - Total volume (gauge)

### Log Aggregation

**Log Levels:**
- **ERROR**: Failures requiring attention
- **WARN**: Potential issues, degraded performance
- **INFO**: Normal operations, event processing
- **DEBUG**: Detailed debugging information

**Log Format:**
```json
{
  "timestamp": "2026-01-03T12:00:00Z",
  "level": "ERROR",
  "component": "NFTEventHandler",
  "operation": "handleTransferEvent",
  "chainId": 1,
  "contractAddress": "0x...",
  "tokenId": "123",
  "txHash": "0x...",
  "error": {
    "code": "DATABASE_ERROR",
    "message": "Connection timeout",
    "stack": "..."
  }
}
```

**Log Queries:**
```
# Find all errors in last hour
level:ERROR AND timestamp:[now-1h TO now]

# Find errors for specific contract
level:ERROR AND contractAddress:"0x..."

# Find slow queries
component:Database AND duration:>1000
```

### Health Check Endpoint

**Implementation:**
```typescript
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: await checkDatabase(),
    queue: await checkQueue(),
    listeners: await checkListeners(),
    memory: process.memoryUsage(),
  };
  
  const isHealthy = health.database.connected && 
                    health.queue.initialized &&
                    health.listeners.active;
  
  res.status(isHealthy ? 200 : 503).json(health);
});
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-03T12:00:00Z",
  "uptime": 86400,
  "database": {
    "connected": true,
    "latency": 5
  },
  "queue": {
    "initialized": true,
    "workerActive": true,
    "depth": 10
  },
  "listeners": {
    "active": 3,
    "chains": [1, 137, 8453]
  },
  "memory": {
    "rss": 150000000,
    "heapUsed": 100000000
  }
}
```

---

## Database Issues

### Issue: Database Connection Failures

**Symptoms:**
- `P1001`: Can't reach database server
- `P1002`: Database server timeout
- Connection pool exhausted

**Resolution:**
1. Check database server status
2. Verify network connectivity
3. Check connection string
4. Increase connection pool size
5. Restart application

### Issue: Slow Queries

**Symptoms:**
- High query execution time
- Database CPU usage high
- Application timeouts

**Resolution:**
1. Identify slow queries using `pg_stat_statements`
2. Add missing indexes
3. Optimize query structure
4. Consider query caching
5. Analyze and vacuum tables

### Issue: Deadlocks

**Symptoms:**
- `P2034`: Transaction deadlock detected
- Transaction rollbacks
- Inconsistent data

**Resolution:**
1. Identify deadlock pattern
2. Reduce transaction scope
3. Implement retry logic
4. Consider row-level locking
5. Reduce concurrency if needed

---

## Queue System Issues

### Issue: Queue Not Processing

**Symptoms:**
- Jobs stuck in waiting state
- No job completion
- Worker not active

**Resolution:**
1. Check Redis connection
2. Verify worker is running
3. Check for errors in worker logs
4. Restart queue worker
5. Clear stuck jobs if needed

### Issue: High Queue Depth

**Symptoms:**
- Thousands of waiting jobs
- Processing lag increasing
- Memory usage high

**Resolution:**
1. Increase worker concurrency
2. Add more worker instances
3. Optimize job processing
4. Implement batch processing
5. Scale Redis if needed

---

## WebSocket Connection Issues

### Issue: Clients Not Receiving Updates

**Symptoms:**
- WebSocket connections dropping
- No real-time updates
- Connection errors in client logs

**Resolution:**
1. Check WebSocket server status
2. Verify event emission in handlers
3. Check room subscriptions
4. Monitor connection count
5. Check for rate limiting

---

## External Service Failures

### Issue: Alchemy API Failures

**Symptoms:**
- Metadata fetch failures
- Rate limit errors
- API timeout errors

**Resolution:**
1. Check API key validity
2. Verify rate limits
3. Implement retry logic
4. Use fallback providers
5. Cache metadata responses

### Issue: IPFS Gateway Timeouts

**Symptoms:**
- Image/metadata load failures
- Gateway timeout errors
- Slow metadata fetching

**Resolution:**
1. Use multiple IPFS gateways
2. Implement timeout handling
3. Cache IPFS content
4. Consider pinning important content
5. Use CDN for frequently accessed content

---

## Emergency Procedures

### Complete System Restart

**When to Use:**
- Multiple critical failures
- Data corruption suspected
- After major configuration changes

**Steps:**
1. Stop all services:
```bash
docker-compose down
# or
pm2 stop all
```

2. Backup database:
```bash
pg_dump -U user -d dbname > backup_$(date +%Y%m%d_%H%M%S).sql
```

3. Clear Redis (if needed):
```bash
redis-cli FLUSHALL
```

4. Start services:
```bash
docker-compose up -d
# or
pm2 start all
```

5. Monitor health:
```bash
watch -n 5 'curl -s http://localhost:3001/health | jq'
```

6. Verify event processing:
```sql
SELECT COUNT(*) FROM nft_transfers 
WHERE "createdAt" > NOW() - INTERVAL '5 minutes';
```

### Data Recovery

**When to Use:**
- Data loss detected
- Corruption in database
- Need to restore from backup

**Steps:**
1. Stop services
2. Restore from backup:
```bash
psql -U user -d dbname < backup_file.sql
```
3. Verify data integrity
4. Restart services
5. Resync recent blocks if needed

---

## Contact Information

**On-Call Escalation:**
- Level 1: DevOps Team
- Level 2: Backend Engineering Team
- Level 3: System Architect

**External Support:**
- Database: PostgreSQL Support
- Queue: Redis Support
- Blockchain: RPC Provider Support

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-03  
**Maintained By**: DevOps Team
