/**
 * NFT Event Handler Usage Example
 * 
 * This example demonstrates how to set up and use the NFT Event Handler
 * to process NFT transfer events, fetch metadata, and track ownership.
 */

import { NFTEventHandler } from './nft-events';
import { NFTEventListener } from '../nft-event-listener';
import { AlchemyNFTService } from '../../alchemy-nft-service';
import { AlchemySpamDetector } from '../../alchemy-spam-detector';

// ============================================================================
// Example 1: Basic Setup
// ============================================================================

async function setupNFTEventHandler() {
  // 1. Create Alchemy service
  const alchemyService = new AlchemyNFTService({
    apiKey: process.env.ALCHEMY_API_KEY || 'your-api-key',
    network: 'eth-mainnet'
  });

  // 2. Create spam detector
  const spamDetector = new AlchemySpamDetector(alchemyService);

  // 3. Create NFT event handler
  const nftEventHandler = new NFTEventHandler({
    chainId: 1, // Ethereum mainnet
    retryAttempts: 3,
    errorCounters: new Map(),
    errorThreshold: 10,
    sendAdminAlert: async (alertData) => {
      console.log('🚨 Admin Alert:', alertData);
    },
    alchemyService,
    spamDetector
  });

  return nftEventHandler;
}

// ============================================================================
// Example 2: Integrate with NFT Event Listener
// ============================================================================

async function setupCompleteNFTIndexing() {
  // Create handler
  const nftEventHandler = await setupNFTEventHandler();

  // Create listener with handler
  const nftListener = new NFTEventListener({
    chainId: 1,
    rpcUrl: process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-key',
    contracts: [
      {
        address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // BAYC
        tokenType: 'ERC721',
        chainId: 1
      },
      {
        address: '0x60E4d786628Fea6478F785A6d7e704777c86a7c6', // MAYC
        tokenType: 'ERC721',
        chainId: 1
      }
    ],
    nftEventHandler // Pass the handler to the listener
  });

  // Start listening
  await nftListener.start();

  console.log('✅ NFT indexing started');

  return { nftListener, nftEventHandler };
}

// ============================================================================
// Example 3: Manual Event Processing
// ============================================================================

async function processTransferEventManually() {
  const nftEventHandler = await setupNFTEventHandler();

  // Example transfer event data
  const transferEvent = {
    contractAddress: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
    tokenId: '1234',
    from: '0x0000000000000000000000000000000000000000', // Mint
    to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    quantity: '1',
    txHash: '0xabc123...',
    blockNumber: 12345678,
    blockTimestamp: new Date(),
    logIndex: 0,
    tokenType: 'ERC721' as const
  };

  // Process the event
  await nftEventHandler.handleTransferEvent(transferEvent);

  console.log('✅ Transfer event processed');
}

// ============================================================================
// Example 4: Sync Metadata for Existing NFT
// ============================================================================

async function syncExistingNFTMetadata() {
  const nftEventHandler = await setupNFTEventHandler();

  // Sync metadata for a specific NFT
  await nftEventHandler.syncNFTMetadata(
    '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // BAYC contract
    '1234', // Token ID
    'ERC721'
  );

  console.log('✅ NFT metadata synced');
}

// ============================================================================
// Example 5: Sync Contract Metadata
// ============================================================================

async function syncContractMetadata() {
  const nftEventHandler = await setupNFTEventHandler();

  // Sync contract metadata
  await nftEventHandler.syncContractMetadata(
    '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // BAYC contract
    'ERC721'
  );

  console.log('✅ Contract metadata synced');
}

// ============================================================================
// Example 6: Refresh NFT Metadata
// ============================================================================

async function refreshNFTMetadata() {
  const nftEventHandler = await setupNFTEventHandler();

  // Refresh metadata for an NFT (triggers Alchemy refresh)
  await nftEventHandler.refreshNFTMetadata(
    '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
    '1234'
  );

  console.log('✅ NFT metadata refreshed');
}

// ============================================================================
// Example 7: Update OpenSea Metadata
// ============================================================================

async function updateOpenSeaMetadata() {
  const nftEventHandler = await setupNFTEventHandler();

  // Update OpenSea-specific metadata
  await nftEventHandler.updateOpenSeaMetadata(
    '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'
  );

  console.log('✅ OpenSea metadata updated');
}

// ============================================================================
// Example 8: Multi-Chain Setup
// ============================================================================

