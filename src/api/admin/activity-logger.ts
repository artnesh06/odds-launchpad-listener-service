import { prisma } from '../../config/database';

export type OperationType = 
  | 'sync_nfts' 
  | 'sync_metadata' 
  | 'sync_minted_count' 
  | 'rescan' 
  | 'restart' 
  | 'register' 
  | 'remove'
  | 'collection_sync';

export type OperationStatus = 'pending' | 'in_progress' | 'success' | 'failed';

export interface ActivityLogInput {
  id?: string;
  operationType?: OperationType;
  status: OperationStatus;
  chainId?: number;
  contractAddress?: string;
  itemsProcessed?: number;
  itemsFailed?: number;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export interface StartActivityInput {
  operationType: OperationType;
  chainId?: number;
  contractAddress?: string;
  metadata?: Record<string, any>;
}

export interface ActivityLogRecord {
  id: string;
  operationType: string;
  status: string;
  chainId: number | null;
  contractAddress: string | null;
  startedAt: Date;
  completedAt: Date | null;
  duration: number | null;
  itemsProcessed: number;
  itemsFailed: number;
  errorMessage: string | null;
  metadata: any;
}

/**
 * Log an activity operation
 * If id is provided, updates existing record
 * Otherwise creates a new record and returns the id
 */
export async function logActivity(input: ActivityLogInput): Promise<string> {
  const now = new Date();

  if (input.id) {
    // Update existing record
    const updateData: any = {
      status: input.status,
    };

    if (input.status === 'success' || input.status === 'failed') {
      updateData.completedAt = now;
      
      // Calculate duration if we have startedAt
      const existing = await prisma.adminActivityLog.findUnique({
        where: { id: input.id },
        select: { startedAt: true },
      });
      
      if (existing?.startedAt) {
        updateData.duration = now.getTime() - existing.startedAt.getTime();
      }
    }

    if (input.itemsProcessed !== undefined) {
      updateData.itemsProcessed = input.itemsProcessed;
    }
    if (input.itemsFailed !== undefined) {
      updateData.itemsFailed = input.itemsFailed;
    }
    if (input.errorMessage) {
      updateData.errorMessage = input.errorMessage;
    }
    if (input.metadata) {
      updateData.metadata = input.metadata;
    }
    if (input.chainId !== undefined) {
      updateData.chainId = input.chainId;
    }
    if (input.contractAddress) {
      updateData.contractAddress = input.contractAddress;
    }

    await prisma.adminActivityLog.update({
      where: { id: input.id },
      data: updateData,
    });

    return input.id;
  } else {
    // Create new record
    const record = await prisma.adminActivityLog.create({
      data: {
        operationType: input.operationType || 'sync_nfts',
        status: input.status,
        chainId: input.chainId,
        contractAddress: input.contractAddress,
        startedAt: now,
        completedAt: input.status === 'success' || input.status === 'failed' ? now : null,
        duration: 0,
        itemsProcessed: input.itemsProcessed || 0,
        itemsFailed: input.itemsFailed || 0,
        errorMessage: input.errorMessage,
        metadata: input.metadata || {},
      },
    });

    return record.id;
  }
}

/**
 * Update activity progress
 */
export async function updateActivityProgress(
  id: string,
  itemsProcessed: number,
  itemsFailed: number = 0,
  metadata?: Record<string, any>
): Promise<void> {
  const updateData: any = {
    itemsProcessed,
    itemsFailed,
  };

  if (metadata) {
    updateData.metadata = metadata;
  }

  await prisma.adminActivityLog.update({
    where: { id },
    data: updateData,
  });
}

/**
 * Complete an activity with success
 */
export async function completeActivity(
  id: string,
  itemsProcessed: number,
  itemsFailed: number = 0,
  metadata?: Record<string, any>
): Promise<void> {
  await logActivity({
    id,
    status: 'success',
    itemsProcessed,
    itemsFailed,
    metadata,
  });
}

/**
 * Fail an activity
 */
export async function failActivity(
  id: string,
  errorMessage: string,
  metadata?: Record<string, any>
): Promise<void> {
  await logActivity({
    id,
    status: 'failed',
    errorMessage,
    metadata,
  });
}

/**
 * Start a new activity operation
 * Convenience function that creates a new activity log with 'in_progress' status
 * Returns the activity ID for tracking
 */
export async function startActivity(input: StartActivityInput): Promise<string> {
  return await logActivity({
    operationType: input.operationType,
    status: 'in_progress',
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    metadata: input.metadata,
  });
}

/**
 * Get activity log by ID
 */
export async function getActivityById(id: string): Promise<ActivityLogRecord | null> {
  return await prisma.adminActivityLog.findUnique({
    where: { id },
  });
}

/**
 * Get recent activity logs
 */
export async function getRecentActivities(
  limit: number = 10,
  filters?: {
    operationType?: OperationType;
    status?: OperationStatus;
    chainId?: number;
    contractAddress?: string;
  }
): Promise<ActivityLogRecord[]> {
  const where: any = {};

  if (filters?.operationType) {
    where.operationType = filters.operationType;
  }
  if (filters?.status) {
    where.status = filters.status;
  }
  if (filters?.chainId) {
    where.chainId = filters.chainId;
  }
  if (filters?.contractAddress) {
    where.contractAddress = filters.contractAddress.toLowerCase();
  }

  return await prisma.adminActivityLog.findMany({
    where,
    orderBy: { startedAt: 'desc' },
    take: limit,
  });
}

/**
 * Get activity statistics
 */
export async function getActivityStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byOperationType: Record<string, number>;
  recentFailures: number;
}> {
  const [total, byStatus, byOperationType, recentFailures] = await Promise.all([
    prisma.adminActivityLog.count(),
    prisma.adminActivityLog.groupBy({
      by: ['status'],
      _count: { status: true },
    }),
    prisma.adminActivityLog.groupBy({
      by: ['operationType'],
      _count: { operationType: true },
    }),
    prisma.adminActivityLog.count({
      where: {
        status: 'failed',
        startedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    }),
  ]);

  return {
    total,
    byStatus: byStatus.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {} as Record<string, number>),
    byOperationType: byOperationType.reduce((acc, item) => {
      acc[item.operationType] = item._count.operationType;
      return acc;
    }, {} as Record<string, number>),
    recentFailures,
  };
}

/**
 * Wrapper function to execute an operation with automatic activity logging
 * This handles start, progress, success, and failure logging automatically
 */
export async function withActivityLogging<T>(
  input: StartActivityInput,
  operation: (activityId: string, updateProgress: (processed: number, failed?: number) => Promise<void>) => Promise<T>
): Promise<{ result: T; activityId: string }> {
  const activityId = await startActivity(input);

  const updateProgress = async (processed: number, failed: number = 0) => {
    await updateActivityProgress(activityId, processed, failed);
  };

  try {
    const result = await operation(activityId, updateProgress);
    
    // If result has synced/errors properties, use them for completion
    const resultObj = result as any;
    const itemsProcessed = resultObj?.synced ?? resultObj?.total ?? resultObj?.itemsProcessed ?? 0;
    const itemsFailed = resultObj?.errors ?? resultObj?.itemsFailed ?? 0;
    
    await completeActivity(activityId, itemsProcessed, itemsFailed);
    
    return { result, activityId };
  } catch (error) {
    await failActivity(
      activityId,
      error instanceof Error ? error.message : 'Unknown error'
    );
    throw error;
  }
}
