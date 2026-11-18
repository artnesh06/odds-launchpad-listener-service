/**
 * Collection Sync Service
 * 
 * Service untuk sync semua transaksi (mint, transfer, burn) dari 1 collection
 * dengan parameter contract address dan chain ID.
 * 
 * Features:
 * - Scan semua Transfer events dari deployment block
 * - Process mint, transfer, dan burn events
 * - Update semua stats dan analytics
 * - Progress tracking via WebSocket
 * - Rate limiting dan error handling
 */

import { ethers } from 'ethers';
import { getChainProvider } from './chain-provider';
import { prisma } from '../../config/database';
import { WebSocketManager } from '../websocket/websocket-manager';
import { NFTEventHandler } from './event-handlers/nft-events';

export interface CollectionSyncOptions {
  contractAddress: string;
  chainId: number;
  fromBlock?: number;      // Default: deployment block
  toBlock?: number;        // Default: latest
  batchSize?: number;      // Default: 1000 blocks
  skipExisting?: boolean;  // Skip already processed txs
  rpcUrl: string;          // RPC URL for the chain
  updateStats?: boolean;   // Update launchpad stats during sync (default: false for re-sync)
}

export interface CollectionSyncResult {
  success: boolean;
  totalEvents: number;
  mints: number;
  transfers: number;
  burns: number;
  errors: number;
  fromBlock: number;
  toBlock: number;
  duration: number;
  errorDetails?: string[];
}

interface SyncProgress {
  currentBlock: number;
  fromBlock: number;
  toBlock: number;
  eventsProcessed: number;
  mints: number;
  transfers: number;
  burns: number;
  status: 'in_progress' | 'completed' | 'failed';
  error?: string;
}

// ERC721 Transfer event signature
const TRANSFER_EVENT_SIGNATURE = 'Transfer(address,address,uint256)';
const TRANSFER_TOPIC = ethers.id(TRANSFER_EVENT_SIGNATURE);

// Zero address for mint/burn detection
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Rate limiting
const BATCH_DELAY_MS = 1000; // 1 second between batches
const MAX_RETRIES = 3;

/**
 * Collection Sync Service
 */
export class CollectionSyncService {
  private provider: ethers.JsonRpcProvider;
  private wsManager: WebSocketManager | null;
  private chainId: number;
  private rpcUrl: string;
  private updateStats: boolean;

  constructor(
    chainId: number,
    rpcUrl: string,
    wsManager: WebSocketManager | null = null,
    updateStats: boolean = false
  ) {
    this.chainId = chainId;
    this.rpcUrl = rpcUrl;
    this.provider = getChainProvider(chainId, rpcUrl);
    this.wsManager = wsManager;
    this.updateStats = updateStats;
  }

