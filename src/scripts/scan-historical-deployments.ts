/**
 * Script to scan historical ContractDeployed events
 * 
 * Usage:
 * npm run scan-history -- --chain 6343 --from 4289153
 * npm run scan-history -- --chain 6343 --from 4289153 --to 4289200
 */

import 'dotenv/config';
import { getMultiChainListenerManager } from '../lib/blockchain/multi-chain-listener-manager';
import { prisma } from '../config/database';

async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const chainIdArg = args.find(arg => arg.startsWith('--chain='));
    const fromBlockArg = args.find(arg => arg.startsWith('--from='));
    const toBlockArg = args.find(arg => arg.startsWith('--to='));

    if (!chainIdArg || !fromBlockArg) {
      console.error('❌ Missing required arguments');
      console.log('Usage: npm run scan-history -- --chain=6343 --from=4289153 [--to=4289200]');
      process.exit(1);
    }

    const chainId = parseInt(chainIdArg.split('=')[1]);
    const fromBlock = parseInt(fromBlockArg.split('=')[1]);
    const toBlock = toBlockArg ? parseInt(toBlockArg.split('=')[1]) : undefined;

    console.log(`🔍 Scanning historical deployments for chain ${chainId}`);
    console.log(`   From block: ${fromBlock}`);
    console.log(`   To block: ${toBlock || 'latest'}`);

    // Initialize listener manager
    const manager = getMultiChainListenerManager();
    
    // Check if chain exists in database
    const chain = await prisma.chain.findUnique({
      where: { chainId },
      include: {
        factories: {
          where: { isActive: true }
        }
      }
    });

    if (!chain) {
      console.error(`❌ Chain ${chainId} not found in database`);
      process.exit(1);
    }

    if (chain.factories.length === 0) {
      console.error(`❌ No active factory found for chain ${chainId}`);
      process.exit(1);
    }

    console.log(`✅ Found chain: ${chain.name}`);
    console.log(`✅ Factory: ${chain.factories[0].contractAddress}`);

    // Get chain config
    const { getChainConfig } = await import('../config/chains');
    const chainConfig = getChainConfig(chainId);
    
    if (!chainConfig) {
      console.error(`❌ Chain config not found for chainId ${chainId}`);
      process.exit(1);
    }

    // Create a temporary listener just for scanning
    const { ActivityListener } = await import('../lib/blockchain/activity-listener');
    const listener = new ActivityListener({
      chainId,
      rpcUrl: chainConfig.rpcUrl,
      factoryAddress: chain.factories[0].contractAddress,
      launchpadAddresses: [],
      enabledEvents: ['ContractDeployed'] // Only need this event for scanning
    });

    console.log('🔍 Starting historical scan...');

    // Get current block if toBlock not specified
    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const currentBlock = toBlock || await provider.getBlockNumber();
    
    // Calculate total blocks to scan
    const totalBlocks = currentBlock - fromBlock;
    console.log(`📊 Total blocks to scan: ${totalBlocks}`);

    // For MegaETH free tier, we need to chunk into 10 block ranges (inclusive)
    // Range [0x417281, 0x41728a] = 10 blocks (0-9)
    const CHUNK_SIZE = 9; // 0-9 = 10 blocks inclusive
    
    if (totalBlocks > CHUNK_SIZE) {
      console.log(`⚠️ Large range detected, will scan in chunks of ${CHUNK_SIZE + 1} blocks`);
      
      let processedEvents = 0;
      for (let start = fromBlock; start <= currentBlock; start += (CHUNK_SIZE + 1)) {
        const end = Math.min(start + CHUNK_SIZE, currentBlock);
        
        try {
          console.log(`📡 Scanning blocks ${start} to ${end}...`);
          await listener.scanHistoricalDeployments(start, end);
          processedEvents++;
          
          // Small delay to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`❌ Error scanning blocks ${start}-${end}:`, error instanceof Error ? error.message : error);
          // Continue with next chunk
        }
      }
      
      console.log(`✅ Scanned ${processedEvents} chunks`);
    } else {
      // Small range, scan directly
      await listener.scanHistoricalDeployments(fromBlock, currentBlock);
    }

    console.log('✅ Historical scan complete');

  } catch (error) {
    console.error('❌ Error scanning historical deployments:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
