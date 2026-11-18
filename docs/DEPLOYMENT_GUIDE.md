# NFT Indexer Deployment Guide

## Overview

This guide covers the complete deployment process for the NFT Indexer service, from initial setup to production deployment.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Configuration](#environment-configuration)
3. [Database Setup](#database-setup)
4. [Service Configuration](#service-configuration)
5. [Deployment Steps](#deployment-steps)
6. [Post-Deployment](#post-deployment)
7. [Monitoring Setup](#monitoring-setup)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

- **Node.js**: v18 or higher
- **PostgreSQL**: v14 or higher
- **Redis**: v6 or higher (optional, for caching)
- **Memory**: Minimum 2GB RAM, recommended 4GB+
- **Storage**: Minimum 50GB, recommended 100GB+ for production

### Required Accounts

- Alchemy API account (for NFT metadata)
- RPC provider accounts for each chain (Infura, Alchemy, QuickNode, etc.)
- Database hosting (if not self-hosted)

---

## Environment Configuration

### 1. Copy Environment Template

```bash
cp .env.example .env
```

### 2. Configure Environment Variables

Edit `.env` file with your configuration:

```bash
# Database
DATABASE_URL="postgresql://user:password@host:5432/database"

# Alchemy API Keys (one per chain)
ALCHEMY_API_KEY_ETHEREUM="your-ethereum-key"
ALCHEMY_API_KEY_POLYGON="your-polygon-key"
ALCHEMY_API_KEY_ARBITRUM="your-arbitrum-key"
ALCHEMY_API_KEY_OPTIMISM="your-optimism-key"
ALCHEMY_API_KEY_BASE="your-base-key"

# RPC URLs (fallback providers)
RPC_URL_ETHEREUM="https://eth-mainnet.g.alchemy.com/v2/your-key"
RPC_URL_POLYGON="https://polygon-mainnet.g.alchemy.com/v2/your-key"
RPC_URL_ARBITRUM="https://arb-mainnet.g.alchemy.com/v2/your-key"
RPC_URL_OPTIMISM="https://opt-mainnet.g.alchemy.com/v2/your-key"
RPC_URL_BASE="https://base-mainnet.g.alchemy.com/v2/your-key"

# Redis (optional)
REDIS_URL="redis://localhost:6379"

# Service Configuration
PORT=3000
NODE_ENV=production
LOG_LEVEL=info

# Indexer Configuration
ENABLE_NFT_INDEXING=true
ENABLE_MARKETPLACE_INDEXING=true
BATCH_SIZE=100
SYNC_INTERVAL_MS=5000

# Cache Configuration
CACHE_TTL_METADATA=3600
CACHE_TTL_CONTRACT=86400
CACHE_TTL_FLOOR_PRICE=300

# Rate Limiting
RATE_LIMIT_RPC=10
RATE_LIMIT_ALCHEMY=25

# Monitoring
ENABLE_HEALTH_CHECKS=true
HEALTH_CHECK_INTERVAL_MS=60000
```

### 3. Marketplace Contract Addresses

Create `config/marketplace-contracts.json`:

```json
{
  "1": {
    "OPENSEA": {
      "seaport": ["0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC"],
      "wyvern": ["0x7f268357A8c2552623316e2562D90e642bB538E5"]
    },
    "BLUR": {
      "main": ["0x000000000000Ad05Ccc4F10045630fb830B95127"]
    },
    "LOOKSRARE": {
      "v1": ["0x59728544B08AB483533076417FbBB2fD0B17CE3a"],
      "v2": ["0x0000000000E655fAe4d56241588680F86E3b2377"]
    },
    "X2Y2": {
      "main": ["0x74312363e45DCaBA76c59ec49a7Aa8A65a67EeD3"]
    }
  },
  "137": {
    "OPENSEA": {
      "seaport": ["0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC"]
    }
  }
}
```

---

## Database Setup

### 1. Create Database

```sql
CREATE DATABASE nft_indexer;
CREATE USER nft_indexer_user WITH ENCRYPTED PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE nft_indexer TO nft_indexer_user;
```

### 2. Run Migrations

```bash
# Generate Prisma Client
npx prisma generate

# Run migrations (for fresh database)
npx prisma migrate deploy

# OR use db push (for existing database with data)
npx prisma db push
```

### 3. Seed Initial Data

```bash
# Seed chains
npx tsx scripts/seed-chains.ts

# Seed marketplace contracts
npx tsx scripts/seed-marketplace-contracts.ts
```

---

## Service Configuration

### 1. Install Dependencies

```bash
npm install
```

### 2. Build Application

```bash
npm run build
```

### 3. Test Configuration

```bash
# Test database connection
npx prisma db pull

# Test RPC connections
npm run test:rpc

# Test Alchemy API
npm run test:alchemy
```

---

## Deployment Steps

### Option 1: Docker Deployment (Recommended)

#### 1. Build Docker Image

```bash
docker build -t nft-indexer:latest .
```

#### 2. Run with Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  nft-indexer:
    image: nft-indexer:latest
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - ALCHEMY_API_KEY_ETHEREUM=${ALCHEMY_API_KEY_ETHEREUM}
      # ... other env vars
    restart: unless-stopped
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:14
    environment:
      - POSTGRES_DB=nft_indexer
      - POSTGRES_USER=nft_indexer_user
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:6
    restart: unless-stopped

volumes:
  postgres_data:
```

```bash
docker-compose up -d
```

### Option 2: PM2 Deployment

#### 1. Install PM2

```bash
npm install -g pm2
```

#### 2. Create PM2 Ecosystem File

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'nft-indexer',
      script: './dist/index.js',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '1G',
    },
  ],
};
```

#### 3. Start Service

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Option 3: Systemd Service

#### 1. Create Service File

```ini
# /etc/systemd/system/nft-indexer.service
[Unit]
Description=NFT Indexer Service
After=network.target postgresql.service

[Service]
Type=simple
User=nft-indexer
WorkingDirectory=/opt/nft-indexer
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=nft-indexer
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

#### 2. Enable and Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable nft-indexer
sudo systemctl start nft-indexer
sudo systemctl status nft-indexer
```

---

## Post-Deployment

### 1. Verify Service Health

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "pass" },
    "rpcConnections": { "status": "pass" },
    "listeners": { "status": "pass" }
  }
}
```

### 2. Start Indexing

```bash
# Start listeners for all configured chains
curl -X POST http://localhost:3000/api/admin/listeners/start-all

# Or start specific chain
curl -X POST http://localhost:3000/api/admin/listeners/start \
  -H "Content-Type: application/json" \
  -d '{"chainId": 1}'
```

### 3. Trigger Historical Sync (Optional)

```bash
# Sync specific collection
curl -X POST http://localhost:3000/api/admin/sync/historical \
  -H "Content-Type: application/json" \
  -d '{
    "chainId": 1,
    "contractAddress": "0x...",
    "startBlock": 12345678,
    "endBlock": 12456789
  }'
```

### 4. Verify Indexing

```bash
# Check sync status
curl http://localhost:3000/api/health/sync

# Check indexed NFTs
curl http://localhost:3000/api/nft/contract/1/0x...
```

---

## Monitoring Setup

### 1. Enable Health Checks

Health checks run automatically if `ENABLE_HEALTH_CHECKS=true`.

Access health dashboard:
```
http://localhost:3000/api/health
```

### 2. Set Up Logging

Configure log aggregation (optional):

```bash
# Using Winston with file transport
npm install winston winston-daily-rotate-file

# Logs will be in ./logs directory
```

### 3. Set Up Alerts

Configure alerting in `src/lib/monitoring/error-handler.ts`:

```typescript
// Example: Slack webhook
export async function sendAlert(error: Error, severity: ErrorSeverity) {
  if (severity === ErrorSeverity.CRITICAL) {
    await fetch('https://hooks.slack.com/services/YOUR/WEBHOOK/URL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 CRITICAL: ${error.message}`,
      }),
    });
  }
}
```

### 4. Monitor Performance

```bash
# Check performance metrics
curl http://localhost:3000/api/health/metrics