  /**
   * Sync all transactions for a collection
   */
  async syncCollectionTransactions(
    options: CollectionSyncOptions
  ): Promise<CollectionSyncResult> {
    const startTime = Date.now();
    const {
      contractAddress,
      chainId,
      batchSize = 1000,
      skipExisting = true,
    } = options;

    const normalizedAddress = contractAddress.toLowerCase();

    console.log(`🔄 Starting collection sync for ${normalizedAddress} on chain ${chainId}`);

    try {
      // Get deployment block
      const deploymentBlock = await this.getDeploymentBlock(normalizedAddress, chainId);
      const fromBlock = options.fromBlock || deploymentBlock;
      
      // Get latest block
      const currentBlock = await this.provider.getBlockNumber();
      const toBlock = options.toBlock || currentBlock;

      console.log(`📊 Sync range: ${fromBlock} to ${toBlock} (${toBlock - fromBlock + 1} blocks)`);

      // Initialize counters
      let totalEvents = 0;
      let mints = 0;
      let transfers = 0;
      let burns = 0;
      let errors = 0;
      const errorDetails: string[] = [];

      // Process in batches
      for (let start = fromBlock; start <= toBlock; start += batchSize) {
        const end = Math.min(start + batchSize - 1, toBlock);

        try {
          console.log(`📡 Scanning blocks ${start} to ${end}...`);

          // Emit progress
          this.emitProgress(chainId, normalizedAddress, {
            currentBlock: start,
            fromBlock,
            toBlock,
            eventsProcessed: totalEvents,
            mints,
            transfers,
            burns,
            status: 'in_progress',
          });

          // Query Transfer events
          const events = await this.queryTransferEvents(
            normalizedAddress,
            start,
            end
          );

          console.log(`   Found ${events.length} Transfer events`);

          // Process each event
          for (let i = 0; i < events.length; i++) {
            const event = events[i];
            try {
              // Ensure logIndex is defined
              // If undefined, use the index in the events array as fallback
              const logIndex = (event.index !== undefined ? event.index : i);

              // Parse event to get tokenId and type
              const iface = new ethers.Interface([
                'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
              ]);
              const parsed = iface.parseLog({
                topics: event.topics as string[],
                data: event.data,
              });

              if (!parsed) {
                console.log(`   ⚠️  Failed to parse event: ${event.transactionHash}:${logIndex}`);
                continue;
              }

              const tokenId = parsed.args[2].toString();
              const eventType = this.categorizeTransferEvent(event);

              // Check if already processed (by contractAddress + tokenId + type + txHash)
              if (skipExisting) {
                const exists = await this.isEventProcessed(
                  normalizedAddress,
                  tokenId,
                  eventType.toUpperCase() as 'MINT' | 'TRANSFER' | 'BURN',
                  event.transactionHash
                );
                if (exists) {
                  console.log(`   ⏭️  Skipping already processed: ${normalizedAddress} token ${tokenId} ${eventType} in ${event.transactionHash}`);
                  continue;
                }
              }
              
              await this.processTransferEvent(
                event,
                eventType,
                chainId,
                normalizedAddress,
                logIndex
              );

              // Update counters
              totalEvents++;
              if (eventType === 'mint') mints++;
              else if (eventType === 'transfer') transfers++;
              else if (eventType === 'burn') burns++;

              console.log(`   ✅ Processed ${eventType}: ${normalizedAddress} token ${tokenId} in ${event.transactionHash}`);
            } catch (error) {
              errors++;
              const logIndex = (event.index !== undefined ? event.index : i);
              const errorMsg = `Error processing event ${event.transactionHash}:${logIndex}: ${error instanceof Error ? error.message : 'Unknown error'}`;
              console.error(`   ❌ ${errorMsg}`);
              errorDetails.push(errorMsg);
              
              // Continue with next event
              continue;
            }
          }

          // Rate limiting delay
          if (end < toBlock) {
            await this.sleep(BATCH_DELAY_MS);
          }
        } catch (error) {
          errors++;
          const errorMsg = `Error scanning blocks ${start}-${end}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(`❌ ${errorMsg}`);
          errorDetails.push(errorMsg);
          
          // Continue with next batch
          continue;
        }
      }

      const duration = Date.now() - startTime;

      // Emit completion
      this.emitProgress(chainId, normalizedAddress, {
        currentBlock: toBlock,
        fromBlock,
        toBlock,
        eventsProcessed: totalEvents,
        mints,
        transfers,
        burns,
        status: 'completed',
      });

      console.log(`✅ Collection sync completed in ${duration}ms`);
      console.log(`   Total events: ${totalEvents}`);
      console.log(`   Mints: ${mints}`);
      console.log(`   Transfers: ${transfers}`);
      console.log(`   Burns: ${burns}`);
      console.log(`   Errors: ${errors}`);

      return {
        success: true,
        totalEvents,
        mints,
        transfers,
        burns,
        errors,
        fromBlock,
        toBlock,
        duration,
        errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      
      console.error(`❌ Fatal error during collection sync: ${errorMsg}`);

      // Emit failure
      this.emitProgress(chainId, normalizedAddress, {
        currentBlock: 0,
        fromBlock: 0,
        toBlock: 0,
        eventsProcessed: 0,
        mints: 0,
        transfers: 0,
        burns: 0,
        status: 'failed',
        error: errorMsg,
      });

      return {
        success: false,
        totalEvents: 0,
        mints: 0,
        transfers: 0,
        burns: 0,
        errors: 1,
        fromBlock: 0,
        toBlock: 0,
        duration,
        errorDetails: [errorMsg],
      };
    }
  }

  /**
   * Get deployment block from database
   */
  private async getDeploymentBlock(
    contractAddress: string,
    chainId: number
  ): Promise<number> {
    // Try to get from Activity table (LAUNCHPAD_CREATED event)
    const activity = await prisma.activity.findFirst({
      where: {
        chainId,
        type: 'LAUNCHPAD_CREATED',
        launchpadId: {
          in: await prisma.launchpad.findMany({
            where: {
              contractAddress: contractAddress.toLowerCase(),
              chainId,
            },
            select: { id: true },
          }).then(results => results.map(r => r.id)),
        },
        blockNumber: { not: null },
      },
      select: {
        blockNumber: true,
      },
      orderBy: {
        blockNumber: 'asc',
      },
    });

    if (activity?.blockNumber) {
      return activity.blockNumber;
    }

    // Fallback: Try to get from Mint table (first mint block)
    const firstMint = await prisma.mint.findFirst({
      where: {
        launchpad: {
          contractAddress: contractAddress.toLowerCase(),
          chainId,
        },
        blockNumber: { not: null },
      },
      select: {
        blockNumber: true,
      },
      orderBy: {
        blockNumber: 'asc',
      },
    });

    if (firstMint?.blockNumber) {
      console.log(`⚠️ Using first mint block as deployment block: ${firstMint.blockNumber}`);
      return firstMint.blockNumber;
    }

    // Fallback: Try to get from NFTTransfer table
    const firstTransfer = await prisma.nFTTransfer.findFirst({
      where: {
        nft: {
          contractAddress: contractAddress.toLowerCase(),
          chainId,
        },
        transferType: 'MINT',
      },
      select: {
        blockNumber: true,
      },
      orderBy: {
        blockNumber: 'asc',
      },
    });

    if (firstTransfer?.blockNumber) {
      console.log(`⚠️ Using first transfer block as deployment block: ${firstTransfer.blockNumber}`);
      return firstTransfer.blockNumber;
    }

    throw new Error(`Cannot determine deployment block for ${contractAddress}. No activity, mint, or transfer records found.`);
  }

  /**
   * Query Transfer events from blockchain
   */
  private async queryTransferEvents(
    contractAddress: string,
    fromBlock: number,
    toBlock: number
  ): Promise<ethers.Log[]> {
    const filter = {
      address: contractAddress,
      topics: [TRANSFER_TOPIC],
      fromBlock,
      toBlock,
    };

    let retries = 0;
    while (retries < MAX_RETRIES) {
      try {
        const logs = await this.provider.getLogs(filter);
        return logs;
      } catch (error) {
        retries++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        
        if (errorMsg.includes('rate') || errorMsg.includes('429')) {
          const backoffMs = BATCH_DELAY_MS * Math.pow(2, retries);
          console.log(`   ⚠️  Rate limited, waiting ${backoffMs}ms before retry ${retries}/${MAX_RETRIES}...`);
          await this.sleep(backoffMs);
        } else {
          throw error;
        }
      }
    }

    throw new Error(`Failed to query events after ${MAX_RETRIES} retries`);
  }

  /**
   * Check if event already processed
   * Check by contractAddress + tokenId + transferType + txHash
   * This is more accurate than just txHash + logIndex
   */
  private async isEventProcessed(
    contractAddress: string,
    tokenId: string,
    transferType: 'MINT' | 'TRANSFER' | 'BURN',
    txHash: string
  ): Promise<boolean> {
    // Get NFT first
    const nft = await prisma.nFT.findUnique({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress: contractAddress.toLowerCase(),
          tokenId,
          chainId: this.chainId,
        },
      },
      select: { id: true },
    });

    if (!nft) {
      return false; // NFT doesn't exist, so transfer doesn't exist
    }

    // Check if transfer exists
    const existing = await prisma.nFTTransfer.findFirst({
      where: {
        nftId: nft.id,
        transferType,
        txHash: txHash.toLowerCase(),
      },
    });

    return existing !== null;
  }

  /**
   * Categorize transfer event (mint/transfer/burn)
   */
  private categorizeTransferEvent(
    event: ethers.Log
  ): 'mint' | 'transfer' | 'burn' {
    const iface = new ethers.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    ]);

    const parsed = iface.parseLog({
      topics: event.topics as string[],
      data: event.data,
    });

    if (!parsed) {
      throw new Error('Failed to parse Transfer event');
    }

    const from = parsed.args[0].toLowerCase();
    const to = parsed.args[1].toLowerCase();

    if (from === ZERO_ADDRESS) return 'mint';
    if (to === ZERO_ADDRESS) return 'burn';
    return 'transfer';
  }

  /**
   * Process transfer event using on-chain sync (NO ALCHEMY)
   */
  private async processTransferEvent(
    event: ethers.Log,
    eventType: 'mint' | 'transfer' | 'burn',
    chainId: number,
    contractAddress: string,
    logIndex: number
  ): Promise<void> {
    const iface = new ethers.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    ]);

    const parsed = iface.parseLog({
      topics: event.topics as string[],
      data: event.data,
    });

    if (!parsed) {
      throw new Error('Failed to parse Transfer event');
    }

    const from = parsed.args[0];
    const to = parsed.args[1];
    const tokenId = parsed.args[2].toString();

    // Get block timestamp
    const block = await this.provider.getBlock(event.blockNumber);
    if (!block) {
      throw new Error(`Block ${event.blockNumber} not found`);
    }

    const blockTimestamp = new Date(block.timestamp * 1000);

    // Process based on event type
    if (eventType === 'mint') {
      await this.processMintEvent(
        contractAddress,
        tokenId,
        to,
        event.transactionHash,
        event.blockNumber,
        blockTimestamp,
        logIndex
      );
    } else if (eventType === 'transfer') {
      await this.processTransferOnly(
        contractAddress,
        tokenId,
        from,
        to,
        event.transactionHash,
        event.blockNumber,
        blockTimestamp,
        logIndex
      );
    } else if (eventType === 'burn') {
      await this.processBurnEvent(
        contractAddress,
        tokenId,
        from,
        event.transactionHash,
        event.blockNumber,
        blockTimestamp,
        logIndex
      );
    }
  }

  /**
   * Process mint event (from = 0x0000...)
   */
  private async processMintEvent(
    contractAddress: string,
    tokenId: string,
    minter: string,
    txHash: string,
    blockNumber: number,
    blockTimestamp: Date,
    logIndex: number
  ): Promise<void> {
    const normalizedAddress = contractAddress.toLowerCase();
    const normalizedMinter = minter.toLowerCase();

    // 1. Sync NFT from on-chain
    const { syncSingleNFT } = await import('../onchain-nft-sync');
    const syncResult = await syncSingleNFT(
      normalizedAddress,
      tokenId,
      this.chainId,
      this.rpcUrl
    );

    if (!syncResult.success) {
      console.error(`   ⚠️  Failed to sync NFT #${tokenId}: ${syncResult.message}`);
      // Continue anyway, we'll create basic record
    }

    // 2. Get or create NFT record
    const nft = await prisma.nFT.findUnique({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress: normalizedAddress,
          tokenId,
          chainId: this.chainId,
        },
      },
    });

    if (!nft) {
      throw new Error(`NFT not found after sync: ${normalizedAddress} #${tokenId}`);
    }

    // 3. Create NFT ownership
    await prisma.nFTOwnership.create({
      data: {
        nftId: nft.id,
        ownerAddress: normalizedMinter,
        balance: '1',
        acquiredAt: blockTimestamp,
        acquiredBlock: blockNumber,
        acquiredTxHash: txHash.toLowerCase(),
        isCurrent: true,
      },
    });

    // 4. Create NFT transfer record
    await prisma.nFTTransfer.create({
      data: {
        chainId: this.chainId,
        nftId: nft.id,
        fromAddress: ZERO_ADDRESS,
        toAddress: normalizedMinter,
        quantity: '1',
        txHash: txHash.toLowerCase(),
        blockNumber,
        blockTimestamp,
        logIndex,
        transferType: 'MINT',
      },
    });

    // 5. Update launchpad stats (only if updateStats is enabled)
    if (this.updateStats) {
      const launchpad = await prisma.launchpad.findFirst({
        where: {
          contractAddress: normalizedAddress,
          chainId: this.chainId,
        },
      });

      if (launchpad) {
        // Get mint price from mints table or use 0
        const mint = await prisma.mint.findFirst({
          where: {
            launchpadId: launchpad.id,
            tokenId: parseInt(tokenId), // Convert to Int
          },
          select: { price: true },
        });

        const mintPrice = mint?.price || '0';

        // Update launchpad
        await prisma.launchpad.update({
          where: { id: launchpad.id },
          data: {
            mintedCount: { increment: 1 },
            volume: {
              set: (BigInt(launchpad.volume) + BigInt(mintPrice)).toString(),
            },
            lastMintAt: blockTimestamp,
            updatedAt: new Date(),
          },
        });

        // Update or create analytics
        const existingAnalytics = await prisma.launchpadAnalytics.findUnique({
          where: { launchpadId: launchpad.id },
          select: { totalVolume: true, totalMints: true },
        });

        if (existingAnalytics) {
          // Update existing analytics
          const newTotalVolume = (BigInt(existingAnalytics.totalVolume) + BigInt(mintPrice)).toString();
          const newTotalMints = existingAnalytics.totalMints + 1;
          const newAvgMintPrice = (BigInt(newTotalVolume) / BigInt(newTotalMints)).toString();

          await prisma.launchpadAnalytics.update({
            where: { launchpadId: launchpad.id },
            data: {
              totalVolume: newTotalVolume,
              totalMints: newTotalMints,
              avgMintPrice: newAvgMintPrice,
              lastSalePrice: mintPrice,
              calculatedAt: new Date(),
            },
          });
        } else {
          // Create new analytics
          await prisma.launchpadAnalytics.create({
            data: {
              launchpadId: launchpad.id,
              totalVolume: mintPrice,
              totalMints: 1,
              avgMintPrice: mintPrice,
              lastSalePrice: mintPrice,
              calculatedAt: new Date(),
            },
          });
        }
      }
    }

    // 6. Update NFT contract stats (only if updateStats is enabled)
    if (this.updateStats) {
      const existingContract = await prisma.nFTContract.findUnique({
        where: {
          address_chainId: {
            address: normalizedAddress,
            chainId: this.chainId,
          },
        },
        select: { totalSupply: true },
      });

      if (existingContract) {
        const currentSupply = existingContract.totalSupply || '0';
        await prisma.nFTContract.update({
          where: {
            address_chainId: {
              address: normalizedAddress,
              chainId: this.chainId,
            },
          },
          data: {
            totalSupply: (BigInt(currentSupply) + BigInt(1)).toString(),
          },
        });
      } else {
        await prisma.nFTContract.create({
          data: {
            address: normalizedAddress,
            chainId: this.chainId,
            name: nft.name || 'Unknown',
            symbol: 'NFT',
            totalSupply: '1',
            tokenType: 'ERC721',
          },
        });
      }
    }

    // 7. Update collection analytics (only if updateStats is enabled)
    if (this.updateStats) {
      const existingCollectionAnalytics = await prisma.nFTCollectionAnalytics.findUnique({
        where: {
          contractAddress_chainId: {
            contractAddress: normalizedAddress,
            chainId: this.chainId,
          },
        },
        select: { totalSupply: true },
      });

      if (existingCollectionAnalytics) {
        await prisma.nFTCollectionAnalytics.update({
          where: {
            contractAddress_chainId: {
              contractAddress: normalizedAddress,
              chainId: this.chainId,
            },
          },
          data: {
            totalSupply: existingCollectionAnalytics.totalSupply + 1,
            calculatedAt: new Date(),
          },
        });
      } else {
        await prisma.nFTCollectionAnalytics.create({
          data: {
            contractAddress: normalizedAddress,
            chainId: this.chainId,
            totalSupply: 1,
            calculatedAt: new Date(),
          },
        });
      }
    }
  }

