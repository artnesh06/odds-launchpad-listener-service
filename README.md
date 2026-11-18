# NFT Activity Listener Service

Layanan terpisah untuk monitoring aktivitas blockchain NFT secara real-time 24/7 menggunakan Ponder.sh framework (v0.16.1).

## 📋 Deskripsi

Service ini adalah bagian terpisah dari aplikasi NFT Launchpad yang berfungsi untuk:
- 🎧 Monitoring event blockchain secara real-time dengan Ponder.sh
- 📊 Menyimpan aktivitas ke database PostgreSQL
- 🔄 Dynamic launchpad management via API
- 🌐 Support multi-chain (MegaETH, Sepolia, Monad, dll)
- 📖 Interactive API documentation dengan Swagger
- ⚡ Unlimited scalability dengan production-ready indexing framework



## 🌐 API Documentation

Service ini menyediakan Swagger UI untuk dokumentasi API interaktif:

**Local:** `http://localhost:3001/api-docs`  
**Production:** `https://your-app.railway.app/api-docs`

### Ponder GraphQL API (v0.16.1)

Ponder provides an auto-generated GraphQL API for querying indexed blockchain data:

**Local:** `http://localhost:42069/graphql`  
**Production:** Configure port in deployment

**Example Query**:
```graphql
query {
  transfers(
    limit: 10
    orderBy: "blockTimestamp"
    orderDirection: "desc"
    where: { contractAddress: "0xabc..." }
  ) {
    items {
      id
      from
      to
      tokenId
      blockNumber
      blockTimestamp
    }
  }
}
```

**Note:** Ponder 0.16.1 includes improved live indexing performance (50+ ops/sec) and better RPC load balancing.

### REST API Endpoints

**Launchpad NFTs**:
```bash
GET /api/launchpads/{chainId}/{contractAddress}/nfts
```

**Launchpad Activities**:
```bash
GET /api/launchpads/{chainId}/{contractAddress}/activities
```

**Launchpad Phases**:
```bash
GET /api/launchpads/{chainId}/{contractAddress}/phases
```

**Launchpad Stats**:
```bash
GET /api/launchpads/{chainId}/{contractAddress}/stats
```

**Admin Endpoints** (require API key):
```bash
POST /api/admin/ponder/launchpads/register
DELETE /api/admin/ponder/launchpads/{chainId}/{address}
POST /api/admin/ponder/sync
GET /api/admin/ponder/status
```

Lihat [API_DOCUMENTATION.md](./docs/API_DOCUMENTATION.md) dan [SWAGGER_SETUP.md](./docs/SWAGGER_SETUP.md) untuk detail lengkap.

## 🎯 Architecture

### Hybrid Approach: Ponder + Custom API

```
┌─────────────────────────────────────────────────────────────┐
│                    Blockchain Networks                       │
│         (MegaETH, Sepolia, Monad, etc.)                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ RPC (WebSocket)
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                   Ponder Framework (v0.16.1)                │
│  • Historical backfill (from start block)                   │
│  • Real-time indexing (new blocks, 50+ ops/sec)            │
│  • Event processing (24 event types)                        │
│  • Automatic retry & error handling                         │
│  • Built-in optimizations & RPC load balancing             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Database Writes
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                   PostgreSQL Database                        │
│  • Ponder tables (Transfer, Mint, Phase, etc.)             │
│  • Existing tables (users, launchpads, etc.)               │
│  • PostgreSQL triggers (NOTIFY on INSERT)                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ Queries & LISTEN/NOTIFY
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                   Custom API (Express)                       │
│  • REST endpoints (query Ponder tables)                     │
│  • WebSocket server (real-time updates)                     │
│  • Admin endpoints (launchpad management)                   │
│  • Database change listener (PostgreSQL LISTEN)             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ HTTP/WebSocket
                         ↓
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Clients                          │
│  • Real-time NFT updates                                    │
│  • Live mint notifications                                  │
│  • Phase change alerts                                      │
└─────────────────────────────────────────────────────────────┘
```

### Key Benefits

**Ponder Handles**:
- ✅ Blockchain event listening (all chains)
- ✅ Historical data synchronization
- ✅ RPC optimization and retry logic
- ✅ Event processing and validation
- ✅ Database writes and indexing
- ✅ Unlimited launchpad scalability

