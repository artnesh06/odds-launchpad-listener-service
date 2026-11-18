import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import {
  queryNFTs,
  getNFTsForOwner,
  getNFTsInCollection,
  getRarestNFTs,
  searchNFTs,
  getAttributeDistribution,
  querySales,
  getRecentSales,
  getActiveListings,
  getActiveOffers,
  getSalesStatistics,
  getMarketplaceActivity,
} from '../lib/queries';
import { getMultiChainListenerManager } from '../lib/blockchain/multi-chain-listener-manager';
import { AlchemyNFTService } from '../lib/alchemy-nft-service';
import { getChainConfig } from '../config/chains';
import { prisma } from '../config/database';
import { EventEmitter } from '../lib/websocket/event-emitter';
import { WebSocketManager } from '../lib/websocket/websocket-manager';
import { handleIpfsUploadFolder } from './ipfs-upload';
import { handleAdminApiRequest, validateAdminAuth } from './admin';
import { authorizeUploader } from './upload-auth';
import { withActivityLogging } from './admin/activity-logger';

/**
 * Send JSON response
 */
function sendJSON(res: ServerResponse, data: any, status: number = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send error response
 */
function sendError(res: ServerResponse, message: string, status: number = 400) {
  sendJSON(res, { error: message }, status);
}

/**
 * Parse query parameters
 */
function getQueryParams(url: URL) {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/**
 * Handle API requests
 */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  url: URL
): Promise<boolean> {
  const params = getQueryParams(url);

  try {
    // ============ ADMIN ENDPOINTS ============
    // Handle all /api/admin/* routes
    if (pathname.startsWith('/api/admin/')) {
      return await handleAdminApiRequest(req, res, pathname, url);
    }

    // ============ ACCESS CONTROL ============
    // Test endpoints inject fake mint events: disabled unless explicitly enabled.
    if (pathname.startsWith('/api/test/') && process.env.ENABLE_TEST_ENDPOINTS !== 'true') {
      sendError(res, 'Not Found', 404);
      return true;
    }
    // Endpoints that trigger heavy RPC work, restarts or test data need the admin key.
    if (
      pathname.startsWith('/api/indexer/') ||
      pathname.startsWith('/api/metadata/refresh') ||
      pathname.startsWith('/api/test/') ||
      /^\/api\/chains\/\d+\/restart$/.test(pathname)
    ) {
      const auth = validateAdminAuth(req);
      if (!auth.valid) {
        sendError(res, auth.error || 'Unauthorized', 401);
        return true;
      }
    }
    // IPFS uploads spend the server's Pinata quota: admin key, or a fresh
    // wallet signature from the launchpad UI (same scheme as the launchpad app).
    if (pathname === '/api/ipfs/upload-folder') {
      const denied = authorizeUploader(req);
      if (denied) {
        sendError(res, denied.error, denied.status);
        return true;
      }
    }

    // ============ NFT ENDPOINTS ============

    /**
     * @openapi
     * /api/nfts:
     *   get:
     *     tags:
     *       - NFT
     *     summary: Query NFTs with filters
     *     description: Get NFTs with advanced filtering options including chain, contract, owner, and attributes
     *     parameters:
     *       - in: query
     *         name: chainId
     *         schema:
     *           type: integer
     *         description: Filter by chain ID
     *       - in: query
     *         name: contractAddress
     *         schema:
     *           type: string
     *         description: Filter by contract address
     *       - in: query
     *         name: ownerAddress
     *         schema:
     *           type: string
     *         description: Filter by owner address
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Number of results to return (max 100)
     *       - in: query
     *         name: cursor
     *         schema:
     *           type: string
     *         description: Pagination cursor for next page
     *       - in: query
     *         name: orderBy
     *         schema:
     *           type: string
     *           enum: [tokenId, timeLastUpdated, rarity]
     *         description: Field to order by
     *       - in: query
     *         name: orderDirection
     *         schema:
     *           type: string
     *           enum: [asc, desc]
     *         description: Order direction
     *     responses:
     *       200:
     *         description: List of NFTs
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PaginatedNFTResult'
     */
    if (pathname === '/api/nfts' && req.method === 'GET') {
      const result = await queryNFTs({
        chainId: params.chainId ? parseInt(params.chainId) : undefined,
        contractAddress: params.contractAddress,
        ownerAddress: params.ownerAddress,
        limit: Math.min(parseInt(params.limit || '50'), 100),
        cursor: params.cursor,
        orderBy: params.orderBy as any,
        orderDirection: params.orderDirection as any,
      });
      sendJSON(res, result);
      return true;
    }

    /**
     * @openapi
     * /api/nfts/owner/{ownerAddress}:
     *   get:
     *     tags:
     *       - NFT
     *     summary: Get NFTs by owner
     *     description: Get all NFTs owned by a specific address across all chains
     *     parameters:
     *       - in: path
     *         name: ownerAddress
     *         required: true
     *         schema:
     *           type: string
     *         description: Owner wallet address
     *       - in: query
     *         name: chainId
     *         schema:
     *           type: integer
     *         description: Filter by chain ID
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Number of results
     *       - in: query
     *         name: cursor
     *         schema:
     *           type: string
     *         description: Pagination cursor
     *     responses:
     *       200:
     *         description: List of NFTs owned by address
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PaginatedNFTResult'
     */
    if (pathname.startsWith('/api/nfts/owner/') && req.method === 'GET') {
      const ownerAddress = pathname.split('/api/nfts/owner/')[1];
      if (!ownerAddress) {
        sendError(res, 'Owner address is required', 400);
        return true;
      }
      const result = await getNFTsForOwner(ownerAddress, {
        chainId: params.chainId ? parseInt(params.chainId) : undefined,
        limit: Math.min(parseInt(params.limit || '50'), 100),
        cursor: params.cursor,
      });
      sendJSON(res, result);
      return true;
    }

    /**
     * @openapi
     * /api/nfts/collection/{chainId}/{contractAddress}:
     *   get:
     *     tags:
     *       - NFT
     *     summary: Get NFTs in collection
     *     description: Get all NFTs in a specific collection
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
     *         description: Contract address
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Number of results
     *       - in: query
     *         name: cursor
     *         schema:
     *           type: string
     *         description: Pagination cursor
     *     responses:
     *       200:
     *         description: List of NFTs in collection
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PaginatedNFTResult'
     */
    if (pathname.match(/^\/api\/nfts\/collection\/\d+\/0x[a-fA-F0-9]+$/) && req.method === 'GET') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      const result = await getNFTsInCollection(contractAddress, chainId, {
        limit: Math.min(parseInt(params.limit || '50'), 100),
        cursor: params.cursor,
      });
      sendJSON(res, result);
      return true;
    }

    /**
     * @openapi
     * /api/nfts/collection/{chainId}/{contractAddress}/rarest:
     *   get:
     *     tags:
     *       - NFT
     *     summary: Get rarest NFTs in collection
     *     description: Get the rarest NFTs in a collection sorted by rarity rank
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
     *         description: Contract address
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 10
     *         description: Number of results (max 50)
     *     responses:
     *       200:
     *         description: List of rarest NFTs
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 nfts:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/NFT'
     */
    if (pathname.match(/^\/api\/nfts\/collection\/\d+\/0x[a-fA-F0-9]+\/rarest$/) && req.method === 'GET') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      const result = await getRarestNFTs(
        contractAddress,
        chainId,
        Math.min(parseInt(params.limit || '10'), 50)
      );
      sendJSON(res, { nfts: result });
      return true;
    }

    /**
     * @openapi
     * /api/nfts/collection/{chainId}/{contractAddress}/attributes:
     *   get:
     *     tags:
     *       - NFT
     *     summary: Get attribute distribution
     *     description: Get the distribution of attributes/traits in a collection
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
     *         description: Contract address
     *     responses:
     *       200:
     *         description: Attribute distribution
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/AttributeDistribution'
     */
    if (pathname.match(/^\/api\/nfts\/collection\/\d+\/0x[a-fA-F0-9]+\/attributes$/) && req.method === 'GET') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      const result = await getAttributeDistribution(contractAddress, chainId);
      sendJSON(res, { attributes: result });
      return true;
    }

    /**
     * @openapi
     * /api/nfts/search:
     *   get:
     *     tags:
     *       - NFT
     *     summary: Search NFTs
     *     description: Search NFTs by name or description
     *     parameters:
     *       - in: query
     *         name: q
     *         required: true
     *         schema:
     *           type: string
     *         description: Search query
     *       - in: query
     *         name: chainId
     *         schema:
     *           type: integer
     *         description: Filter by chain ID
     *       - in: query
     *         name: contractAddress
     *         schema:
     *           type: string
     *         description: Filter by contract address
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Number of results
     *     responses:
     *       200:
     *         description: Search results
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PaginatedNFTResult'
     */
    if (pathname === '/api/nfts/search' && req.method === 'GET') {
      const searchTerm = params.q;
      if (!searchTerm) {
        sendError(res, 'Search query (q) is required', 400);
        return true;
      }
      const result = await searchNFTs(searchTerm, {
        chainId: params.chainId ? parseInt(params.chainId) : undefined,
        contractAddress: params.contractAddress,
        limit: Math.min(parseInt(params.limit || '50'), 100),
      });
      sendJSON(res, result);
      return true;
    }

    // ============ MARKETPLACE ENDPOINTS ============

    /**
     * @openapi
     * /api/marketplace/sales:
     *   get:
     *     tags:
     *       - Marketplace
     *     summary: Query marketplace sales
     *     description: Get marketplace sales with advanced filtering
     *     parameters:
     *       - in: query
     *         name: chainId
     *         schema:
     *           type: integer
     *         description: Filter by chain ID
     *       - in: query
     *         name: contractAddress
     *         schema:
     *           type: string
     *         description: Filter by contract address
     *       - in: query
     *         name: buyer
     *         schema:
     *           type: string
     *         description: Filter by buyer address
     *       - in: query
     *         name: seller
     *         schema:
     *           type: string
     *         description: Filter by seller address
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Number of results
     *       - in: query
     *         name: cursor
     *         schema:
     *           type: string
     *         description: Pagination cursor
     *     responses:
     *       200:
     *         description: List of sales
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PaginatedSalesResult'
     */
    if (pathname === '/api/marketplace/sales' && req.method === 'GET') {
      const result = await querySales({
        chainId: params.chainId ? parseInt(params.chainId) : undefined,
        contractAddress: params.contractAddress,
        buyer: params.buyer,
        seller: params.seller,
        limit: Math.min(parseInt(params.limit || '50'), 100),
        cursor: params.cursor,
      });
      sendJSON(res, result);
      return true;
    }

    /**
     * @openapi
     * /api/marketplace/collection/{chainId}/{contractAddress}/sales:
     *   get:
     *     tags:
     *       - Marketplace
     *     summary: Get recent sales for collection
     *     description: Get recent sales for a specific collection
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
     *         description: Contract address
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 10
     *         description: Number of results
     *     responses:
     *       200:
     *         description: Recent sales
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 sales:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/Sale'
     */
    if (pathname.match(/^\/api\/marketplace\/collection\/\d+\/0x[a-fA-F0-9]+\/sales$/) && req.method === 'GET') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      const result = await getRecentSales(
        contractAddress,
        chainId,
        Math.min(parseInt(params.limit || '10'), 50)
      );
      sendJSON(res, { sales: result });
      return true;
    }

    /**
     * @openapi
     * /api/marketplace/collection/{chainId}/{contractAddress}/listings:
     *   get:
     *     tags:
     *       - Marketplace
     *     summary: Get active listings
     *     description: Get active listings for a collection
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
     *         description: Contract address
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Number of results
     *       - in: query
     *         name: cursor
     *         schema:
     *           type: string
     *         description: Pagination cursor
     *     responses:
     *       200:
     *         description: Active listings
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PaginatedListingsResult'
     */
    if (pathname.match(/^\/api\/marketplace\/collection\/\d+\/0x[a-fA-F0-9]+\/listings$/) && req.method === 'GET') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      const result = await getActiveListings(contractAddress, chainId, {
        limit: Math.min(parseInt(params.limit || '50'), 100),
        cursor: params.cursor,
      });
      sendJSON(res, result);
      return true;
    }

    /**
     * @openapi
     * /api/marketplace/collection/{chainId}/{contractAddress}/offers:
     *   get:
     *     tags:
     *       - Marketplace
     *     summary: Get active offers
     *     description: Get active offers for a collection
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
     *         description: Contract address
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Number of results
     *       - in: query
     *         name: cursor
     *         schema:
     *           type: string
     *         description: Pagination cursor
     *     responses:
     *       200:
     *         description: Active offers
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/PaginatedOffersResult'
     */
    if (pathname.match(/^\/api\/marketplace\/collection\/\d+\/0x[a-fA-F0-9]+\/offers$/) && req.method === 'GET') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      const result = await getActiveOffers(contractAddress, chainId, {
        limit: Math.min(parseInt(params.limit || '50'), 100),
        cursor: params.cursor,
      });
      sendJSON(res, result);
      return true;
    }

    /**
     * @openapi
     * /api/marketplace/collection/{chainId}/{contractAddress}/activity:
     *   get:
     *     tags:
     *       - Marketplace
     *     summary: Get marketplace activity
     *     description: Get combined marketplace activity (sales, listings, offers) for a collection
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
     *         description: Contract address
     *       - in: query
     *         name: limit
     *         schema:
     *           type: integer
     *           default: 50
     *         description: Number of results
     *     responses:
     *       200:
     *         description: Marketplace activity
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 activity:
     *                   type: array
     *                   items:
     *                     $ref: '#/components/schemas/MarketplaceActivity'
     */
    if (pathname.match(/^\/api\/marketplace\/collection\/\d+\/0x[a-fA-F0-9]+\/activity$/) && req.method === 'GET') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      const result = await getMarketplaceActivity(contractAddress, chainId, {
        limit: Math.min(parseInt(params.limit || '50'), 100),
      });
      sendJSON(res, { activity: result });
      return true;
    }

    /**
     * @openapi
     * /api/marketplace/collection/{chainId}/{contractAddress}/stats:
     *   get:
     *     tags:
     *       - Marketplace
     *     summary: Get sales statistics
     *     description: Get sales statistics for a collection
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
     *         description: Contract address
     *     responses:
     *       200:
     *         description: Sales statistics
     *         content:
     *           application/json:
     *             schema:
     *               $ref: '#/components/schemas/SalesStatistics'
     */
    if (pathname.match(/^\/api\/marketplace\/collection\/\d+\/0x[a-fA-F0-9]+\/stats$/) && req.method === 'GET') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      const result = await getSalesStatistics(contractAddress, chainId);
      sendJSON(res, result);
      return true;
    }

    // ============ INDEXER ENDPOINTS ============

    /**
     * @openapi
     * /api/indexer/sync/{chainId}:
     *   post:
     *     tags:
     *       - Indexer
     *     summary: Sync all missing NFTs for a chain
     *     description: Synchronize all missing NFTs for all launchpads on a specific chain
     *     parameters:
     *       - in: path
     *         name: chainId
     *         required: true
     *         schema:
     *           type: integer
     *         description: Chain ID to sync
     *     responses:
     *       200:
     *         description: Sync completed
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success: { type: boolean }
     *                 chainId: { type: integer }
     *                 total: { type: integer }
     *                 errors: { type: integer }
     *       404:
     *         description: Chain not found
     */
    if (pathname.match(/^\/api\/indexer\/sync\/\d+$/) && req.method === 'POST') {
      const chainId = parseInt(pathname.split('/').pop() || '0');
      const manager = getMultiChainListenerManager();
      const listener = manager.getListener(chainId);
      
      if (!listener) {
        sendError(res, `Chain ${chainId} not found or not active`, 404);
        return true;
      }

      const { result, activityId } = await withActivityLogging(
        {
          operationType: 'sync_nfts',
          chainId,
          metadata: { scope: 'chain' },
        },
        async () => {
          return await listener.autoSyncAllMissingNFTs();
        }
      );

      sendJSON(res, {
        success: true,
        chainId,
        total: result.total,
        errors: result.errors,
        activityId,
      });
      return true;
    }

    /**
     * @openapi
     * /api/indexer/sync/{chainId}/{launchpadAddress}:
     *   post:
     *     tags:
     *       - Indexer
     *     summary: Sync missing NFTs for a specific launchpad
     *     description: Synchronize missing NFTs for a specific launchpad contract
     *     parameters:
     *       - in: path
     *         name: chainId
     *         required: true
     *         schema:
     *           type: integer
     *         description: Chain ID
     *       - in: path
     *         name: launchpadAddress
     *         required: true
     *         schema:
     *           type: string
     *         description: Launchpad contract address
     *     responses:
     *       200:
     *         description: Sync completed
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success: { type: boolean }
     *                 chainId: { type: integer }
     *                 launchpadAddress: { type: string }
     *                 synced: { type: integer }
     *                 errors: { type: integer }
     *       404:
     *         description: Chain or launchpad not found
     */
    if (pathname.match(/^\/api\/indexer\/sync\/\d+\/0x[a-fA-F0-9]+$/) && req.method === 'POST') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const launchpadAddress = parts[5];
      
      const manager = getMultiChainListenerManager();
      const listener = manager.getListener(chainId);
      
      if (!listener) {
        sendError(res, `Chain ${chainId} not found or not active`, 404);
        return true;
      }

      const { result, activityId } = await withActivityLogging(
        {
          operationType: 'sync_nfts',
          chainId,
          contractAddress: launchpadAddress.toLowerCase(),
          metadata: { scope: 'launchpad' },
        },
        async () => {
          return await listener.syncMissingNFTs(launchpadAddress);
        }
      );

      sendJSON(res, {
        success: true,
        chainId,
        launchpadAddress,
        synced: result.synced,
        errors: result.errors,
        activityId,
      });
      return true;
    }

    /**
     * @openapi
     * /api/indexer/sync-all:
     *   post:
     *     tags:
     *       - Indexer
     *     summary: Sync all missing NFTs across all chains
     *     description: Synchronize all missing NFTs for all launchpads on all active chains
     *     responses:
     *       200:
     *         description: Sync completed
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success: { type: boolean }
     *                 results:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       chainId: { type: integer }
     *                       total: { type: integer }
     *                       errors: { type: integer }
     */
    if (pathname === '/api/indexer/sync-all' && req.method === 'POST') {
      const manager = getMultiChainListenerManager();
      
      const { result: results, activityId } = await withActivityLogging(
        {
          operationType: 'sync_nfts',
          metadata: { scope: 'all_chains' },
        },
        async () => {
          return await manager.syncAllMissingNFTs();
        }
      );

      sendJSON(res, {
        success: true,
        results,
        activityId,
      });
      return true;
    }

    /**
     * @openapi
     * /api/indexer/sync-minted-count:
     *   post:
     *     tags:
     *       - Indexer
     *     summary: Sync mintedCount for all launchpads
     *     description: Sync mintedCount in launchpads table with actual count from mints table. Use this to fix any discrepancies.
     *     responses:
     *       200:
     *         description: Sync completed
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success: { type: boolean }
     *                 total: { type: integer }
     *                 fixed: { type: integer }
     *                 alreadyCorrect: { type: integer }
     *                 details: { type: array }
     */
    if (pathname === '/api/indexer/sync-minted-count' && req.method === 'POST') {
      const { result, activityId } = await withActivityLogging(
        {
          operationType: 'sync_minted_count',
          metadata: { scope: 'all_launchpads' },
        },
        async () => {
          // Get all launchpads with their mint counts
          const launchpads = await prisma.launchpad.findMany({
            select: {
              id: true,
              contractAddress: true,
              name: true,
              mintedCount: true,
              _count: {
                select: {
                  mints: true
                }
              }
            }
          });

          let fixedCount = 0;
          let alreadyCorrect = 0;
          const details: any[] = [];

          for (const launchpad of launchpads) {
            const actualMintCount = launchpad._count.mints;
            const storedMintCount = launchpad.mintedCount;

            if (actualMintCount !== storedMintCount) {
              // Update to correct value
              await prisma.launchpad.update({
                where: { id: launchpad.id },
                data: { mintedCount: actualMintCount }
              });
              
              details.push({
                contractAddress: launchpad.contractAddress,
                name: launchpad.name,
                oldValue: storedMintCount,
                newValue: actualMintCount,
                status: 'fixed'
              });
              fixedCount++;
            } else {
              alreadyCorrect++;
            }
          }

          return {
            total: launchpads.length,
            fixed: fixedCount,
            alreadyCorrect,
            details,
            itemsProcessed: launchpads.length,
            errors: 0,
          };
        }
      );

      sendJSON(res, {
        success: true,
        total: result.total,
        fixed: result.fixed,
        alreadyCorrect: result.alreadyCorrect,
        details: result.details,
        activityId,
      });
      return true;
    }

    /**
     * @openapi
     * /api/metadata/refresh/{chainId}/{contractAddress}:
     *   post:
     *     tags:
     *       - Metadata
     *     summary: Refresh metadata for entire collection
     *     description: Trigger metadata refresh for all NFTs in a collection via Alchemy API
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
     *         description: Contract address
     *     responses:
     *       200:
     *         description: Refresh triggered
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success: { type: boolean }
     *                 message: { type: string }
     *       404:
     *         description: Chain not supported
     */
    if (pathname.match(/^\/api\/metadata\/refresh\/\d+\/0x[a-fA-F0-9]+$/) && req.method === 'POST') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      
      const chainConfig = getChainConfig(chainId);
      if (!chainConfig) {
        sendError(res, `Chain ${chainId} not supported`, 404);
        return true;
      }

      // Get Alchemy network from RPC URL
      const alchemyNetwork = getAlchemyNetwork(chainId);
      if (!alchemyNetwork) {
        sendError(res, `Alchemy not configured for chain ${chainId}`, 400);
        return true;
      }

      const { result, activityId } = await withActivityLogging(
        {
          operationType: 'sync_metadata',
          chainId,
          contractAddress: contractAddress.toLowerCase(),
          metadata: { scope: 'collection' },
        },
        async () => {
          const alchemyService = new AlchemyNFTService({
            apiKey: process.env.ALCHEMY_API_KEY || '',
            network: alchemyNetwork
          });

          const result = await alchemyService.invalidateContract(contractAddress);
          return {
            message: result.message || 'Metadata refresh triggered for collection',
            itemsProcessed: 1,
            errors: 0,
          };
        }
      );

      sendJSON(res, {
        success: true,
        message: result.message,
        activityId,
      });
      return true;
    }

    /**
     * @openapi
     * /api/metadata/refresh/{chainId}/{contractAddress}/{tokenId}:
     *   post:
     *     tags:
     *       - Metadata
     *     summary: Refresh metadata for a specific NFT
     *     description: Trigger metadata refresh for a single NFT via Alchemy API
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
     *         description: Contract address
     *       - in: path
     *         name: tokenId
     *         required: true
     *         schema:
     *           type: string
     *         description: Token ID
     *     responses:
     *       200:
     *         description: Refresh triggered
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success: { type: boolean }
     *                 message: { type: string }
     *       404:
     *         description: Chain not supported
     */
    if (pathname.match(/^\/api\/metadata\/refresh\/\d+\/0x[a-fA-F0-9]+\/\d+$/) && req.method === 'POST') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[4]);
      const contractAddress = parts[5];
      const tokenId = parts[6];
      
      const chainConfig = getChainConfig(chainId);
      if (!chainConfig) {
        sendError(res, `Chain ${chainId} not supported`, 404);
        return true;
      }

      const alchemyNetwork = getAlchemyNetwork(chainId);
      if (!alchemyNetwork) {
        sendError(res, `Alchemy not configured for chain ${chainId}`, 400);
        return true;
      }

      const alchemyService = new AlchemyNFTService({
        apiKey: process.env.ALCHEMY_API_KEY || '',
        network: alchemyNetwork
      });

      const result = await alchemyService.refreshNFTMetadata(contractAddress, tokenId);
      sendJSON(res, {
        success: true,
        message: result.message || `Metadata refresh triggered for token ${tokenId}`
      });
      return true;
    }

    /**
     * @openapi
     * /api/chains:
     *   get:
     *     tags:
     *       - Chain
     *     summary: Get all supported chains
     *     description: Get status of all blockchain listeners and supported chains
     *     responses:
     *       200:
     *         description: Chain statuses
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 chains:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       chainId: { type: integer }
     *                       chainName: { type: string }
     *                       isRunning: { type: boolean }
     *                       launchpadCount: { type: integer }
     *                       error: { type: string }
     */
    if (pathname === '/api/chains' && req.method === 'GET') {
      const manager = getMultiChainListenerManager();
      const statuses = await manager.getStatus();
      sendJSON(res, { chains: statuses });
      return true;
    }

    /**
     * @openapi
     * /api/chains/{chainId}/restart:
     *   post:
     *     tags:
     *       - Chain
     *     summary: Restart chain listener
     *     description: Restart the blockchain listener for a specific chain
     *     parameters:
     *       - in: path
     *         name: chainId
     *         required: true
     *         schema:
     *           type: integer
     *         description: Chain ID
     *     responses:
     *       200:
     *         description: Listener restarted
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success: { type: boolean }
     *                 message: { type: string }
     */
    if (pathname.match(/^\/api\/chains\/\d+\/restart$/) && req.method === 'POST') {
      const chainId = parseInt(pathname.split('/')[3]);
      const manager = getMultiChainListenerManager();
      await manager.restartChain(chainId);
      sendJSON(res, {
        success: true,
        message: `Chain ${chainId} listener restarted`
      });
      return true;
    }

    /**
     * @openapi
     * /api/launchpad/{chainId}/{contractAddress}:
     *   get:
     *     tags:
     *       - Launchpad
     *     summary: Get launchpad details
     *     description: Get detailed information about a specific launchpad including phases with formatted prices
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
     *         description: Launchpad contract address
     *     responses:
     *       200:
     *         description: Launchpad details
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 launchpad:
     *                   type: object
     *       404:
     *         description: Launchpad not found
     */
    if (pathname.match(/^\/api\/launchpad\/\d+\/0x[a-fA-F0-9]+$/) && req.method === 'GET') {
      const parts = pathname.split('/');
      const chainId = parseInt(parts[3]);
      const contractAddress = parts[4].toLowerCase();
      
      const launchpad = await prisma.launchpad.findFirst({
        where: {
          chainId,
          contractAddress
        },
        include: {
          phases: {
            orderBy: { phaseIndex: 'asc' }
          },
          metadata: true,
          analytics: true
        }
      });

      if (!launchpad) {
        sendError(res, 'Launchpad not found', 404);
        return true;
      }

      // Format the launchpad data with price conversions
      const { formatLaunchpadForApi } = await import('../utils/format-helpers');
      const formattedLaunchpad = formatLaunchpadForApi(launchpad);

      sendJSON(res, { launchpad: formattedLaunchpad });
      return true;
    }

    /**
     * @openapi
     * /api/launchpads/{chainId}:
     *   get:
     *     tags:
     *       - Launchpad
     *     summary: Get launchpads for a chain
     *     description: Get all launchpads registered on a specific chain
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
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 launchpads:
     *                   type: array
     *                   items:
     *                     type: object
     *                     properties:
     *                       contractAddress: { type: string }
     *                       name: { type: string }
     *                       status: { type: string }
     *                       totalSupply: { type: integer }
     */
    if (pathname.match(/^\/api\/launchpads\/\d+$/) && req.method === 'GET') {
      const chainId = parseInt(pathname.split('/').pop() || '0');
      const launchpads = await prisma.launchpad.findMany({
        where: { chainId },
        select: {
          contractAddress: true,
          name: true,
          status: true,
          totalMaxSupply: true,
          createdAt: true
        },
        orderBy: { createdAt: 'desc' }
      });
      sendJSON(res, { launchpads });
      return true;
    }

    // ============ TEST ENDPOINTS ============

    /**
     * @openapi
     * /api/test/mint:
     *   post:
     *     tags:
     *       - Test
     *     summary: Test mint WebSocket event
     *     description: |
     *       Send a test mint event via WebSocket for testing purposes.
     *       This will broadcast to wallet room, launchpad room, and homepage rooms.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - contractAddress
     *               - chainId
     *               - minter
     *               - tokenId
     *             properties:
     *               contractAddress:
     *                 type: string
     *                 description: Launchpad contract address
     *                 example: "0xd1a78490daf72ca584ff6a3ba08a5369521c13ac"
     *               chainId:
     *                 type: integer
     *                 description: Chain ID
     *                 example: 6342
     *               minter:
     *                 type: string
     *                 description: Minter wallet address
     *                 example: "0x1234567890abcdef1234567890abcdef12345678"
     *               tokenId:
     *                 type: string
     *                 description: Token ID
     *                 example: "1"
     *               quantity:
     *                 type: integer
     *                 description: Quantity minted
     *                 default: 1
     *               imageUrl:
     *                 type: string
     *                 description: NFT image URL (optional)
     *     responses:
     *       200:
     *         description: Test mint event sent
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success: { type: boolean }
     *                 message: { type: string }
     *                 data:
     *                   type: object
     *                   properties:
     *                     contractAddress: { type: string }
     *                     chainId: { type: integer }
     *                     minter: { type: string }
     *                     tokenId: { type: string }
     *                     quantity: { type: integer }
     *                     timestamp: { type: string }
     *                     rooms:
     *                       type: array
     *                       items: { type: string }
     *       400:
     *         description: Missing required fields
     *       503:
     *         description: WebSocket server not available
     */
    if (pathname === '/api/test/mint' && req.method === 'POST') {
      // Parse request body
      let body = '';
      await new Promise<void>((resolve) => {
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', resolve);
      });

      let data;
      try {
        data = JSON.parse(body);
      } catch (e) {
        sendError(res, 'Invalid JSON body', 400);
        return true;
      }

      // Validate required fields
      const { contractAddress, chainId, minter, tokenId, quantity = 1, imageUrl } = data;
      
      if (!contractAddress || !chainId || !minter || !tokenId) {
        sendError(res, 'Missing required fields: contractAddress, chainId, minter, tokenId', 400);
        return true;
      }

      // Get WebSocket manager from global
      const wsManager = (global as any).websocketManager as WebSocketManager;
      if (!wsManager) {
        sendError(res, 'WebSocket server not initialized', 503);
        return true;
      }

      // Create EventEmitter and send test mint event
      const eventEmitter = new EventEmitter(wsManager);
      
      const mintEventData = {
        contractAddress: contractAddress.toLowerCase(),
        chainId: parseInt(chainId),
        minter: minter.toLowerCase(),
        tokenId: String(tokenId),
        quantity: parseInt(quantity) || 1,
        timestamp: new Date(),
        transactionHash: `0xtest_${Date.now().toString(16)}`,
        imageUrl: imageUrl || undefined,
      };

      // Emit the mint event
      eventEmitter.emitMintEvent(mintEventData);

      // Return success with info about which rooms received the event
      sendJSON(res, {
        success: true,
        message: 'Test mint event sent successfully',
        data: {
          ...mintEventData,
          timestamp: mintEventData.timestamp.toISOString(),
          rooms: [
            `wallet:${minter.toLowerCase()}`,
            `launchpad:${contractAddress.toLowerCase()}`,
            'homepage:all',
            `homepage:chain:${chainId}`
          ]
        }
      });
      return true;
    }

    /**
     * @openapi
     * /api/test/batch-mint:
     *   post:
     *     tags:
     *       - Test
     *     summary: Test batch mint WebSocket event
     *     description: |
     *       Send a test batch mint event via WebSocket for testing purposes.
     *       Use this to test minting multiple NFTs in one transaction.
     *     requestBody:
     *       required: true
     *       content:
     *         application/json:
     *           schema:
     *             type: object
     *             required:
     *               - contractAddress
     *               - chainId
     *               - minter
     *               - tokenIds
     *             properties:
     *               contractAddress:
     *                 type: string
     *                 description: Launchpad contract address
     *                 example: "0xd1a78490daf72ca584ff6a3ba08a5369521c13ac"
     *               chainId:
     *                 type: integer
     *                 description: Chain ID
     *                 example: 6342
     *               minter:
     *                 type: string
     *                 description: Minter wallet address
     *                 example: "0x1234567890abcdef1234567890abcdef12345678"
     *               tokenIds:
     *                 type: array
     *                 items: { type: string }
     *                 description: Array of token IDs
     *                 example: ["1", "2", "3"]
     *               imageUrl:
     *                 type: string
     *                 description: NFT image URL (optional)
     *     responses:
     *       200:
     *         description: Test batch mint event sent
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success: { type: boolean }
     *                 message: { type: string }
     *                 data:
     *                   type: object
     *                   properties:
     *                     contractAddress: { type: string }
     *                     chainId: { type: integer }
     *                     minter: { type: string }
     *                     tokenIds:
     *                       type: array
     *                       items: { type: string }
     *                     totalQuantity: { type: integer }
     *                     timestamp: { type: string }
     *                     rooms:
     *                       type: array
     *                       items: { type: string }
     *       400:
     *         description: Missing required fields
     *       503:
     *         description: WebSocket server not available
     */
    if (pathname === '/api/test/batch-mint' && req.method === 'POST') {
      // Parse request body
      let body = '';
      await new Promise<void>((resolve) => {
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', resolve);
      });

      let data;
      try {
        data = JSON.parse(body);
      } catch (e) {
        sendError(res, 'Invalid JSON body', 400);
        return true;
      }

      // Validate required fields
      const { contractAddress, chainId, minter, tokenIds, imageUrl } = data;
      
      if (!contractAddress || !chainId || !minter || !tokenIds || !Array.isArray(tokenIds)) {
        sendError(res, 'Missing required fields: contractAddress, chainId, minter, tokenIds (array)', 400);
        return true;
      }

      // Get WebSocket manager from global
      const wsManager = (global as any).websocketManager as WebSocketManager;
      if (!wsManager) {
        sendError(res, 'WebSocket server not initialized', 503);
        return true;
      }

      // Create EventEmitter and send test batch mint event
      const eventEmitter = new EventEmitter(wsManager);
      
      const batchMintEventData = {
        contractAddress: contractAddress.toLowerCase(),
        chainId: parseInt(chainId),
        minter: minter.toLowerCase(),
        tokenIds: tokenIds.map(String),
        totalQuantity: tokenIds.length,
        timestamp: new Date(),
        transactionHash: `0xtest_batch_${Date.now().toString(16)}`,
        imageUrl: imageUrl || undefined,
      };

      // Emit the batch mint event
      eventEmitter.emitBatchMintEvent(batchMintEventData);

      // Return success with info about which rooms received the event
      sendJSON(res, {
        success: true,
        message: 'Test batch mint event sent successfully',
        data: {
          ...batchMintEventData,
          timestamp: batchMintEventData.timestamp.toISOString(),
          rooms: [
            `wallet:${minter.toLowerCase()}`,
            `launchpad:${contractAddress.toLowerCase()}`,
            'homepage:all',
            `homepage:chain:${chainId}`
          ]
        }
      });
      return true;
    }

    // ============ IPFS ENDPOINTS ============

    /**
     * @openapi
     * /api/ipfs/upload-folder:
     *   post:
     *     tags:
     *       - IPFS
     *     summary: Upload NFT collection (images + metadata) to IPFS via Pinata
     *     description: |
     *       Two-phase upload process for NFT collections:
     *       1. Upload all images to IPFS (get images CID)
     *       2. Update JSON metadata files with image URLs from images CID
     *       3. Upload updated JSON metadata to IPFS (get metadata CID)
     *       4. Return metadata CID as folderCID in response
     *       
     *       Example: Upload 0.png, 1.png, 0.json, 1.json
     *       - Images uploaded to ipfs://CID_IMAGES/
     *       - JSON files updated: "image": "ipfs://CID_IMAGES/0.png"
     *       - Metadata uploaded to ipfs://CID_METADATA/
     *       - Response returns CID_METADATA as folderCID
     *     requestBody:
     *       required: true
     *       content:
     *         multipart/form-data:
     *           schema:
     *             type: object
     *             required:
     *               - files
     *             properties:
     *               folderName:
     *                 type: string
     *                 description: Collection name for Pinata metadata
     *                 example: "Rebellious Pika Collection"
     *               files:
     *                 type: array
     *                 items:
     *                   type: string
     *                   format: binary
     *                 description: Files to upload (images and JSON metadata files)
     *     responses:
     *       200:
     *         description: Collection uploaded successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                   example: true
     *                 folderCID:
     *                   type: string
     *                   description: IPFS CID of the metadata folder (JSON files)
     *                   example: "QmMetadataXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
     *                 folderUrl:
     *                   type: string
     *                   description: IPFS URL of the metadata folder
     *                   example: "ipfs://QmMetadataXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/"
     *                 gatewayUrl:
     *                   type: string
     *                   description: HTTP gateway URL for metadata
     *                   example: "https://gateway.pinata.cloud/ipfs/QmMetadataXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/"
     *                 fileCount:
     *                   type: integer
     *                   description: Total number of files uploaded
     *                   example: 200
     *                 uploadedFiles:
     *                   type: array
     *                   items:
     *                     type: string
     *                   description: List of all uploaded file names
     *                   example: ["0.png", "1.png", "0.json", "1.json"]
     *                 _details:
     *                   type: object
     *                   description: Additional information about the upload
     *                   properties:
     *                     imagesCID:
     *                       type: string
     *                       example: "QmImagesYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY"
     *                     imagesUrl:
     *                       type: string
     *                       example: "ipfs://QmImagesYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY/"
     *                     imagesGatewayUrl:
     *                       type: string
     *                       example: "https://gateway.pinata.cloud/ipfs/QmImagesYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY/"
     *                     breakdown:
     *                       type: object
     *                       properties:
     *                         images:
     *                           type: integer
     *                           example: 100
     *                         metadata:
     *                           type: integer
     *                           example: 100
     *       400:
     *         description: Invalid request (missing files, no images found)
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 error:
     *                   type: string
     *                   example: "No image files found in upload"
     *       500:
     *         description: Server error (Pinata credentials not configured, upload failed)
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 error:
     *                   type: string
     *                   example: "Pinata credentials not configured"
     *       504:
     *         description: Upload timeout
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 error:
     *                   type: string
     *                   example: "Upload timed out. Please try again."
     */
    if (pathname === '/api/ipfs/upload-folder' && req.method === 'POST') {
      await handleIpfsUploadFolder(req, res);
      return true;
    }

    // Not an API route
    return false;
  } catch (error) {
    console.error('API Error:', error);
    sendError(res, error instanceof Error ? error.message : 'Internal server error', 500);
    return true;
  }
}

/**
 * Get Alchemy network string from chain ID
 */
function getAlchemyNetwork(chainId: number): string | null {
  const networkMap: Record<number, string> = {
    1: 'eth-mainnet',
    5: 'eth-goerli',
    11155111: 'eth-sepolia',
    137: 'polygon-mainnet',
    80001: 'polygon-mumbai',
    42161: 'arb-mainnet',
    421613: 'arb-goerli',
    10: 'opt-mainnet',
    420: 'opt-goerli',
    8453: 'base-mainnet',
    84531: 'base-goerli',
    6343: 'megaeth-testnet',
    10143: 'monad-testnet',
  };
  return networkMap[chainId] || null;
}
