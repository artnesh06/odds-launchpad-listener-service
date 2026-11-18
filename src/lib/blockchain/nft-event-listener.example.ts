/**
 * NFT Event Listener Usage Example
 * 
 * This file demonstrates how to use the NFT Event Listener
 * to monitor ERC721 and ERC1155 events from NFT contracts.
 */

import { NFTEventListener, NFTEventListenerConfig, NFTContractConfig } from './nft-event-listener';

/**
 * Example 1: Basic Setup
 * Monitor a single ERC721 contract
 */
async function example1_BasicSetup() {
  const contracts: NFTContractConfig[] = [
    {
      address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // BAYC
      tokenType: 'ERC721',
      chainId: 1
    }
  ];

  const config: NFTEventListenerConfig = {
    chainId: 1,
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
    contracts
  };

  const listener = new NFTEventListener(config);
  
  try {
    await listener.start();
    console.log('✅ Listening to BAYC transfers...');
    
    // Keep running...
    // await new Promise(() => {}); // Run forever
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * Example 2: Multiple Contracts
 * Monitor both ERC721 and ERC1155 contracts
 */
async function example2_MultipleContracts() {
  const contracts: NFTContractConfig[] = [
    {
      address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', // BAYC (ERC721)
      tokenType: 'ERC721',
      chainId: 1
    },
    {
      address: '0x60E4d786628Fea6478F785A6d7e704777c86a7c6', // MAYC (ERC721)
      tokenType: 'ERC721',
      chainId: 1
    },
    {
      address: '0x495f947276749Ce646f68AC8c248420045cb7b5e', // OpenSea Shared (ERC1155)
      tokenType: 'ERC1155',
      chainId: 1
    }
  ];

  const config: NFTEventListenerConfig = {
    chainId: 1,
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
    contracts,
    errorThreshold: 10,
    retryAttempts: 3
  };

  const listener = new NFTEventListener(config);
  
  try {
    await listener.start();
    console.log('✅ Listening to multiple NFT contracts...');
    
    // Check status
    const status = listener.getStatus();
    console.log('Status:', status);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * Example 3: Dynamic Contract Management
 * Add and remove contracts at runtime
 */
async function example3_DynamicManagement() {
  const config: NFTEventListenerConfig = {
    chainId: 1,
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
    contracts: [] // Start with no contracts
  };

  const listener = new NFTEventListener(config);
  
  try {
    await listener.start();
    console.log('✅ Listener started with no contracts');
    
    // Add a contract dynamically
    await listener.addContract({
      address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
      tokenType: 'ERC721',
      chainId: 1
    });
    console.log('✅ Added BAYC contract');
    
    // Add another contract
    await listener.addContract({
      address: '0x60E4d786628Fea6478F785A6d7e704777c86a7c6',
      tokenType: 'ERC721',
      chainId: 1
    });
    console.log('✅ Added MAYC contract');
    
    // Check status
    let status = listener.getStatus();
    console.log('Contracts:', status.contractCount); // 2
    
    // Remove a contract
    await listener.removeContract('0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D');
    console.log('✅ Removed BAYC contract');
    
    status = listener.getStatus();
    console.log('Contracts:', status.contractCount); // 1
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * Example 4: Multi-Chain Setup
 * Monitor NFTs across multiple chains
 */
async function example4_MultiChain() {
  // Ethereum Mainnet
  const ethListener = new NFTEventListener({
    chainId: 1,
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
    contracts: [
      {
        address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
        tokenType: 'ERC721',
        chainId: 1
      }
    ]
  });

  // Polygon
  const polygonListener = new NFTEventListener({
    chainId: 137,
    rpcUrl: 'https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
    contracts: [
      {
        address: '0x2953399124F0cBB46d2CbACD8A89cF0599974963',
        tokenType: 'ERC721',
        chainId: 137
      }
    ]
  });

  try {
    await ethListener.start();
    console.log('✅ Ethereum listener started');
    
    await polygonListener.start();
    console.log('✅ Polygon listener started');
    
    // Monitor both chains...
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * Example 5: WebSocket Provider
 * Use WebSocket for real-time events
 */
async function example5_WebSocket() {
  const config: NFTEventListenerConfig = {
    chainId: 1,
    rpcUrl: 'wss://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY', // WebSocket URL
    contracts: [
      {
        address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
        tokenType: 'ERC721',
        chainId: 1
      }
    ]
  };

  const listener = new NFTEventListener(config);
  
  try {
    await listener.start();
    console.log('✅ WebSocket listener started for real-time events');
    
    // Events will be received in real-time via WebSocket
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

/**
 * Example 6: Graceful Shutdown
 * Properly stop the listener
 */
async function example6_GracefulShutdown() {
  const config: NFTEventListenerConfig = {
    chainId: 1,
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY',
    contracts: [
      {
        address: '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D',
        tokenType: 'ERC721',
        chainId: 1
      }
    ]
  };

  const listener = new NFTEventListener(config);
  
  try {
    await listener.start();
    console.log('✅ Listener started');
    
    // Run for some time...
    await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute
    
    // Gracefully stop
    await listener.stop();
    console.log('✅ Listener stopped gracefully');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Export examples
export {
  example1_BasicSetup,
  example2_MultipleContracts,
  example3_DynamicManagement,
  example4_MultiChain,
  example5_WebSocket,
  example6_GracefulShutdown
};