**Custom API Handles**:
- ✅ REST API endpoints
- ✅ WebSocket real-time updates
- ✅ Business logic and transformations
- ✅ Dynamic launchpad management
- ✅ Authentication and authorization

**Result**: 80% reduction in infrastructure code, production-ready indexing, unlimited scalability.

## 🚀 Quick Start

### Local Development (Recommended)

**Windows**:
```bash
# Run quick start script
start-local.bat
```

**Mac/Linux**:
```bash
# Make script executable (first time only)
chmod +x start-local.sh

# Run quick start script
./start-local.sh
```

The script will:
1. ✅ Check Node.js installation
2. ✅ Create .env from .env.example (if not exists)
3. ✅ Install dependencies
4. ✅ Generate Prisma Client
5. ✅ Check database connection
6. ✅ Start application

**Manual Setup**:

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment Variables

Copy file `.env.example` ke `.env` dan isi dengan konfigurasi Anda:

```bash
# Windows
copy .env.example .env

# Mac/Linux
cp .env.example .env
```

Edit `.env`:
```env
# Database (pilih salah satu)
# Local PostgreSQL:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nft_launchpad?schema=public"

# Docker PostgreSQL:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nft_launchpad?schema=public"

# Supabase:
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

# RPC URLs (gunakan public RPC untuk testing)
MEGAETH_RPC_URL="https://timothy.megaeth.com"
SEPOLIA_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/demo"
MONAD_RPC_URL="https://testnet.monad.xyz"

# Master Factory Addresses
MASTER_FACTORY_ADDRESS_MEGAETH="0x89C05c6d454742DdE267c3C01dF1CD69Fd0F64B0"
MASTER_FACTORY_ADDRESS_SEPOLIA="0xB759B92CB8493342ABD53103E2Db5cd20E549975"
MASTER_FACTORY_ADDRESS_MONAD="0x292d4516a315B3DD53537F1532EAAaA26194aBA6"

# Ponder Configuration
PONDER_ENABLE_HISTORICAL_SYNC="true"
PONDER_LOG_LEVEL="info"

# WebSocket Configuration
WEBSOCKET_PORT="3002"
WEBSOCKET_CORS_ORIGIN="http://localhost:3000,http://localhost:3004"

# Blockchain Event Listener Configuration (Optional)
# Enable WebSocket for real-time mint events on featured launchpads
WEBSOCKET_ENABLED="false"
WEBSOCKET_PROVIDER_URL=""  # Required when enabled, e.g., wss://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
```

**For complete environment variable documentation, see [ENVIRONMENT_VARIABLES.md](./docs/ENVIRONMENT_VARIABLES.md)**

### 3. Setup Database

**Option A: Local PostgreSQL**
```bash
# Create database
psql -U postgres
CREATE DATABASE nft_launchpad;
\q
```

**Option B: Docker PostgreSQL**
```bash
docker run -d \
  --name postgres-dev \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nft_launchpad \
  -p 5432:5432 \
  postgres:14
```

**Option C: Supabase (Free)**
- Sign up di https://supabase.com
- Create new project
- Copy connection string

### 4. Generate Prisma Client & Apply Migrations

```bash
# Generate Prisma Client
npm run db:generate

# Push schema to database
npm run db:push

# Apply Ponder triggers
# Windows (PowerShell):
Get-Content prisma/migrations/add_ponder_triggers.sql | psql $env:DATABASE_URL

# Mac/Linux:
psql $DATABASE_URL < prisma/migrations/add_ponder_triggers.sql
```

### 5. Start Application

**Option A: Run Everything (Recommended)**
```bash
npm start
```

**Option B: Run Separately (For Development)**

Terminal 1 - Ponder:
```bash
npm run ponder:dev
```

Terminal 2 - API:
```bash
npm run dev
```

### 6. Verify Running

```bash
# Check health
curl http://localhost:3001/health

# Open Swagger UI
# Visit: http://localhost:3001/api-docs

# Open Ponder GraphQL
# Visit: http://localhost:42069/graphql
```

**For detailed local development guide, see [LOCAL_DEVELOPMENT_GUIDE.md](./docs/LOCAL_DEVELOPMENT_GUIDE.md)**

## 📦 Deployment

### GitHub Actions (Recommended for Production)

Aplikasi ini menggunakan GitHub Actions untuk automated deployment ke production server.

