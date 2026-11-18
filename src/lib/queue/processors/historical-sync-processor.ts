import { Job } from 'bull';
import { HistoricalSyncJob } from '../queue-config';
import { getMultiChainListenerManager } from '../../blockchain/multi-chain-listener-manager';

/**
 * Historical Sync Processor
 * Processes historical blockchain data sync jobs
 */
export class HistoricalSyncProcessor {
  /**
   * Process historical sync job
   */
  async process(job: Job<HistoricalSyncJob>): Promise<void> {
    const { chainId, contractAddress, startBlock, endBlock, syncType } = job.data;

    console.log(
      `🔄 Starting historical sync: Chain ${chainId}, ${syncType}, blocks ${startBlock}-${endBlock}`
    );

    try {
      await job.progress(10);

      const manager = getMultiChainListenerManager();
      const listener = manager.getListener(chainId);

      if (!listener) {
        throw new Error(`Listener not found for chain ${chainId}`);
      }

      await job.progress(20);

      // Calculate total blocks
      const totalBlocks = endBlock - startBlock;
      const chunkSize = 1000; // Process 1000 blocks at a time
      let processedBlocks = 0;

      // Process in chunks
      for (let currentBlock = startBlock; currentBlock <= endBlock; currentBlock += chunkSize) {
        const chunkEnd = Math.min(currentBlock + chunkSize - 1, endBlock);

        console.log(`📊 Syncing blocks ${currentBlock}-${chunkEnd}`);

        // Scan historical events
        await listener.scanHistoricalDeployments(currentBlock, chunkEnd);

        processedBlocks += chunkEnd - currentBlock + 1;
        const progress = Math.min(20 + (processedBlocks / totalBlocks) * 70, 90);
        await job.progress(progress);

        // Small delay to prevent overwhelming the RPC
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      await job.progress(100);

      console.log(
        `✅ Historical sync completed: ${totalBlocks} blocks processed for chain ${chainId}`
      );
    } catch (error) {
      console.error(`❌ Error in historical sync:`, error);
      throw error;
    }
  }
}
