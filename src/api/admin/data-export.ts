import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { prisma } from '../../config/database';
import { sendJSON, sendError, getQueryParams } from './index';
import { logActivity } from './activity-logger';

// Maximum records to export to prevent server overload
const MAX_EXPORT_RECORDS = 10000;

/**
 * Convert data to CSV format
 */
function toCSV(data: any[], headers: string[]): string {
  const rows = [headers.join(',')];
  
  for (const item of data) {
    const row = headers.map((header) => {
      const value = item[header];
      if (value === null || value === undefined) {
        return '';
      }
      // Escape quotes and wrap in quotes if contains comma or newline
      const strValue = String(value);
      if (strValue.includes(',') || strValue.includes('\n') || strValue.includes('"')) {
        return `"${strValue.replace(/"/g, '""')}"`;
      }
      return strValue;
    });
    rows.push(row.join(','));
  }
  
  return rows.join('\n');
}

/**
 * Handle GET /api/admin/export/{chainId}/{address}
 * Export collection data in CSV or JSON format
 */
export async function handleDataExport(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  chainId: number,
  address: string
): Promise<boolean> {
  const normalizedAddress = address.toLowerCase();
  const params = getQueryParams(url);
  const format = params.format === 'csv' ? 'csv' : 'json';

  const activityId = await logActivity({
    operationType: 'sync_nfts', // Using sync_nfts as closest match for export
    status: 'in_progress',
    chainId,
    contractAddress: normalizedAddress,
    metadata: { action: 'export', format },
  });

  try {
    // Find the launchpad
    const launchpad = await prisma.launchpad.findFirst({
      where: {
        chainId,
        contractAddress: normalizedAddress,
      },
      include: {
        metadata: true,
        phases: true,
        analytics: true,
      },
    });

    if (!launchpad) {
      await logActivity({
        id: activityId,
        status: 'failed',
        errorMessage: 'Collection not found',
      });
      sendError(res, 'Collection not found', 404);
      return true;
    }

    // Get mint history (limited)
    const mints = await prisma.mint.findMany({
      where: { launchpadId: launchpad.id },
      orderBy: { createdAt: 'desc' },
      take: MAX_EXPORT_RECORDS,
      select: {
        tokenId: true,
        minter: true,
        quantity: true,
        price: true,
        txHash: true,
        blockNumber: true,
        createdAt: true,
      },
    });

    // Get unique holders
    const holders = await prisma.mint.groupBy({
      by: ['minter'],
      where: { launchpadId: launchpad.id },
      _count: { tokenId: true },
      _sum: { quantity: true },
    });

    // Prepare export data
    const exportData = {
      collection: {
        chainId: launchpad.chainId,
        contractAddress: launchpad.contractAddress,
        name: launchpad.name,
        symbol: launchpad.symbol,
        description: launchpad.description,
        totalMaxSupply: launchpad.totalMaxSupply,
        mintedCount: launchpad.mintedCount,
        status: launchpad.status,
        creator: launchpad.creator,
        treasury: launchpad.treasury,
        royaltyPercentage: launchpad.royaltyPercentage,
        createdAt: launchpad.createdAt.toISOString(),
        lastSyncAt: launchpad.lastSyncAt?.toISOString(),
      },
      metadata: launchpad.metadata ? {
        image: launchpad.metadata.image,
        bannerImage: launchpad.metadata.bannerImage,
        website: launchpad.metadata.website,
        twitter: launchpad.metadata.twitter,
        discord: launchpad.metadata.discord,
        telegram: launchpad.metadata.telegram,
        tags: launchpad.metadata.tags,
        category: launchpad.metadata.category,
        featured: launchpad.metadata.featured,
        verified: launchpad.metadata.verified,
      } : null,
      phases: launchpad.phases.map((phase) => ({
        name: phase.name,
        phaseType: phase.phaseType,
        startTime: phase.startTime.toISOString(),
        endTime: phase.endTime?.toISOString(),
        price: phase.price,
        maxMintPerWallet: phase.maxMintPerWallet,
        totalLimit: phase.totalLimit,
        mintedCount: phase.mintedCount,
        isActive: phase.isActive,
      })),
      analytics: launchpad.analytics ? {
        totalVolume: launchpad.analytics.totalVolume,
        totalMints: launchpad.analytics.totalMints,
        uniqueHolders: launchpad.analytics.uniqueHolders,
        avgMintPrice: launchpad.analytics.avgMintPrice,
        floorPrice: launchpad.analytics.floorPrice,
        lastSalePrice: launchpad.analytics.lastSalePrice,
        views: launchpad.analytics.views,
        likes: launchpad.analytics.likes,
      } : null,
      mintHistory: mints.map((mint) => ({
        tokenId: mint.tokenId,
        minter: mint.minter,
        quantity: mint.quantity,
        price: mint.price,
        txHash: mint.txHash,
        blockNumber: mint.blockNumber,
        timestamp: mint.createdAt.toISOString(),
      })),
      holders: holders.map((holder) => ({
        address: holder.minter,
        tokenCount: holder._count.tokenId,
        totalQuantity: holder._sum.quantity || 0,
      })),
      exportInfo: {
        exportedAt: new Date().toISOString(),
        totalMints: mints.length,
        totalHolders: holders.length,
        maxRecordsLimit: MAX_EXPORT_RECORDS,
        truncated: mints.length >= MAX_EXPORT_RECORDS,
      },
    };

    await logActivity({
      id: activityId,
      status: 'success',
      itemsProcessed: mints.length,
      metadata: { 
        format, 
        totalMints: mints.length, 
        totalHolders: holders.length,
      },
    });

    if (format === 'csv') {
      // For CSV, export mint history as the main data
      const csvHeaders = ['tokenId', 'minter', 'quantity', 'price', 'txHash', 'blockNumber', 'timestamp'];
      const csvData = toCSV(exportData.mintHistory, csvHeaders);
      
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${launchpad.name.replace(/[^a-z0-9]/gi, '_')}_export.csv"`,
      });
      res.end(csvData);
    } else {
      // JSON format
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${launchpad.name.replace(/[^a-z0-9]/gi, '_')}_export.json"`,
      });
      res.end(JSON.stringify(exportData, null, 2));
    }

    return true;
  } catch (error) {
    await logActivity({
      id: activityId,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    console.error('Error exporting data:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to export data', 500);
    return true;
  }
}