async function setupMultiChainIndexing() {
  const chains = [
    { chainId: 1, network: 'eth-mainnet', name: 'Ethereum' },
    { chainId: 137, network: 'polygon-mainnet', name: 'Polygon' },
    { chainId: 8453, network: 'base-mainnet', name: 'Base' }
  ];

  const handlers = [];

  for (const chain of chains) {
    // Create Alchemy service for each chain
    const alchemyService = new AlchemyNFTService({
      apiKey: process.env.ALCHEMY_API_KEY || 'your-api-key',
      network: chain.network
    });

    const spamDetector = new AlchemySpamDetector(alchemyService);

    // Create handler for each chain
    const handler = new NFTEventHandler({
      chainId: chain.chainId,
      retryAttempts: 3,
      errorCounters: new Map(),
      errorThreshold: 10,
      sendAdminAlert: async (alertData) => {
        console.log(`🚨 [${chain.name}] Admin Alert:`, alertData);
      },
      alchemyService,
      spamDetector
    });

    handlers.push({ chain, handler });
  }

  console.log(`✅ Multi-chain indexing setup for ${chains.length} chains`);

  return handlers;
}

// ============================================================================
// Example 9: Error Handling
// ============================================================================

async function handleEventsWithErrorRecovery() {
  const nftEventHandler = await setupNFTEventHandler();

  const transferEvent = {
    contractAddress: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
    tokenId: '1234',
    from: '0x0000000000000000000000000000000000000000',
    to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    quantity: '1',
    txHash: '0xabc123...',
    blockNumber: 12345678,
    blockTimestamp: new Date(),
    logIndex: 0,
    tokenType: 'ERC721' as const
  };

  try {
    await nftEventHandler.handleTransferEvent(transferEvent);
    console.log('✅ Event processed successfully');
  } catch (error) {
    console.error('❌ Error processing event:', error);
    
    // Implement retry logic or alert
    console.log('🔄 Retrying...');
    
    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      await nftEventHandler.handleTransferEvent(transferEvent);
      console.log('✅ Event processed on retry');
    } catch (retryError) {
      console.error('❌ Failed after retry:', retryError);
      // Send alert to admin
    }
  }
}

// ============================================================================
// Example 10: Batch Processing
// ============================================================================

async function batchProcessTransfers() {
  const nftEventHandler = await setupNFTEventHandler();

  const transfers = [
    {
      contractAddress: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
      tokenId: '1',
      from: '0x0000000000000000000000000000000000000000',
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      quantity: '1',
      txHash: '0xabc1',
      blockNumber: 12345678,
      blockTimestamp: new Date(),
      logIndex: 0,
      tokenType: 'ERC721' as const
    },
    {
      contractAddress: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
      tokenId: '2',
      from: '0x0000000000000000000000000000000000000000',
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      quantity: '1',
      txHash: '0xabc2',
      blockNumber: 12345679,
      blockTimestamp: new Date(),
      logIndex: 0,
      tokenType: 'ERC721' as const
    }
  ];

  // Process in parallel with concurrency limit
  const concurrencyLimit = 5;
  for (let i = 0; i < transfers.length; i += concurrencyLimit) {
    const batch = transfers.slice(i, i + concurrencyLimit);
    await Promise.all(
      batch.map(transfer => nftEventHandler.handleTransferEvent(transfer))
    );
    console.log(`✅ Processed batch ${i / concurrencyLimit + 1}`);
  }

  console.log('✅ All transfers processed');
}

// ============================================================================
// Export Examples
// ============================================================================

export {
  setupNFTEventHandler,
  setupCompleteNFTIndexing,
  processTransferEventManually,
  syncExistingNFTMetadata,
  syncContractMetadata,
  refreshNFTMetadata,
  updateOpenSeaMetadata,
  setupMultiChainIndexing,
  handleEventsWithErrorRecovery,
  batchProcessTransfers
};

// ============================================================================
// Main Example Runner
// ============================================================================

async function main() {
  console.log('🚀 NFT Event Handler Examples\n');

  // Uncomment the example you want to run:
  
  // await setupCompleteNFTIndexing();
  // await processTransferEventManually();
  // await syncExistingNFTMetadata();
  // await syncContractMetadata();
  // await refreshNFTMetadata();
  // await updateOpenSeaMetadata();
  // await setupMultiChainIndexing();
  // await handleEventsWithErrorRecovery();
  // await batchProcessTransfers();
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