**Deployment Flow**:
1. Push ke branch `main` atau manual trigger
2. Security scan dengan Trivy
3. Build Docker image
4. Push ke GitHub Container Registry
5. Deploy ke production server via SSH
6. Health check verification
7. Automatic rollback jika gagal

**Setup Requirements**:
- GitHub Secrets configured (see [Pre-Deployment Checklist](./docs/PONDER_PRE_DEPLOYMENT_CHECKLIST.md))
- Production server dengan Docker & Docker Compose
- Traefik reverse proxy untuk SSL/TLS
- PostgreSQL database accessible

**Deployment Guides**:
- **[PONDER_PRE_DEPLOYMENT_CHECKLIST.md](./docs/PONDER_PRE_DEPLOYMENT_CHECKLIST.md)** - Pre-deployment checklist
- **[PONDER_DEPLOYMENT_GUIDE.md](./docs/PONDER_DEPLOYMENT_GUIDE.md)** - Complete deployment guide

**Quick Deploy**:
```bash
# 1. Ensure all checklist items are completed
# 2. Commit and push to main
git add .
git commit -m "feat: ready for deployment"
git push origin main

# 3. Monitor deployment
# Visit: https://github.com/your-org/your-repo/actions

# 4. Verify deployment
curl https://backend.oddslaunchpad.com/health
```

### Docker (Manual Deployment)

**Build and Run**:
```bash
# Build image
docker build -t nft-ponder-service .

# Run with docker-compose
docker compose up -d

# Check logs
docker compose logs -f nft-listener

# Check health
curl http://localhost:3001/health
```