  /**
   * Process regular transfer event
   */
  private async processTransferOnly(
    contractAddress: string,
    tokenId: string,
    from: string,
    to: string,
    txHash: string,
    blockNumber: number,
    blockTimestamp: Date,
    logIndex: number
  ): Promise<void> {
    const normalizedAddress = contractAddress.toLowerCase();
    const normalizedFrom = from.toLowerCase();
    const normalizedTo = to.toLowerCase();

    // Get NFT
    const nft = await prisma.nFT.findUnique({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress: normalizedAddress,
          tokenId,
          chainId: this.chainId,
        },
      },
    });

    if (!nft) {
      console.log(`   ⚠️  NFT not found, skipping transfer: ${normalizedAddress} #${tokenId}`);
      return;
    }

    // Mark old ownership as not current
    await prisma.nFTOwnership.updateMany({
      where: {
        nftId: nft.id,
        isCurrent: true,
      },
      data: {
        isCurrent: false,
      },
    });

    // Create new ownership
    await prisma.nFTOwnership.create({
      data: {
        nftId: nft.id,
        ownerAddress: normalizedTo,
        balance: '1',
        acquiredAt: blockTimestamp,
        acquiredBlock: blockNumber,
        acquiredTxHash: txHash.toLowerCase(),
        isCurrent: true,
      },
    });

    // Create transfer record
    await prisma.nFTTransfer.create({
      data: {
        chainId: this.chainId,
        nftId: nft.id,
        fromAddress: normalizedFrom,
        toAddress: normalizedTo,
        quantity: '1',
        txHash: txHash.toLowerCase(),
        blockNumber,
        blockTimestamp,
        logIndex,
        transferType: 'TRANSFER',
      },
    });
  }

  /**
   * Process burn event (to = 0x0000...)
   */
  private async processBurnEvent(
    contractAddress: string,
    tokenId: string,
    from: string,
    txHash: string,
    blockNumber: number,
    blockTimestamp: Date,
    logIndex: number
  ): Promise<void> {
    const normalizedAddress = contractAddress.toLowerCase();
    const normalizedFrom = from.toLowerCase();

    // Get NFT
    const nft = await prisma.nFT.findUnique({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress: normalizedAddress,
          tokenId,
          chainId: this.chainId,
        },
      },
    });

    if (!nft) {
      console.log(`   ⚠️  NFT not found, skipping burn: ${normalizedAddress} #${tokenId}`);
      return;
    }

    // Mark all ownership as not current
    await prisma.nFTOwnership.updateMany({
      where: {
        nftId: nft.id,
        isCurrent: true,
      },
      data: {
        isCurrent: false,
      },
    });

    // Create burn transfer record
    await prisma.nFTTransfer.create({
      data: {
        chainId: this.chainId,
        nftId: nft.id,
        fromAddress: normalizedFrom,
        toAddress: ZERO_ADDRESS,
        quantity: '1',
        txHash: txHash.toLowerCase(),
        blockNumber,
        blockTimestamp,
        logIndex,
        transferType: 'BURN',
      },
    });

    // Update contract stats
    const existingContract = await prisma.nFTContract.findFirst({
      where: {
        address: normalizedAddress,
        chainId: this.chainId,
      },
      select: { totalSupply: true },
    });

    if (existingContract) {
      const currentSupply = existingContract.totalSupply || '0';
      if (BigInt(currentSupply) > 0) {
        await prisma.nFTContract.updateMany({
          where: {
            address: normalizedAddress,
            chainId: this.chainId,
          },
          data: {
            totalSupply: (BigInt(currentSupply) - BigInt(1)).toString(),
          },
        });
      }
    }

    // Update collection analytics
    const existingAnalytics = await prisma.nFTCollectionAnalytics.findFirst({
      where: {
        contractAddress: normalizedAddress,
        chainId: this.chainId,
      },
      select: { totalSupply: true },
    });

    if (existingAnalytics && existingAnalytics.totalSupply > 0) {
      await prisma.nFTCollectionAnalytics.updateMany({
        where: {
          contractAddress: normalizedAddress,
          chainId: this.chainId,
        },
        data: {
          totalSupply: existingAnalytics.totalSupply - 1,
        },
      });
    }

    // Update launchpad stats
    const existingLaunchpad = await prisma.launchpad.findFirst({
      where: {
        contractAddress: normalizedAddress,
        chainId: this.chainId,
      },
      select: { mintedCount: true },
    });

    if (existingLaunchpad && existingLaunchpad.mintedCount > 0) {
      await prisma.launchpad.updateMany({
        where: {
          contractAddress: normalizedAddress,
          chainId: this.chainId,
        },
        data: {
          mintedCount: existingLaunchpad.mintedCount - 1,
        },
      });
    }
  }

  /**
   * Emit progress via WebSocket
   */
  private emitProgress(
    chainId: number,
    contractAddress: string,
    progress: SyncProgress
  ): void {
    if (!this.wsManager) return;

    const progressPercent = Math.round(
      ((progress.currentBlock - progress.fromBlock) / 
       (progress.toBlock - progress.fromBlock)) * 100
    );

    this.wsManager.broadcastToAll('collection-sync:progress', {
      chainId,
      contractAddress,
      progress: progressPercent,
      currentBlock: progress.currentBlock,
      fromBlock: progress.fromBlock,
      toBlock: progress.toBlock,
      eventsProcessed: progress.eventsProcessed,
      mints: progress.mints,
      transfers: progress.transfers,
      burns: progress.burns,
      status: progress.status,
      error: progress.error,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create CollectionSyncService
 */
export function createCollectionSyncService(
  chainId: number,
  rpcUrl: string,
  wsManager: WebSocketManager | null = null,
  updateStats: boolean = false
): CollectionSyncService {
  return new CollectionSyncService(chainId, rpcUrl, wsManager, updateStats);
}
