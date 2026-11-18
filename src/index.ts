import 'dotenv/config';
import http from 'http';
import { getMultiChainListenerManager } from './lib/blockchain/multi-chain-listener-manager';
import { dbSemaphore, startDatabaseHealthCheck, disconnectDatabase } from './config/database';
import { WebSocketManager } from './lib/websocket/websocket-manager';
import { getWebSocketConfig } from './config/websocket';
import { initializeQueueManager, initializeQueueWorker, getQueueManager, isRedisAvailable, isRedisConfigured } from './lib/queue';
import { swaggerSpec } from './config/swagger';
import { handleApiRequest } from './api';
import { DatabaseChangeListener } from './lib/database/change-listener';
import { EventEmitter } from './lib/websocket/event-emitter';

let isShuttingDown = false;
let httpServer: http.Server | null = null;
let websocketManager: WebSocketManager | null = null;
let queueWorkerActive = false;
let databaseChangeListener: DatabaseChangeListener | null = null;

// Make WebSocket Manager accessible globally for health checks
(global as any).websocketManager = null;

const DEFAULT_ORIGINS = [
  'https://launchpad.artnesh.com',
  'http://localhost:3000',
];

/** Browser origins allowed to call this API (CORS_ORIGINS, comma-separated). */
function getAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS || process.env.WEBSOCKET_CORS_ORIGIN;
  if (!raw) return DEFAULT_ORIGINS;
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

/** A chain whose poller has not completed a cycle for this long is considered stuck. */
const POLLER_STALE_MS = parseInt(process.env.WATCHDOG_STALE_MS || String(10 * 60_000), 10);

function getPollerReport() {
  const now = Date.now();
  return getMultiChainListenerManager().getPollerHealth().map(({ chainId, health }) => ({
    chainId,
    ...(health || {}),
    stale: !!health && health.running && (health.lastProgressAt === null || now - health.lastProgressAt > POLLER_STALE_MS),
  }));
}

/**
 * Start HTTP server for health checks (required by Railway)
 */
