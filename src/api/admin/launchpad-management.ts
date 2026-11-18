import { IncomingMessage, ServerResponse } from 'http';
import { getChainProvider } from '../../lib/blockchain/chain-provider';
import { prisma } from '../../config/database';
import { getMultiChainListenerManager } from '../../lib/blockchain/multi-chain-listener-manager';
import { getChainConfig } from '../../config/chains';
import { sendJSON, sendError, parseJsonBody } from './index';
import { logActivity } from './activity-logger';
import { ethers } from 'ethers';

// Minimal ABI to check if contract is a valid launchpad
const LAUNCHPAD_CHECK_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function maxSupply() view returns (uint256)',
  'function owner() view returns (address)',
];

/**
 * Validate contract address on-chain
 */
async function validateLaunchpadContract(
  chainId: number,
  contractAddress: string
): Promise<{ valid: boolean; data?: any; error?: string }> {
  try {
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig) {
      return { valid: false, error: `Chain ${chainId} not supported` };
    }

    const provider = getChainProvider(chainId, chainConfig.rpcUrl);
    const contract = new ethers.Contract(contractAddress, LAUNCHPAD_CHECK_ABI, provider);

    // Try to read basic contract data
    const [name, symbol, totalSupply, maxSupply, owner] = await Promise.all([
      contract.name().catch(() => null),
      contract.symbol().catch(() => null),
      contract.totalSupply().catch(() => null),
      contract.maxSupply().catch(() => null),
      contract.owner().catch(() => null),
    ]);

    // Check if it looks like a valid NFT contract
    if (!name || !symbol) {
      return { valid: false, error: 'Contract does not appear to be a valid NFT launchpad' };
    }

    return {
      valid: true,
      data: {
        name,
        symbol,
        totalSupply: totalSupply ? totalSupply.toString() : '0',
        maxSupply: maxSupply ? maxSupply.toString() : '0',
        owner: owner || null,
      },
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Failed to validate contract',
    };
  }
}

/**
 * Handle POST /api/admin/launchpads/register
 * Register a new launchpad for monitoring
 */