# Check error logs
curl http://localhost:3000/api/admin/errors/recent
```

---

## Troubleshooting

### Service Won't Start

**Check logs:**
```bash
# Docker
docker logs nft-indexer

# PM2
pm2 logs nft-indexer

# Systemd
sudo journalctl -u nft-indexer -f
```

**Common issues:**
- Database connection failed: Check `DATABASE_URL`
- RPC connection failed: Check RPC URLs and API keys
- Port already in use: Change `PORT` in `.env`

### Indexing Not Working

**Check listener status:**
```bash
curl http://localhost:3000/api/health/sync
```

**Restart listeners:**
```bash
curl -X POST http://localhost:3000/api/admin/listeners/restart-all
```

**Check RPC rate limits:**
- Verify API key limits not exceeded
- Check `RATE_LIMIT_RPC` setting

### High Memory Usage

**Reduce batch size:**
```bash
BATCH_SIZE=50  # Default is 100
```

**Increase memory limit (PM2):**
```javascript
max_memory_restart: '2G'
```

**Enable garbage collection:**
```bash
node --max-old-space-size=2048 --expose-gc dist/index.js
```

### Database Performance Issues

**Add indexes:**
```sql
-- Already included in schema, but verify:
CREATE INDEX IF NOT EXISTS idx_nft_contract_token 
  ON nfts(contract_address, token_id, chain_id);

CREATE INDEX IF NOT EXISTS idx_transfers_block 
  ON nft_transfers(block_number);
```

**Optimize queries:**
```bash
# Analyze slow queries
npx prisma studio
```

### Sync Lag

**Increase sync interval:**
```bash
SYNC_INTERVAL_MS=3000  # Default is 5000
```

**Add more RPC providers:**
- Use multiple providers for load balancing
- Configure fallback providers

---

## Backup and Recovery

### Database Backup

```bash
# Automated daily backup
pg_dump -U nft_indexer_user nft_indexer > backup_$(date +%Y%m%d).sql

# Restore from backup
psql -U nft_indexer_user nft_indexer < backup_20240101.sql
```

### Configuration Backup

```bash
# Backup environment and config
tar -czf config_backup.tar.gz .env config/
```

---

## Scaling

### Horizontal Scaling

1. Deploy multiple instances
2. Use load balancer (nginx, HAProxy)
3. Separate read/write database replicas
4. Use Redis for distributed caching

### Vertical Scaling

1. Increase server resources
2. Optimize database queries
3. Tune PostgreSQL configuration
4. Enable connection pooling

---

## Security Checklist

- [ ] Use strong database passwords
- [ ] Enable SSL for database connections
- [ ] Restrict API access with authentication
- [ ] Use environment variables for secrets
- [ ] Enable rate limiting
- [ ] Keep dependencies updated
- [ ] Monitor for security vulnerabilities
- [ ] Use HTTPS for production
- [ ] Implement proper CORS policies
- [ ] Regular security audits

---

## Support

For issues or questions:
- Check logs first
- Review this guide
- Check API documentation
- Contact development team

---

## Changelog

### v1.0.0 (2024-01-01)
- Initial deployment guide
- Docker and PM2 deployment options
- Monitoring and troubleshooting sections