function startHealthServer(): Promise<void> {
  return new Promise((resolve) => {
    const port = parseInt(process.env.PORT || '3001', 10);
    
    httpServer = http.createServer(async (req, res) => {
      // CORS headers for all responses (allow-list from CORS_ORIGINS)
      const origin = req.headers.origin;
      if (origin && getAllowedOrigins().includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Admin-Api-Key, X-Creator-Address, X-Creator-Issued-At, X-Creator-Signature'
      );
      
      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost`);
      const pathname = url.pathname;

      // Swagger JSON spec
      if (pathname === '/api-docs.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(swaggerSpec, null, 2));
        return;
      }

      // Swagger UI HTML
      if (pathname === '/api-docs' || pathname === '/api-docs/') {
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Odds Launchpad API Documentation</title>
  <link rel="icon" type="image/png" href="https://oddslaunchpad.com/favicon.ico">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body { 
      margin: 0; 
      padding: 0; 
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fafafa;
    }
    
    /* Custom Header */
    .custom-header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: white;
      padding: 24px 40px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }
    .custom-header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .custom-header .subtitle {
      margin: 4px 0 0 0;
      font-size: 14px;
      opacity: 0.8;
      font-weight: 400;
    }
    .custom-header .badge {
      background: #10b981;
      color: white;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    
    /* Hide default topbar */
    .swagger-ui .topbar { display: none !important; }
    
    /* Main container styling */
    .swagger-ui .wrapper {
      max-width: 1400px;
      padding: 0 24px;
    }
    
    /* Info section */
    .swagger-ui .info {
      margin: 32px 0;
    }
    .swagger-ui .info .title {
      font-family: 'Inter', sans-serif;
      font-size: 28px;
      font-weight: 700;
      color: #1a1a2e;
    }
    .swagger-ui .info .description {
      font-family: 'Inter', sans-serif;
      font-size: 15px;
      line-height: 1.7;
      color: #4a5568;
    }
    .swagger-ui .info .description p {
      margin: 12px 0;
    }
    .swagger-ui .info .description h2 {
      font-size: 18px;
      color: #1a1a2e;
      margin-top: 24px;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 8px;
    }
    
    /* Tags/Sections */
    .swagger-ui .opblock-tag {
      font-family: 'Inter', sans-serif;
      font-size: 18px;
      font-weight: 600;
      color: #1a1a2e;
      border-bottom: 2px solid #e2e8f0;
      padding: 16px 0;
    }
    .swagger-ui .opblock-tag:hover {
      background: #f7fafc;
    }
    
    /* Operation blocks */
    .swagger-ui .opblock {
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      margin: 12px 0;
      border: 1px solid #e2e8f0;
    }
    .swagger-ui .opblock .opblock-summary {
      padding: 12px 16px;
    }
    .swagger-ui .opblock .opblock-summary-method {
      border-radius: 6px;
      font-weight: 600;
      font-size: 12px;
      min-width: 70px;
    }
    .swagger-ui .opblock .opblock-summary-path {
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
      font-size: 14px;
    }
    .swagger-ui .opblock .opblock-summary-description {
      font-family: 'Inter', sans-serif;
      font-size: 13px;
      color: #64748b;
    }
    
    /* GET method */
    .swagger-ui .opblock.opblock-get {
      border-color: #10b981;
      background: rgba(16, 185, 129, 0.03);
    }
    .swagger-ui .opblock.opblock-get .opblock-summary-method {
      background: #10b981;
    }
    .swagger-ui .opblock.opblock-get .opblock-summary {
      border-color: #10b981;
    }
    
    /* POST method */
    .swagger-ui .opblock.opblock-post {
      border-color: #3b82f6;
      background: rgba(59, 130, 246, 0.03);
    }
    .swagger-ui .opblock.opblock-post .opblock-summary-method {
      background: #3b82f6;
    }
    
    /* PUT method */
    .swagger-ui .opblock.opblock-put {
      border-color: #f59e0b;
      background: rgba(245, 158, 11, 0.03);
    }
    .swagger-ui .opblock.opblock-put .opblock-summary-method {
      background: #f59e0b;
    }
    
    /* DELETE method */
    .swagger-ui .opblock.opblock-delete {
      border-color: #ef4444;
      background: rgba(239, 68, 68, 0.03);
    }
    .swagger-ui .opblock.opblock-delete .opblock-summary-method {
      background: #ef4444;
    }
    
    /* Buttons */
    .swagger-ui .btn {
      border-radius: 6px;
      font-family: 'Inter', sans-serif;
      font-weight: 500;
      transition: all 0.2s ease;
    }
    .swagger-ui .btn.execute {
      background: #3b82f6;
      border-color: #3b82f6;
    }
    .swagger-ui .btn.execute:hover {
      background: #2563eb;
    }
    .swagger-ui .btn.authorize {
      border-color: #10b981;
      color: #10b981;
    }
    .swagger-ui .btn.authorize svg {
      fill: #10b981;
    }
    
    /* Models section */
    .swagger-ui section.models {
      border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    .swagger-ui section.models h4 {
      font-family: 'Inter', sans-serif;
      font-size: 16px;
      font-weight: 600;
    }
    
    /* Server selector */
    .swagger-ui .servers > label {
      font-family: 'Inter', sans-serif;
      font-weight: 500;
    }
    .swagger-ui .servers select {
      border-radius: 6px;
      font-family: 'Inter', sans-serif;
    }
    
    /* Response section */
    .swagger-ui .responses-wrapper {
      padding: 16px;
    }
    .swagger-ui .response-col_status {
      font-weight: 600;
    }
    
    /* Code blocks */
    .swagger-ui .highlight-code {
      border-radius: 6px;
    }
    
    /* Footer */
    .custom-footer {
      text-align: center;
      padding: 24px;
      color: #64748b;
      font-size: 13px;
      border-top: 1px solid #e2e8f0;
      margin-top: 40px;
    }
    .custom-footer a {
      color: #3b82f6;
      text-decoration: none;
    }
    .custom-footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="custom-header">
    <div>
      <h1>🚀 Odds Launchpad API</h1>
      <p class="subtitle">NFT Indexing & Marketplace Service</p>
    </div>
    <span class="badge">v1.0.0</span>
  </div>
  <div id="swagger-ui"></div>
  <div class="custom-footer">
    <p>© 2025 Odds Launchpad. <a href="https://oddslaunchpad.com" target="_blank">oddslaunchpad.com</a></p>
  </div>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/api-docs.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 2,
        docExpansion: "list",
        filter: true,
        showExtensions: true,
        showCommonExtensions: true,
        tryItOutEnabled: true
      });
    };
  </script>
</body>
</html>`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      // Handle API requests
      if (pathname.startsWith('/api/')) {
        const handled = await handleApiRequest(req, res, pathname, url);
        if (handled) return;
      }

      /**
       * @openapi
       * /health:
       *   get:
       *     tags:
       *       - Health
       *     summary: Get system health status
       *     description: Returns comprehensive health information including chain listeners, database, WebSocket, and queue status
       *     responses:
       *       200:
       *         description: System is healthy
       *         content:
       *           application/json:
       *             schema:
       *               $ref: '#/components/schemas/HealthStatus'
       *       500:
       *         description: System error
       *         content:
       *           application/json:
       *             schema:
       *               $ref: '#/components/schemas/Error'
       */

      if (pathname === '/health' || pathname === '/') {
        try {
          const manager = getMultiChainListenerManager();
          const statuses = await manager.getStatus();
          const activeCount = statuses.filter((s) => s.isRunning).length;
          const totalLaunchpads = statuses.reduce((sum, s) => sum + s.launchpadCount, 0);
          const dbStatus = dbSemaphore.getStatus();

          // Get WebSocket status if available
          let websocketStatus = null;
          try {
            const wsConfig = await import('./config/websocket');
            const config = wsConfig.getWebSocketConfig();
            websocketStatus = {
              configured: true,
              port: config.port,
              maxConnections: config.maxConnections,
              metricsEnabled: config.metricsEnabled
            };
          } catch (error) {
            // WebSocket not initialized yet
            websocketStatus = { configured: false };
          }

          // Get Queue status if available
          let queueStatus = null;
          try {
            const queueManager = getQueueManager();
            if (queueManager.isReady()) {
              const stats = await queueManager.getAllQueueStats();
              queueStatus = {
                initialized: true,
                queues: stats,
                workerActive: queueWorkerActive
              };
            } else {
              queueStatus = { initialized: false };
            }
          } catch (error) {
            queueStatus = { initialized: false, error: 'Queue not initialized' };
          }

          const pollers = getPollerReport();
          const degraded = pollers.some((p) => p.stale) || (statuses.length > 0 && activeCount === 0);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: degraded ? 'degraded' : 'healthy',
              timestamp: new Date().toISOString(),
              chains: {
                active: activeCount,
                total: statuses.length
              },
              pollers,
              launchpads: totalLaunchpads,
              database: {
                activeConnections: dbStatus.current,
                maxConnections: dbStatus.max,
                waiting: dbStatus.waiting
              },
              websocket: websocketStatus,
              queue: queueStatus
            })
          );
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: String(error) }));
        }
      } else if (pathname === '/health/websocket') {
        /**
         * @openapi
         * /health/websocket:
         *   get:
         *     tags:
         *       - Health
         *     summary: Get WebSocket health status
         *     description: Returns detailed WebSocket server health including connections, rooms, messages, and performance metrics
         *     responses:
         *       200:
         *         description: WebSocket health information
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/WebSocketHealth'
         *       503:
         *         description: WebSocket server not initialized
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/Error'
         */
        // WebSocket-specific health check endpoint
        try {
          // Get WebSocket manager instance from global
          const wsManager = (global as any).websocketManager;

          if (!wsManager) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                status: 'unavailable',
                message: 'WebSocket server not initialized',
                timestamp: new Date().toISOString()
              })
            );
            return;
          }

          // Get health status from WebSocket Manager
          const healthStatus = wsManager.getHealthStatus();
          const roomStats = wsManager.getRoomStats();
          const messageStats = wsManager.getMessageDeliveryStats();
          const performanceMetrics = wsManager.getPerformanceMetrics();
          const connectionsPerRoom = wsManager.getAllConnectionsPerRoom();
          const anomalyStats = wsManager.getAnomalyStats();
          const rejectedStats = wsManager.getRejectedConnectionStats();
          
          // Get config for max connections
          const wsConfig = await import('./config/websocket');
          const config = wsConfig.getWebSocketConfig();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: healthStatus.isHealthy ? 'healthy' : 'unhealthy',
              timestamp: new Date().toISOString(),
              connections: {
                active: healthStatus.connectionCount,
                max: config.maxConnections,
                accepted: performanceMetrics.totalConnectionsAccepted,
                rejected: performanceMetrics.totalConnectionsRejected,
                perRoom: Object.fromEntries(connectionsPerRoom)
              },
              rooms: {
                count: healthStatus.roomCount,
                details: roomStats.map((room: any) => ({
                  name: room.room,
                  clients: room.clientCount,
                  messages: room.messageCount,
                  lastActivity: room.lastActivity.toISOString()
                }))
              },
              messages: {
                totalDelivered: messageStats.totalDelivered,
                successRate: Math.round(messageStats.successRate * 100) / 100,
                averageRecipients: Math.round(messageStats.averageRecipients * 100) / 100,
                recentDeliveries: messageStats.recentDeliveries.slice(-10).map((log: any) => ({
                  timestamp: log.timestamp.toISOString(),
                  event: log.event,
                  room: log.roomName || 'all',
                  recipients: log.recipientCount,
                  success: log.success
                }))
              },
              performance: {
                averageLatencyMs: Math.round(performanceMetrics.averageMessageLatency * 100) / 100,
                messagesPerSecond: Math.round(performanceMetrics.messagesPerSecond * 100) / 100,
                peakConnectionCount: performanceMetrics.peakConnectionCount,
                peakMessageRate: Math.round(performanceMetrics.peakMessageRate * 100) / 100
              },
              anomalies: {
                total: anomalyStats.total,
                byType: anomalyStats.byType,
                bySeverity: anomalyStats.bySeverity,
                recent: anomalyStats.recentAnomalies.map((anomaly: any) => ({
                  type: anomaly.type,
                  severity: anomaly.severity,
                  message: anomaly.message,
                  timestamp: anomaly.timestamp.toISOString(),
                  suggestedActions: anomaly.suggestedActions
                }))
              },
              security: {
                rejectedConnections: rejectedStats.total,
                recentRejections: rejectedStats.recentRejections.slice(-10).map((rejection: any) => ({
                  socketId: rejection.socketId,
                  origin: rejection.origin || 'unknown',
                  reason: rejection.reason,
                  timestamp: rejection.timestamp.toISOString()
                }))
              },
              uptime: {
                milliseconds: healthStatus.uptime,
                seconds: Math.floor(healthStatus.uptime / 1000),
                minutes: Math.floor(healthStatus.uptime / 60000)
              },
              memory: {
                heapUsed: healthStatus.memoryUsage,
                heapUsedMB: Math.round(healthStatus.memoryUsage / 1024 / 1024),
                heapTotal: process.memoryUsage().heapTotal,
                heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
              }
            })
          );
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'error',
              message: String(error),
              timestamp: new Date().toISOString()
            })
          );
        }
      } else if (pathname === '/sync-missing') {
        /**
         * @openapi
         * /sync-missing:
         *   get:
         *     tags:
         *       - Admin
         *     summary: Trigger missing NFT sync
         *     description: Synchronize missing NFTs for specific launchpad, chain, or all chains
         *     parameters:
         *       - in: query
         *         name: chainId
         *         schema:
         *           type: integer
         *         description: Chain ID to sync (optional)
         *       - in: query
         *         name: launchpad
         *         schema:
         *           type: string
         *         description: Launchpad address to sync (optional, requires chainId)
         *     responses:
         *       200:
         *         description: Sync completed successfully
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/SyncMissingResponse'
         *       500:
         *         description: Sync error
         *         content:
         *           application/json:
         *             schema:
         *               $ref: '#/components/schemas/Error'
         *     security:
         *       - bearerAuth: []
         */
        // Endpoint to trigger missing NFT sync (expensive: admin only)
        const { validateAdminAuth } = await import('./api/admin');
        const auth = validateAdminAuth(req);
        if (!auth.valid) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: auth.error || 'Unauthorized' }));
          return;
        }
        try {
          const manager = getMultiChainListenerManager();
          const chainId = url.searchParams.get('chainId');
          const launchpad = url.searchParams.get('launchpad');

          res.writeHead(200, { 'Content-Type': 'application/json' });

          if (chainId && launchpad) {
            // Sync specific launchpad
            const listener = manager.getListener(parseInt(chainId, 10));
            if (listener) {
              const result = await listener.syncMissingNFTs(launchpad);
              res.end(JSON.stringify({ status: 'ok', ...result }));
            } else {
              res.end(JSON.stringify({ status: 'error', message: 'Chain not found' }));
            }
          } else if (chainId) {
            // Sync all launchpads on chain
            const listener = manager.getListener(parseInt(chainId, 10));
            if (listener) {
              const result = await listener.autoSyncAllMissingNFTs();
              res.end(JSON.stringify({ status: 'ok', ...result }));
            } else {
              res.end(JSON.stringify({ status: 'error', message: 'Chain not found' }));
            }
          } else {
            // Sync all chains
            const results = await manager.syncAllMissingNFTs();
            res.end(JSON.stringify({ status: 'ok', results }));
          }
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: String(error) }));
        }
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    httpServer.listen(port, () => {
      console.log(`🏥 Health check server running on port ${port}`);
      resolve();
    });
    
    // Increase timeout to 20 minutes for large uploads
    httpServer.setTimeout(1200000);
  });
}