export async function handleLaunchpadRegistration(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const activityId = await logActivity({
    operationType: 'register',
    status: 'in_progress',
  });

  try {
    const body = await parseJsonBody(req);
    const { chainId, contractAddress } = body;

    // Validate required fields
    if (!chainId || !contractAddress) {
      await logActivity({
        id: activityId,
        status: 'failed',
        errorMessage: 'Missing required fields: chainId, contractAddress',
      });
      sendError(res, 'Missing required fields: chainId, contractAddress', 400);
      return true;
    }

    // Normalize address
    const normalizedAddress = contractAddress.toLowerCase();

    // Check if already registered
    const existing = await prisma.launchpad.findUnique({
      where: { contractAddress: normalizedAddress },
    });

    if (existing) {
      // If it was removed, re-enable it
      if (existing.status === 'CANCELLED') {
        await prisma.launchpad.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE' },
        });

        // Add back to listener
        const manager = getMultiChainListenerManager();
        await manager.addLaunchpadToChain(chainId, normalizedAddress);

        await logActivity({
          id: activityId,
          status: 'success',
          chainId,
          contractAddress: normalizedAddress,
          metadata: { action: 're-enabled', launchpadId: existing.id },
        });

        sendJSON(res, {
          success: true,
          message: 'Launchpad re-enabled for monitoring',
          launchpad: existing,
        });
        return true;
      }

      await logActivity({
        id: activityId,
        status: 'failed',
        chainId,
        contractAddress: normalizedAddress,
        errorMessage: 'Launchpad already registered',
      });
      sendError(res, 'Launchpad already registered', 400);
      return true;
    }

    // Validate contract on-chain
    const validation = await validateLaunchpadContract(chainId, normalizedAddress);
    if (!validation.valid) {
      await logActivity({
        id: activityId,
        status: 'failed',
        chainId,
        contractAddress: normalizedAddress,
        errorMessage: validation.error,
      });
      sendError(res, validation.error || 'Invalid contract', 400);
      return true;
    }

    // Get factory for this chain
    const factory = await prisma.launchpadFactory.findFirst({
      where: { chainId, isActive: true },
    });

    if (!factory) {
      await logActivity({
        id: activityId,
        status: 'failed',
        chainId,
        contractAddress: normalizedAddress,
        errorMessage: 'No active factory found for this chain',
      });
      sendError(res, 'No active factory found for this chain', 400);
      return true;
    }

    // Create launchpad record
    const launchpad = await prisma.launchpad.create({
      data: {
        chainId,
        factoryId: factory.id,
        contractAddress: normalizedAddress,
        creator: validation.data.owner || '0x0000000000000000000000000000000000000000',
        name: validation.data.name,
        symbol: validation.data.symbol,
        totalMaxSupply: parseInt(validation.data.maxSupply) || 0,
        treasury: validation.data.owner || '0x0000000000000000000000000000000000000000',
        isShuffleEnabled: false, // Default to false for manual registration
        status: 'ACTIVE',
      },
    });

    // Add to listener manager
    const manager = getMultiChainListenerManager();
    await manager.addLaunchpadToChain(chainId, normalizedAddress);

    await logActivity({
      id: activityId,
      status: 'success',
      chainId,
      contractAddress: normalizedAddress,
      metadata: { launchpadId: launchpad.id, name: validation.data.name },
    });

    sendJSON(res, {
      success: true,
      message: 'Launchpad registered and monitoring started',
      launchpad: {
        id: launchpad.id,
        chainId: launchpad.chainId,
        contractAddress: launchpad.contractAddress,
        name: launchpad.name,
        symbol: launchpad.symbol,
        status: launchpad.status,
      },
    });
    return true;
  } catch (error) {
    await logActivity({
      id: activityId,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    console.error('Error registering launchpad:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to register launchpad', 500);
    return true;
  }
}

/**
 * Handle DELETE /api/admin/launchpads/{chainId}/{address}
 * Remove a launchpad from monitoring (soft delete)
 */
export async function handleLaunchpadRemoval(
  req: IncomingMessage,
  res: ServerResponse,
  chainId: number,
  address: string
): Promise<boolean> {
  const normalizedAddress = address.toLowerCase();
  
  const activityId = await logActivity({
    operationType: 'remove',
    status: 'in_progress',
    chainId,
    contractAddress: normalizedAddress,
  });

  try {
    // Find the launchpad
    const launchpad = await prisma.launchpad.findFirst({
      where: {
        chainId,
        contractAddress: normalizedAddress,
      },
    });

    if (!launchpad) {
      await logActivity({
        id: activityId,
        status: 'failed',
        errorMessage: 'Launchpad not found',
      });
      sendError(res, 'Launchpad not found', 404);
      return true;
    }

    // Soft delete - mark as CANCELLED
    await prisma.launchpad.update({
      where: { id: launchpad.id },
      data: { status: 'CANCELLED' },
    });

    // Remove from listener manager
    const manager = getMultiChainListenerManager();
    try {
      await manager.removeLaunchpadFromChain(chainId, normalizedAddress);
    } catch (error) {
      // Listener might not be running for this chain
      console.warn(`Could not remove launchpad from listener: ${error}`);
    }

    await logActivity({
      id: activityId,
      status: 'success',
      metadata: { launchpadId: launchpad.id, name: launchpad.name },
    });

    sendJSON(res, {
      success: true,
      message: 'Launchpad removed from monitoring (data preserved)',
      launchpad: {
        id: launchpad.id,
        chainId: launchpad.chainId,
        contractAddress: launchpad.contractAddress,
        name: launchpad.name,
        status: 'CANCELLED',
      },
    });
    return true;
  } catch (error) {
    await logActivity({
      id: activityId,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    console.error('Error removing launchpad:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to remove launchpad', 500);
    return true;
  }
}

/**
 * Handle GET /api/admin/launchpads/{chainId}
 * Get all launchpads for a chain with monitoring status
 */
export async function handleGetLaunchpads(
  req: IncomingMessage,
  res: ServerResponse,
  chainId: number
): Promise<boolean> {
  try {
    const launchpads = await prisma.launchpad.findMany({
      where: { chainId },
      select: {
        id: true,
        contractAddress: true,
        name: true,
        symbol: true,
        status: true,
        totalMaxSupply: true,
        mintedCount: true,
        creator: true,
        lastSyncAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get listener status
    const manager = getMultiChainListenerManager();
    const listenerStatus = await manager.getChainStatus(chainId);

    sendJSON(res, {
      chainId,
      listenerRunning: listenerStatus?.isRunning || false,
      totalLaunchpads: launchpads.length,
      activeLaunchpads: launchpads.filter((l) => l.status === 'ACTIVE').length,
      launchpads: launchpads.map((l) => ({
        ...l,
        isMonitored: l.status === 'ACTIVE',
      })),
    });
    return true;
  } catch (error) {
    console.error('Error getting launchpads:', error);
    sendError(res, error instanceof Error ? error.message : 'Failed to get launchpads', 500);
    return true;
  }
}
