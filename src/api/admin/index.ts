import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { createHash, timingSafeEqual } from 'crypto';
import { handleLaunchpadRegistration, handleLaunchpadRemoval, handleGetLaunchpads } from './launchpad-management';
import { handleActivityLogs } from './activity-logs';
import { handleDataExport } from './data-export';
import { handleHistoricalRescan } from './historical-rescan';
import { handleCollectionSync } from './collection-sync';
import { handleRestartAll } from './restart-all';
import { handleSystemStats } from './system-stats';

/**
 * Send JSON response
 */
export function sendJSON(res: ServerResponse, data: any, status: number = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 */
export function sendError(res: ServerResponse, message: string, status: number = 400) {
  sendJSON(res, { error: message }, status);
}

/**
 * Parse query parameters
 */
export function getQueryParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/**
 * Parse JSON body from request
 */
export async function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        if (!body) {
          resolve({});
          return;
        }
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Simple admin authentication middleware
 * In production, this should validate JWT tokens or API keys
 */
export function validateAdminAuth(req: IncomingMessage): { valid: boolean; error?: string } {
  // Check for admin API key in header
  const apiKey = req.headers['x-admin-api-key'] || req.headers['authorization'];

  // Get expected API key from environment
  const expectedApiKey = process.env.ADMIN_API_KEY;

  // Fail closed: without a configured key nobody is an admin.
  // (Set ALLOW_UNAUTHENTICATED_ADMIN=true only for local development.)
  if (!expectedApiKey) {
    if (process.env.ALLOW_UNAUTHENTICATED_ADMIN === 'true' && process.env.NODE_ENV !== 'production') {
      return { valid: true };
    }
    return { valid: false, error: 'Admin API is not configured' };
  }

  // Validate API key
  if (!apiKey) {
    return { valid: false, error: 'Missing authentication header' };
  }

  // Support both "Bearer <token>" and direct token formats
  const token = apiKey.toString().replace(/^Bearer\s+/i, '');

  const a = createHash('sha256').update(token).digest();
  const b = createHash('sha256').update(expectedApiKey).digest();
  if (!timingSafeEqual(a, b)) {
    return { valid: false, error: 'Invalid API key' };
  }

  return { valid: true };
}

/**
 * Handle admin API requests
 * Routes: /api/admin/*
 */
export async function handleAdminApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  url: URL
): Promise<boolean> {
  // Validate admin authentication
  const authResult = validateAdminAuth(req);
  if (!authResult.valid) {
    sendError(res, authResult.error || 'Unauthorized', 401);
    return true;
  }

  try {
    // ============ LAUNCHPAD MANAGEMENT ENDPOINTS ============

    /**
     * @openapi
     * /api/admin/launchpads/register:
     *   post:
     *     tags:
     *       - Admin
     *     summary: Register a new launchpad for monitoring
     *     description: Manually register a launchpad contract that wasn't auto-discovered
     *     security:
     *       - adminApiKey: []
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - chainId
     *               - contractAddress
     *             properties:
     *               chainId:
     *                 type: integer
     *                 description: Chain ID where the launchpad is deployed
     *               contractAddress:
     *                 type: string
     *                 description: Launchpad contract address
     *     responses:
     *       200:
     *         description: Launchpad registered successfully
     *       400:
     *         description: Invalid request or contract
     *       401:
     *         description: Unauthorized
     */
    if (pathname === '/api/admin/launchpads/register' && req.method === 'POST') {
      return await handleLaunchpadRegistration(req, res);
    }

    /**
     * @openapi
     * /api/admin/launchpads/{chainId}/{address}:
     *   delete:
     *     tags:
     *       - Admin
     *     summary: Remove a launchpad from monitoring
     *     description: Stop monitoring a launchpad (soft delete - data is preserved)
     *     security:
     *       - adminApiKey: []
     *     parameters:
     *       - in: path
     *         name: chainId
     *         required: true
     *         schema:
     *           type: integer
     *         description: Chain ID
     *       - in: path
     *         name: address
     *         required: true
     *         schema:
     *           type: string
     *         description: Contract address
     *     responses:
     *       200:
     *         description: Launchpad removed from monitoring
     *       404:
     *         description: Launchpad not found
     *       401:
     *         description: Unauthorized
     */
    if (pathname.match(/^\/api\/admin\/launchpads\/\d+\/0x[a-fA-F0-9]+$/) && req.method === 'DELETE') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const address = parts[5];
      return await handleLaunchpadRemoval(req, res, chainId, address);
    }

    /**
     * @openapi
     * /api/admin/launchpads/{chainId}:
     *   get:
     *     tags:
     *       - Admin
     *     summary: Get all launchpads for a chain
     *     description: Get all launchpads registered on a specific chain with their monitoring status
     *     security:
     *       - adminApiKey: []
     *     parameters:
     *       - in: path
     *         name: chainId
     *         required: true
     *         schema:
     *           type: integer
     *         description: Chain ID
     *     responses:
     *       200:
     *         description: List of launchpads
     *       401:
     *         description: Unauthorized
     */
    if (pathname.match(/^\/api\/admin\/launchpads\/\d+$/) && req.method === 'GET') {
      const chainId = parseInt(pathname.split('/').pop() || '0');
      return await handleGetLaunchpads(req, res, chainId);
    }

    // ============ ACTIVITY LOGS ENDPOINT ============

    /**
     * @openapi
     * /api/admin/activity-logs:
     *   get:
     *     tags:
     *       - Admin
     *     summary: Get activity logs
     *     description: Get activity logs with filtering and pagination
     *     security:
     *       - adminApiKey: []
     *     parameters:
     *       - in: query
     *         name: page
     *         schema:
     *           type: integer
     *           default: 1
     *         description: Page number
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Items per page (max 100)
     *       - in: query
     *         name: contractAddress
     *         schema:
     *           type: string
     *         description: Filter by contract address
     *       - in: query
     *         name: operationType
     *         schema:
     *           type: string
     *           enum: [sync_nfts, sync_metadata, sync_minted_count, rescan, restart, register, remove]
     *         description: Filter by operation type
     *       - in: query
     *         name: status
     *         schema:
     *           type: string
     *           enum: [pending, in_progress, success, failed]
     *         description: Filter by status
     *       - in: query
     *         name: fromDate
     *         schema:
     *           type: string
     *           format: date-time
     *         description: Filter from date
     *       - in: query
     *         name: toDate
     *         schema:
     *           type: string
     *           format: date-time
     *         description: Filter to date
     *     responses:
     *       200:
     *         description: Paginated activity logs
     *       401:
     *         description: Unauthorized
     */
    if (pathname === '/api/admin/activity-logs' && req.method === 'GET') {
      return await handleActivityLogs(req, res, url);
    }

    // ============ DATA EXPORT ENDPOINT ============

    /**
     * @openapi
     * /api/admin/export/{chainId}/{address}:
     *   get:
     *     tags:
     *       - Admin
     *     summary: Export collection data
     *     description: Export collection data including metadata, mint history, and holder data
     *     security:
     *       - adminApiKey: []
     *     parameters:
     *       - in: path
     *         name: chainId
     *         required: true
     *         schema:
     *           type: integer
     *         description: Chain ID
     *       - in: path
     *         name: address
     *         required: true
     *         schema:
     *           type: string
     *         description: Contract address
     *       - in: query
     *         name: format
     *         schema:
     *           type: string
     *           enum: [csv, json]
     *           default: json
     *         description: Export format
     *     responses:
     *       200:
     *         description: Exported data file
     *       404:
     *         description: Collection not found
     *       401:
     *         description: Unauthorized
     */
    if (pathname.match(/^\/api\/admin\/export\/\d+\/0x[a-fA-F0-9]+$/) && req.method === 'GET') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const address = parts[5];
      return await handleDataExport(req, res, url, chainId, address);
    }

    // ============ HISTORICAL RESCAN ENDPOINT ============

    /**
     * @openapi
     * /api/admin/rescan/{chainId}/{address}:
     *   post:
     *     tags:
     *       - Admin
     *     summary: Rescan historical blockchain events
     *     description: Force rescan historical events for a specific block range
     *     security:
     *       - adminApiKey: []
     *     parameters:
     *       - in: path
     *         name: chainId
     *         required: true
     *         schema:
     *           type: integer
     *         description: Chain ID
     *       - in: path
     *         name: address
     *         required: true
     *         schema:
     *           type: string
     *         description: Contract address
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - fromBlock
     *             properties:
     *               fromBlock:
     *                 type: integer
     *                 description: Starting block number
     *               toBlock:
     *                 type: integer
     *                 description: Ending block number (defaults to latest)
     *     responses:
     *       200:
     *         description: Rescan started/completed
     *       404:
     *         description: Chain or launchpad not found
     *       401:
     *         description: Unauthorized
     */
    if (pathname.match(/^\/api\/admin\/rescan\/\d+\/0x[a-fA-F0-9]+$/) && req.method === 'POST') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const address = parts[5];
      return await handleHistoricalRescan(req, res, chainId, address);
    }

    // ============ COLLECTION SYNC ENDPOINT ============

    /**
     * @openapi
     * /api/admin/sync-collection/{chainId}/{contractAddress}:
     *   post:
     *     tags:
     *       - Admin
     *     summary: Sync all transactions for a collection
     *     description: |
     *       Sync all Transfer events (mint, transfer, burn) for a specific collection
     *       from deployment block or specified fromBlock to latest or specified toBlock.
     *       This will process all historical transactions and update all related stats.
     *     security:
     *       - adminApiKey: []
     *     parameters:
     *       - in: path
     *         name: chainId
     *         required: true
     *         schema:
     *           type: integer
     *         description: Chain ID
     *       - in: path
     *         name: contractAddress
     *         required: true
     *         schema:
     *           type: string
     *         description: Contract address (0x...)
     *     requestBody:
     *       required: false
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             properties:
     *               fromBlock:
     *                 type: integer
     *                 description: Starting block number (defaults to deployment block)
     *               toBlock:
     *                 type: integer
     *                 description: Ending block number (defaults to latest)
     *               skipExisting:
     *                 type: boolean
     *                 description: Skip already processed transactions (default true)
     *               batchSize:
     *                 type: integer
     *                 description: Number of blocks per batch (default 1000, min 100, max 10000)
     *     responses:
     *       200:
     *         description: Collection sync started
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 message:
     *                   type: string
     *                 operationId:
     *                   type: string
     *                 chainId:
     *                   type: integer
     *                 contractAddress:
     *                   type: string
     *                 launchpad:
     *                   type: object
     *                   properties:
     *                     id:
     *                       type: string
     *                     name:
     *                       type: string
     *                 syncOptions:
     *                   type: object
     *                   properties:
     *                     fromBlock:
     *                       type: integer
     *                     toBlock:
     *                       type: string
     *                     skipExisting:
     *                       type: boolean
     *                     batchSize:
     *                       type: integer
     *                 trackingInfo:
     *                   type: object
     *                   properties:
     *                     websocketEvent:
     *                       type: string
     *                     activityLogId:
     *                       type: string
     *       400:
     *         description: Invalid parameters
     *       404:
     *         description: Chain or launchpad not found
     *       401:
     *         description: Unauthorized
     */
    if (pathname.match(/^\/api\/admin\/sync-collection\/\d+\/0x[a-fA-F0-9]+$/) && req.method === 'POST') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      return await handleCollectionSync(req, res, chainId, contractAddress);
    }

    // ============ RESTART ALL ENDPOINT ============

    /**
     * @openapi
     * /api/admin/restart-all:
     *   post:
     *     tags:
     *       - Admin
     *     summary: Restart all chain listeners
     *     description: Restart all blockchain listeners across all chains
     *     security:
     *       - adminApiKey: []
     *     responses:
     *       200:
     *         description: All listeners restarted
     *       401:
     *         description: Unauthorized
     */
    if (pathname === '/api/admin/restart-all' && req.method === 'POST') {
      return await handleRestartAll(req, res);
    }

    // ============ SYSTEM STATS ENDPOINT ============

    /**
     * @openapi
     * /api/admin/stats:
     *   get:
     *     tags:
     *       - Admin
     *     summary: Get system statistics
     *     description: Get overall system statistics including launchpads, NFTs, mints, and uptime
     *     security:
     *       - adminApiKey: []
     *     responses:
     *       200:
     *         description: System statistics
     *       401:
     *         description: Unauthorized
     */
    if (pathname === '/api/admin/stats' && req.method === 'GET') {
      return await handleSystemStats(req, res);
    }

    // Not an admin API route
    return false;
  } catch (error) {
    console.error('Admin API Error:', error);
    sendError(res, error instanceof Error ? error.message : 'Internal server error', 500);
    return true;
  }
}