async function startListeners() {
  try {
    console.log('🚀 Starting NFT Activity Listener Service...');
    console.log('📅 Timestamp:', new Date().toISOString());
    console.log('🌍 Environment:', process.env.NODE_ENV || 'development');
    console.log('🔧 Node Version:', process.version);
    console.log('💾 Memory:', `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`);

    // Make sure the shared database has what the listener needs
    // (additive schema changes + chains/factories from LISTENER_CHAIN_IDS / RPC_URLS_<id>)
    console.log('🗄️ Bootstrapping database...');
    const { bootstrapDatabase } = await import('./lib/database/bootstrap');
    await bootstrapDatabase();
    console.log('✅ Database bootstrap complete');

    // Initialize chain config cache from database
    console.log('🔄 Initializing chain configuration cache...');
    const { initializeChainConfigCache } = await import('./config/chains');
    await initializeChainConfigCache();
    console.log('✅ Chain configuration cache initialized');

    // Validate blockchain configuration on startup
    console.log('🔍 Validating blockchain configuration...');
    const { getBlockchainConfig, logBlockchainConfigStatus } = await import('./config/blockchain');
    const blockchainConfig = getBlockchainConfig(); // This will throw ConfigurationError if validation fails
    logBlockchainConfigStatus(blockchainConfig);
    console.log('✅ Blockchain configuration validated');

    // Initialize IPFS gateway cache
    console.log('🌐 Initializing IPFS gateway cache...');
    const { initializeGatewayCache } = await import('./utils/ipfs-helpers');
    initializeGatewayCache();
    console.log('✅ IPFS gateway cache initialized');

    // Start health check server first (Railway needs this)
    console.log('🏥 Starting health check server...');
    await startHealthServer();
    console.log('✅ Health check server started');

    // Start database health check for auto-reconnect
    console.log('🔄 Starting database auto-reconnect health check...');
    startDatabaseHealthCheck();
    console.log('✅ Database health check started');

    // Initialize WebSocket Manager
    console.log('🔌 Initializing WebSocket server...');
    try {
      const wsConfig = getWebSocketConfig();
      websocketManager = new WebSocketManager(wsConfig);
      // Serve Socket.IO on the API port (one domain for HTTP + realtime) unless
      // WEBSOCKET_SEPARATE_PORT=true keeps the legacy separate port.
      if (process.env.WEBSOCKET_SEPARATE_PORT === 'true' || !httpServer) {
        await websocketManager.initialize();
      } else {
        await websocketManager.initialize(undefined, httpServer);
      }
      (global as any).websocketManager = websocketManager;
      console.log('✅ WebSocket server initialized');
    } catch (error) {
      console.warn('⚠️ WebSocket server initialization failed:', error);
      console.warn('⚠️ Service will continue without WebSocket support');
    }

    // Initialize Database Change Listener (if WebSocket is available)
    if (websocketManager) {
      console.log('🔔 Initializing Database Change Listener...');
      try {
        // Create EventEmitter wrapper around WebSocketManager
        const eventEmitter = new EventEmitter(websocketManager);
        
        // Get database connection string from environment
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
          throw new Error('DATABASE_URL environment variable not set');
        }

        // Initialize DatabaseChangeListener
        databaseChangeListener = new DatabaseChangeListener(eventEmitter, {
          connectionString: databaseUrl,
          reconnectDelay: 5000,
          maxReconnectAttempts: 10,
          pollInterval: 30000,
        });

        // Start listening to database notifications
        await databaseChangeListener.start();
        console.log('✅ Database Change Listener started');
      } catch (error) {
        console.warn('⚠️ Database Change Listener initialization failed:', error);
        console.warn('⚠️ Service will continue without real-time database notifications');
        databaseChangeListener = null;
      }
    } else {
      console.log('ℹ️ Skipping Database Change Listener (WebSocket not available)');
    }

    // Get the singleton instance
    console.log('🔧 Initializing multi-chain listener manager...');
    const manager = getMultiChainListenerManager();

    // Connect WebSocket EventEmitter to listener manager for real-time updates
    if (websocketManager) {
      manager.setEventEmitter(websocketManager);
      console.log('✅ WebSocket EventEmitter connected to listener manager');
    }

    // Initialize all chain listeners
    console.log('🎧 Starting chain listeners...');
    await manager.initializeAll();
    console.log('✅ Chain listeners initialized');

    // Self-heal phase rows from the contracts (missing constructor phases,
    // removed phases, per-phase minted counts). Runs in the background.
    if (process.env.PHASE_SYNC_ON_START !== 'false') {
      const { syncAllPhases } = await import('./lib/blockchain/phase-sync');
      for (const s of await manager.getStatus()) {
        syncAllPhases(s.chainId).catch((e) => console.warn(`⚠️ Phase reconcile failed for chain ${s.chainId}:`, e?.message || e));
      }
    }

    // Note: Blockchain WebSocketManager is initialized per chain by MultiChainListenerManager
    // See MultiChainListenerManager.initializeWebSocketManager() for implementation
    console.log('ℹ️ Blockchain WebSocket monitoring is handled per chain by MultiChainListenerManager');
    if (blockchainConfig.websocket.enabled) {
      console.log('✅ WebSocket feature enabled globally (WEBSOCKET_ENABLED=true)');
      console.log('   Each chain will initialize its own WebSocketManager for featured launchpads');
    } else {
      console.log('ℹ️ WebSocket feature disabled globally (WEBSOCKET_ENABLED=false)');
      console.log('   All launchpads will use polling mechanism for mint events');
    }

    // Get and display status
    const statuses = await manager.getStatus();
    
    const activeCount = statuses.filter(s => s.isRunning).length;
    const totalLaunchpads = statuses.reduce((sum, s) => sum + s.launchpadCount, 0);
    
    console.log('\n📊 Listener Status Summary:');
    console.log(`✅ ${activeCount}/${statuses.length} chains active`);
    console.log(`🎧 Monitoring ${totalLaunchpads} launchpads`);
    console.log('💾 Memory after init:', `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

    // Initialize Queue System (only if Redis is available)
    console.log('\n📦 Checking Queue System availability...');
    try {
      const redisConfigured = isRedisConfigured();
      if (!redisConfigured) {
        console.log('ℹ️ Redis not configured (using default localhost)');
        console.log('ℹ️ Skipping queue system initialization');
        console.log('ℹ️ Service will use direct processing mode');
      } else {
        console.log('🔍 Testing Redis connection...');
        const redisAvailable = await isRedisAvailable();
        
        if (!redisAvailable) {
          console.warn('⚠️ Redis configured but not available');
          console.warn('⚠️ Skipping queue system initialization');
          console.warn('⚠️ Service will use direct processing mode');
        } else {
          console.log('✅ Redis is available, initializing queue system...');
          await initializeQueueManager();
          console.log('✅ Queue Manager initialized');
          
          await initializeQueueWorker(websocketManager ? (websocketManager as any) : undefined);
          queueWorkerActive = true;
          console.log('✅ Queue Workers started');
        }
      }
    } catch (error) {
      console.warn('⚠️ Queue system initialization failed:', error);
      console.warn('⚠️ Service will continue without queue support (direct processing)');
    }

    console.log('💡 Service is running. Press Ctrl+C to stop\n');

    // Keep the process running
    process.stdin.resume();
    
    // Log periodic status to show service is alive
    setInterval(() => {
      const mem = process.memoryUsage();
      const lag = getPollerReport()
        .map((p) => `chain ${p.chainId}: block ${p.cursorBlock ?? '-'} (lag ${p.lagBlocks ?? '-'})`)
        .join(', ');
      console.log(`💓 Heartbeat - Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB, Uptime: ${Math.round(process.uptime())}s${lag ? `, ${lag}` : ''}`);
    }, 60000); // Every minute

    // Watchdog: if a poller has not completed a cycle for WATCHDOG_STALE_MS
    // (hung socket, wedged promise, ...), exit so the container restarts. The
    // persisted cursor makes the restart resume without losing events.
    setInterval(() => {
      const stuck = getPollerReport().filter((p) => p.stale);
      if (stuck.length > 0 && !isShuttingDown) {
        console.error(`🚨 Watchdog: poller stuck on chain(s) ${stuck.map((p) => p.chainId).join(', ')} for > ${Math.round(POLLER_STALE_MS / 60000)} min, restarting process`);
        gracefulShutdown('watchdog', 1);
      }
    }, 60000).unref();

  } catch (error) {
    console.error('❌ Failed to start listeners:', error);
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack trace');
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string, exitCode: number = 0) {
  if (isShuttingDown) {
    console.log('⚠️ Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  console.log(`\n🛑 Received ${signal}, initiating graceful shutdown...`);

  // Never hang on shutdown: a stuck close() must not keep a dead process alive
  setTimeout(() => {
    console.error('⏱️ Shutdown timed out, forcing exit');
    process.exit(exitCode || 1);
  }, 25_000).unref();

  try {
    // Close HTTP server first
    if (httpServer) {
      console.log('🛑 Closing health check server...');
      httpServer.close();
    }

    // Shutdown Database Change Listener
    if (databaseChangeListener) {
      console.log('🛑 Stopping Database Change Listener...');
      await databaseChangeListener.stop();
      databaseChangeListener = null;
      console.log('✅ Database Change Listener stopped');
    }

    // Note: Blockchain WebSocketManagers are stopped by MultiChainListenerManager.stopAll()
    
    // Shutdown WebSocket Manager
    if (websocketManager) {
      console.log('🛑 Shutting down WebSocket server...');
      await websocketManager.shutdown();
      websocketManager = null;
      (global as any).websocketManager = null;
      console.log('✅ WebSocket server stopped');
    }

    // Shutdown Queue System
    if (queueWorkerActive) {
      console.log('🛑 Stopping queue workers...');
      try {
        const { getQueueWorker } = await import('./lib/queue');
        const queueWorker = getQueueWorker();
        await queueWorker.stop();
        queueWorkerActive = false;
        console.log('✅ Queue workers stopped');
      } catch (error) {
        console.error('⚠️ Error stopping queue workers:', error);
      }
    }

    const manager = getMultiChainListenerManager();
    
    console.log('🛑 Stopping all activity listeners...');
    await manager.stopAll();
    
    // Disconnect database gracefully
    console.log('🛑 Disconnecting database...');
    await disconnectDatabase();
    
    console.log('✅ All listeners stopped successfully');
    console.log('👋 Goodbye!');
    
    process.exit(exitCode);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Register signal handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  console.error('⚠️ Service will continue running. Please check the error above.');
  // Don't shutdown - just log the error and continue
});

// Start the service
startListeners();