**Docker Compose Configuration**:
- Traefik reverse proxy with SSL/TLS
- Automatic certificate management (Let's Encrypt)
- Rate limiting and security headers
- Health checks and auto-restart

### Railway (Alternative)

**Deploy to Railway**:
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up

# Set environment variables
railway variables set DATABASE_URL="your-database-url"
railway variables set MEGAETH_RPC_URL="wss://your-rpc-url"
railway variables set MASTER_FACTORY_ADDRESS_MEGAETH="0x..."
```

**Important**: Set start command to `npm start` in Railway dashboard (runs both Ponder and API).

### Process Managers (Alternative)

**PM2**:
```bash
# Start application (includes Ponder)
pm2 start npm --name nft-listener -- start

# Save configuration
pm2 save

# Setup startup script
pm2 startup
```

**systemd**:
```bash
# Create service file: /etc/systemd/system/nft-listener.service
[Unit]
Description=NFT Listener Service with Ponder
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/project
ExecStart=/usr/bin/npm start
Restart=always

[Install]
WantedBy=multi-user.target

# Enable and start
sudo systemctl enable nft-listener
sudo systemctl start nft-listener
```

### Environment-Specific Notes

**Production (GitHub Actions)**: 
- Automated deployment with rollback
- SSL/TLS via Traefik + Let's Encrypt
- Health checks and monitoring
- See [PONDER_DEPLOYMENT_GUIDE.md](./docs/PONDER_DEPLOYMENT_GUIDE.md)

**Railway**: 
- Use WebSocket RPC URLs for better performance
- Set start command to `npm start`
- Configure environment variables in dashboard

**Render**: 
- Set build command to `npm install && npm run db:generate`
- Set start command to `npm start`

**Heroku**: 
- Use Heroku Postgres add-on for database
- Set buildpacks for Node.js

**AWS**: 
- Consider using ECS or EC2 for long-running process
- Use RDS for PostgreSQL

**Vercel**: 
- Not recommended (long-running process not supported)

## 🔧 Available Scripts

### Ponder (Blockchain Indexing)
- `npm run ponder:dev` - Run Ponder in development mode with hot reload
- `npm run ponder:start` - Run Ponder in production mode
- `npm run ponder:codegen` - Generate TypeScript types from schema

### Custom API
- `npm start` - Run custom API in production mode
- `npm run dev` - Run custom API with auto-reload (development)
- `npm run build` - Compile TypeScript to JavaScript

### Testing
- `npm test` - Run unit tests
- `npm run test:watch` - Run tests in watch mode

### Database
- `npm run db:generate` - Generate Prisma Client
- `npm run db:push` - Push schema changes to database
- `npm run db:migrate` - Run database migrations

### Utilities
- `npm run scan-history` - Scan historical events (legacy)
- `npm run test-events` - Test real events (legacy)
- `npm run deploy-test` - Auto-find owned launchpad and test (legacy)

## 📁 Project Structure

```
nft-listener-service/
├── src/
│   ├── index.ts                    # Custom API entry point
│   ├── config/
│   │   ├── database.ts             # Prisma client
│   │   ├── chains.ts               # Chain configurations
│   │   └── websocket.ts            # WebSocket configuration
│   ├── lib/
│   │   ├── ponder/                 # Ponder utilities
│   │   │   ├── config-manager.ts   # Dynamic config management
│   │   │   ├── hot-reload.ts       # Config change detection
│   │   │   ├── validation.ts       # Launchpad validation
│   │   │   ├── logger.ts           # Ponder logging
│   │   │   ├── metrics.ts          # Performance metrics
│   │   │   └── alert-manager.ts    # Alert system
│   │   ├── database/
│   │   │   └── change-listener.ts  # PostgreSQL LISTEN/NOTIFY
│   │   ├── websocket/              # WebSocket manager
│   │   ├── queries/                # Database queries
│   │   │   └── ponder-queries.ts   # Query Ponder tables
│   │   └── blockchain/             # Legacy event listeners
│   ├── ponder/                     # Ponder indexing functions
│   │   ├── Transfer.ts             # Transfer event handler
│   │   ├── Minted.ts               # Mint event handler
│   │   ├── PhaseAdded.ts           # Phase event handler
│   │   ├── Burned.ts               # Burn event handler
│   │   └── ... (20+ event handlers)
│   └── api/
│       ├── index.ts                # API routes
│       └── admin/                  # Admin endpoints
│           └── ponder-launchpad-management.ts
├── ponder.config.ts                # Ponder configuration
├── ponder.schema.ts                # Database schema for Ponder
├── prisma/
│   ├── schema.prisma               # Prisma schema
│   └── migrations/
│       └── add_ponder_triggers.sql # PostgreSQL triggers
├── abi/                            # Contract ABIs
│   ├── OddsLaunchpad.json
│   └── OddsLaunchpadFactory.json
├── docs/                           # Documentation
│   ├── PONDER_SETUP.md
│   ├── PONDER_SYNC_INSTRUCTIONS.md
│   ├── PONDER_API_INTEGRATION.md
│   ├── PONDER_FIRST_RUN.md
│   ├── PONDER_START_BLOCKS.md
│   ├── PONDER_HOT_RELOAD_LIMITATIONS.md
│   ├── PONDER_DYNAMIC_LAUNCHPAD_MANAGEMENT.md
│   ├── PONDER_MONITORING.md
│   └── PONDER_TROUBLESHOOTING.md
├── package.json
├── tsconfig.json
└── README.md
```

## 🌐 Supported Chains

- **MegaETH** (Primary)
- **Sepolia Testnet**
- **Monad Testnet**
- Ethereum Mainnet (configurable)
- Polygon (configurable)
- BSC (configurable)
- Arbitrum (configurable)
- Optimism (configurable)
- Base (configurable)

**Note**: Ponder 0.16.1 supports any EVM-compatible chain. Add new chains in `ponder.config.ts` using the `chains` configuration (renamed from `networks` in v0.11+).

## 📊 Monitored Events

Ponder indexes all 24 event types from OddsLaunchpad contracts:

### User Events
- **Transfer** - NFT transfers and mints
- **Minted** - Mint events with quantity
- **Burned** - NFT burns
- **Airdropped** - Batch airdrops
- **PhaseAdded** - New mint phases
- **PhaseUpdated** - Phase modifications
- **Revealed** - Metadata reveals

### Admin Events
- **TreasuryUpdated** - Treasury address changes
- **Withdrawn** - Fund withdrawals
- **OwnershipTransferred** - Ownership changes
- **PlatformFeeToggled** - Fee toggles
- **PlatformFlatFeeUpdated** - Fee updates
- **RoyaltyUpdated** - Royalty changes

### Metadata Events
- **BaseURIUpdated** - Base URI changes
- **ContractURIUpdated** - Contract URI changes
- **ExternalLinkUpdated** - External link changes
- **BatchMetadataUpdate** - Batch metadata updates

### Security Events
- **Paused** - Contract pauses
- **Unpaused** - Contract unpauses
- **TransferLockUpdated** - Transfer lock changes
- **RoleGranted** - Role grants
- **RoleRevoked** - Role revocations

### Factory Events
- **ContractDeployed** - New launchpad deployments

All events are automatically indexed by Ponder and stored in PostgreSQL.

## 🔍 Monitoring

### Ponder Status

Check Ponder indexing status:

```bash
# View Ponder logs
npm run ponder:dev  # Development mode with detailed logs

# Check GraphQL playground
# Visit: http://localhost:42069/graphql
```

### Health Check Endpoint

```bash
curl http://localhost:3000/api/health
```

Response includes:
- Ponder status
- Last synced block
- Indexing rate
- Error count
- Database connection status

### Database Queries

```sql
-- Check recent transfers
SELECT * FROM "Transfer" 
ORDER BY "blockTimestamp" DESC 
LIMIT 20;

-- Check mint events
SELECT * FROM "Mint"
ORDER BY "blockTimestamp" DESC
LIMIT 20;

-- Check events in last hour
SELECT COUNT(*) FROM "Transfer" 
WHERE "blockTimestamp" > EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour');

-- Check events by launchpad
SELECT "contractAddress", COUNT(*) 
FROM "Transfer" 
GROUP BY "contractAddress";
```

### Ponder Metrics

Ponder exposes metrics at:
```
http://localhost:42069/metrics
```

Metrics include:
- Indexing progress
- Events processed
- RPC request rate
- Database write rate
- Error rate

## 🐛 Troubleshooting

### Ponder Not Starting

**Symptoms**: Ponder fails to start or crashes immediately

**Solutions**:
1. Check DATABASE_URL is correct
2. Verify RPC URLs are accessible (use WebSocket URLs for better performance)
3. Ensure Master Factory addresses are set
4. Check ABI files exist in `abi/` directory
5. Verify `ponder` package is installed (not `@ponder/core`)
6. Check that imports use `ponder:registry` and `ponder:schema` (not `@/generated`)
7. Review Ponder logs for specific errors

### Slow Historical Sync

**Symptoms**: Sync taking hours or days

**Solutions**:
1. Optimize start blocks (see [PONDER_START_BLOCKS.md](./docs/PONDER_START_BLOCKS.md))
2. Use WebSocket RPC URLs instead of HTTP
3. Upgrade RPC provider plan
4. Allocate more memory: `NODE_OPTIONS="--max-old-space-size=4096" npm run ponder:dev`

### Events Not Being Indexed

**Symptoms**: No events appearing in database

**Solutions**:
1. Verify Ponder is running: check logs
2. Check contract addresses in `ponder.config.ts`
3. Verify start blocks are before first events
4. Check RPC connection is working
5. Review indexing function errors in logs

### RPC Rate Limiting

**Symptoms**: "Rate limit exceeded" errors

**Solutions**:
1. Use WebSocket URLs (already configured)
2. Upgrade to paid RPC plan
3. Increase start blocks to reduce scan range
4. Use multiple RPC providers

### Database Connection Errors

**Symptoms**: Connection timeouts or failures

**Solutions**:
1. Verify DATABASE_URL format
2. Check database is running and accessible
3. Ensure connection pool limits are adequate
4. Check database disk space

### Configuration Changes Not Applied

**Symptoms**: Added launchpad but not being indexed

**Solutions**:
1. Restart Ponder after config changes (required in v0.16.1)
2. Check `ponder.config.ts` uses `chains` (not `networks`)
3. Verify chain configs use `id` (not `chainId`) and `rpc` (not `transport`)
4. Review [PONDER_HOT_RELOAD_LIMITATIONS.md](./docs/PONDER_HOT_RELOAD_LIMITATIONS.md)

For detailed troubleshooting, see [PONDER_TROUBLESHOOTING.md](./docs/PONDER_TROUBLESHOOTING.md)

## 📚 Documentation

### Ponder Integration
- **[PONDER_SETUP.md](./PONDER_SETUP.md)** - Initial Ponder setup guide
- **[PONDER_SYNC_INSTRUCTIONS.md](./PONDER_SYNC_INSTRUCTIONS.md)** - Historical sync guide
- **[PONDER_FIRST_RUN.md](./docs/PONDER_FIRST_RUN.md)** - First run checklist
- **[PONDER_START_BLOCKS.md](./docs/PONDER_START_BLOCKS.md)** - Start block optimization
- **[PONDER_API_INTEGRATION.md](./PONDER_API_INTEGRATION.md)** - API integration guide
- **[PONDER_DYNAMIC_LAUNCHPAD_MANAGEMENT.md](./docs/PONDER_DYNAMIC_LAUNCHPAD_MANAGEMENT.md)** - Dynamic launchpad management
- **[PONDER_HOT_RELOAD_LIMITATIONS.md](./docs/PONDER_HOT_RELOAD_LIMITATIONS.md)** - Configuration reload limitations
- **[PONDER_MONITORING.md](./docs/PONDER_MONITORING.md)** - Monitoring and observability
- **[PONDER_TROUBLESHOOTING.md](./docs/PONDER_TROUBLESHOOTING.md)** - Common issues and solutions

### API Documentation
- **[LOCAL_DEVELOPMENT_GUIDE.md](./docs/LOCAL_DEVELOPMENT_GUIDE.md)** - Complete local development guide
- **[API_DOCUMENTATION.md](./docs/API_DOCUMENTATION.md)** - REST API reference
- **[SWAGGER_SETUP.md](./docs/SWAGGER_SETUP.md)** - Swagger UI setup
- **[EVENT_HANDLERS_API.md](./docs/EVENT_HANDLERS_API.md)** - Event handler API

### Configuration
- **[ENVIRONMENT_VARIABLES.md](./docs/ENVIRONMENT_VARIABLES.md)** - Complete environment variables reference
- **[src/config/README.md](./src/config/README.md)** - Configuration modules documentation

### Deployment
- **[PONDER_PRE_DEPLOYMENT_CHECKLIST.md](./docs/PONDER_PRE_DEPLOYMENT_CHECKLIST.md)** - Pre-deployment checklist
- **[PONDER_DEPLOYMENT_GUIDE.md](./docs/PONDER_DEPLOYMENT_GUIDE.md)** - Complete deployment guide
- **[DEPLOYMENT_GUIDE.md](./docs/DEPLOYMENT_GUIDE.md)** - Legacy deployment guide
- **[OPERATIONAL_RUNBOOKS.md](./docs/OPERATIONAL_RUNBOOKS.md)** - Operations guide

### Phase Index Consistency
- **[PHASE_INDEX_CONSISTENCY.md](./docs/PHASE_INDEX_CONSISTENCY.md)** - Complete phase index consistency guide
- **[PHASE_INDEX_QUICK_REFERENCE.md](./docs/PHASE_INDEX_QUICK_REFERENCE.md)** - Quick reference for phase indexing
- **[phase-index-verification-cli.md](./docs/phase-index-verification-cli.md)** - Verification tool documentation
- **[phase-index-repair-cli.md](./docs/phase-index-repair-cli.md)** - Repair tool documentation
- **[phase-index-repair-service.md](./docs/phase-index-repair-service.md)** - Repair service implementation

### Legacy Documentation
- **[SETUP.md](./SETUP.md)** - Legacy setup guide
- **[TESTING_REAL_EVENTS.md](./TESTING_REAL_EVENTS.md)** - Legacy testing guide
- **[QUICK_TEST_GUIDE.md](./QUICK_TEST_GUIDE.md)** - Legacy quick test reference

## 💰 Cost Estimates

### Recommended Production Setup
- **Railway Pro**: $20/month (Ponder + API)
- **Supabase Pro**: $25/month (PostgreSQL with better performance)
- **Alchemy Growth**: $49/month (Higher RPC limits)
- **Total**: ~$94/month

### Budget Setup
- **Railway Starter**: $5/month (Ponder only)
- **Supabase Free**: $0/month (Limited connections)
- **Alchemy Free**: $0/month (Rate limited)
- **Total**: $5/month

### Free Tier (Development/Testing)
- **Render Free**: $0/month (Cold starts, limited hours)
- **Supabase Free**: $0/month
- **Public RPC**: $0/month (Unreliable)
- **Total**: $0/month

**Note**: Free tier not recommended for production due to reliability issues.

## 🤝 Support

Jika ada masalah:
1. Check logs terlebih dahulu
2. Review dokumentasi
3. Test locally untuk isolate issue
4. Check GitHub issues

## 📝 License

MIT
