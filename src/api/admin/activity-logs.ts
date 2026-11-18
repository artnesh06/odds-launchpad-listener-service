import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { prisma } from '../../config/database';
import { sendJSON, sendError, getQueryParams } from './index';

/**
 * Handle GET /api/admin/activity-logs
 * Get activity logs with filtering and pagination
 */
export async function handleActivityLogs(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  try {
    const params = getQueryParams(url);

    // Parse pagination
    const page = Math.max(1, parseInt(params.page || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(params.limit || '50')));
    const skip = (page - 1) * limit;

    // Build filter conditions
    const where: any = {};

    if (params.contractAddress) {
      where.contractAddress = params.contractAddress.toLowerCase();
    }

    if (params.operationType) {
      where.operationType = params.operationType;
    }

    if (params.status) {
      where.status = params.status;
    }

    if (params.chainId) {
      where.chainId = parseInt(params.chainId);
    }

    // Date range filters
    if (params.fromDate || params.toDate) {
      where.startedAt = {};
      if (params.fromDate) {
        where.startedAt.gte = new Date(params.fromDate);
      }
      if (params.toDate) {
        where.startedAt.lte = new Date(params.toDate);
      }
    }

    // Get total count for pagination
    const total = await prisma.adminActivityLog.count({ where });

    // Get logs
    const logs = await prisma.adminActivityLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
    });

    // Calculate pagination info
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    sendJSON(res, {
      logs: logs.map((log) => ({
        id: log.id,
        operationType: log.operationType,
        status: log.status,
        chainId: log.chainId,
        contractAddress: log.contractAddress,
        startedAt: log.startedAt?.toISOString(),
        completedAt: log.completedAt?.toISOString(),
        duration: log.duration,
        itemsProcessed: log.itemsProcessed,
        itemsFailed: log.itemsFailed,
        errorMessage: log.errorMessage,
        metadata: log.metadata,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
    return true;
  } catch (error) {
    console.error('Error getting activity logs:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to get activity logs', 500);
    return true;
  }
}
