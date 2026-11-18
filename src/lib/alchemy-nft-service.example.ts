/**
 * Alchemy NFT Service - Usage Examples
 * 
 * This file demonstrates how to use the Alchemy NFT Service
 * for various NFT-related operations
 */

import { createAlchemyNFTService } from './alchemy-nft-service';

// ============================================================================
// Initialize Service
// ============================================================================

const alchemyService = createAlchemyNFTService({
  apiKey: process.env.ALCHEMY_API_KEY || '',
  network: 'eth-mainnet', // or 'polygon-mainnet', 'base-mainnet', etc.
});

// ============================================================================
// OWNERSHIP EXAMPLES
// ============================================================================

/**
 * Example 1: Get all NFTs owned by a wallet
 */
export async function exampleGetNFTsForOwner() {
  const walletAddress = '0x...';
  
  const result = await alchemyService.getNFTsForOwner(walletAddress, {
    pageSize: 100,
    withMetadata: true,
    excludeFilters: ['SPAM'],
  });

  console.log(`Total NFTs: ${result.totalCount}`);
  console.log(`NFTs:`, result.ownedNfts);
  
  // Handle pagination
  if (result.pageKey) {
    const nextPage = await alchemyService.getNFTsForOwner(walletAddress, {
      pageKey: result.pageKey,
    });
    console.log('Next page:', nextPage);
  }
}

/**
 * Example 2: Check if wallet owns NFT from specific collection
 */
export async function exampleIsHolderOfContract() {
  const walletAddress = '0x...';
  const contractAddress = '0x...';
  
  const result = await alchemyService.isHolderOfContract(
    walletAddress,
    contractAddress
  );

  console.log(`Is holder: ${result.isHolderOfContract}`);
}

/**
 * Example 3: Get all owners of a specific NFT
 */
export async function exampleGetOwnersForNFT() {
  const contractAddress = '0x...';
  const tokenId = '1';
  
  const result = await alchemyService.getOwnersForNFT(
    contractAddress,
    tokenId
  );

  console.log('Owners:', result.owners);
}

/**
 * Example 4: Get all owners of a contract
 */
export async function exampleGetOwnersForContract() {
  const contractAddress = '0x...';
  
  const result = await alchemyService.getOwnersForContract(contractAddress, {
    withTokenBalances: true,
  });

  console.log('Total owners:', result.owners.length);
  result.owners.forEach(owner => {
    console.log(`Owner: ${owner.ownerAddress}`);
    console.log(`Tokens owned:`, owner.tokenBalances);
  });
}

/**
 * Example 5: Get all NFT contracts owned by wallet
 */
export async function exampleGetContractsForOwner() {
  const walletAddress = '0x...';
  
  const result = await alchemyService.getContractsForOwner(walletAddress, {
    excludeFilters: ['SPAM'],
    pageSize: 100,
  });

  console.log(`Total contracts: ${result.totalCount}`);
  result.contracts.forEach(contract => {
    console.log(`Contract: ${contract.address}`);
    console.log(`Balance: ${contract.totalBalance}`);
    console.log(`Distinct tokens: ${contract.numDistinctTokensOwned}`);
  });
}

// ============================================================================
// METADATA EXAMPLES
// ============================================================================

/**
 * Example 6: Get metadata for a specific NFT
 */
export async function exampleGetNFTMetadata() {
  const contractAddress = '0x...';
  const tokenId = '1';
  
  const metadata = await alchemyService.getNFTMetadata(
    contractAddress,
    tokenId,
    {
      refreshCache: false,
    }
  );

  console.log('NFT Name:', metadata.name);
  console.log('Description:', metadata.description);
  console.log('Image URL:', metadata.image?.cachedUrl);
  console.log('Token Type:', metadata.tokenType);
}

/**
 * Example 7: Get metadata for multiple NFTs at once
 */
export async function exampleGetNFTMetadataBatch() {
  const tokens = [
    { contractAddress: '0x...', tokenId: '1' },
    { contractAddress: '0x...', tokenId: '2' },
    { contractAddress: '0x...', tokenId: '3' },
  ];
  
  const result = await alchemyService.getNFTMetadataBatch(tokens);

  result.nfts.forEach(nft => {
    console.log(`Token ${nft.tokenId}:`, nft.name);
  });
}

/**
 * Example 8: Get all NFTs in a collection
 */
export async function exampleGetNFTsForContract() {
  const contractAddress = '0x...';
  
  const result = await alchemyService.getNFTsForContract(contractAddress, {
    withMetadata: true,
    pageSize: 100,
  });

  console.log('NFTs in collection:', result.nfts.length);
  
  // Paginate through all NFTs
  let allNFTs = [...result.nfts];
  let pageKey = result.pageKey;
  
  while (pageKey) {
    const nextPage = await alchemyService.getNFTsForContract(contractAddress, {
      pageKey,
    });
    allNFTs = [...allNFTs, ...nextPage.nfts];
    pageKey = nextPage.pageKey;
  }
  
  console.log('Total NFTs:', allNFTs.length);
}

/**
 * Example 9: Get contract metadata
 */
export async function exampleGetContractMetadata() {
  const contractAddress = '0x...';
  
  const metadata = await alchemyService.getContractMetadata(contractAddress);

  console.log('Collection Name:', metadata.name);
  console.log('Symbol:', metadata.symbol);
  console.log('Total Supply:', metadata.totalSupply);
  console.log('Token Type:', metadata.tokenType);
  
  if (metadata.openSeaMetadata) {
    console.log('Floor Price:', metadata.openSeaMetadata.floorPrice);
    console.log('OpenSea Slug:', metadata.openSeaMetadata.collectionSlug);
  }
}

/**
 * Example 10: Get contract metadata for multiple contracts
 */
export async function exampleGetContractMetadataBatch() {
  const contractAddresses = [
    '0x...',
    '0x...',
    '0x...',
  ];
  
  const result = await alchemyService.getContractMetadataBatch(contractAddresses);

  result.contracts.forEach(contract => {
    console.log(`${contract.name} (${contract.symbol})`);
    console.log(`Total Supply: ${contract.totalSupply}`);
  });
}

/**
 * Example 11: Compute NFT rarity
 */
export async function exampleComputeRarity() {
  const contractAddress = '0x...';
  const tokenId = '1';
  
  const rarity = await alchemyService.computeRarity(contractAddress, tokenId);

  console.log('Rarity Rank:', rarity.rank);
  console.log('Rarity Score:', rarity.rarityScore);
  console.log('Max Rank:', rarity.maxRank);
  console.log('Prevalence:', rarity.prevalence);
}

/**
 * Example 12: Get attribute summary for collection
 */
export async function exampleSummarizeNFTAttributes() {
  const contractAddress = '0x...';
  
  const summary = await alchemyService.summarizeNFTAttributes(contractAddress);

  console.log('Total Supply:', summary.totalSupply);
  console.log('Attributes:', summary.summary);
  
  // Example: Show rarity of each trait
  Object.entries(summary.summary).forEach(([trait, values]) => {
    console.log(`\nTrait: ${trait}`);
    values.forEach(value => {
      console.log(`  ${value.value}: ${value.count} (${(value.prevalence * 100).toFixed(2)}%)`);
    });
  });
}

/**
 * Example 13: Refresh NFT metadata after reveal
 */
export async function exampleRefreshMetadata() {
  const contractAddress = '0x...';
  const tokenId = '1';
  
  // Refresh single NFT
  const result = await alchemyService.refreshNFTMetadata(
    contractAddress,
    tokenId
  );
  console.log('Refresh result:', result.message);
  
  // Or refresh entire collection
  const collectionResult = await alchemyService.invalidateContract(contractAddress);
  console.log('Collection refresh:', collectionResult.message);
}

/**
 * Example 14: Search for NFT collections
 */
export async function exampleSearchContractMetadata() {
  const query = 'Bored Ape';
  
  const result = await alchemyService.searchContractMetadata(query);

  result.contracts.forEach(contract => {
    console.log(`${contract.name} - ${contract.address}`);
  });
}

// ============================================================================
// SPAM DETECTION EXAMPLES
// ============================================================================

/**
 * Example 15: Check if contract is spam
 */
export async function exampleIsSpamContract() {
  const contractAddress = '0x...';
  
  const result = await alchemyService.isSpamContract(contractAddress);

  if (result.isSpamContract) {
    console.log('⚠️ This contract is marked as spam');
  } else {
    console.log('✅ This contract is not spam');
  }
}

/**
 * Example 16: Check if NFT is an airdrop
 */
export async function exampleIsAirdropNFT() {
  const contractAddress = '0x...';
  const tokenId = '1';
  
  const result = await alchemyService.isAirdropNFT(contractAddress, tokenId);

  if (result.isAirdrop) {
    console.log('🎁 This NFT is an airdrop');
  }
}

/**
 * Example 17: Get all spam contracts
 */
export async function exampleGetSpamContracts() {
  const result = await alchemyService.getSpamContracts();

  console.log(`Total spam contracts: ${result.spamContracts.length}`);
  console.log('Spam contracts:', result.spamContracts.slice(0, 10));
}

/**
 * Example 18: Report spam contract
 */
export async function exampleReportSpam() {
  const contractAddress = '0x...';
  
  const result = await alchemyService.reportSpam(contractAddress);
  console.log('Report result:', result.message);
}

// ============================================================================
// SALES & PRICING EXAMPLES
// ============================================================================

/**
 * Example 19: Get floor price for collection
 */
export async function exampleGetFloorPrice() {
  const contractAddress = '0x...';
  
  const floorPrice = await alchemyService.getFloorPrice(contractAddress);

  if (floorPrice.openSea) {
    console.log('OpenSea Floor Price:', floorPrice.openSea.floorPrice);
    console.log('Currency:', floorPrice.openSea.priceCurrency);
    console.log('Collection URL:', floorPrice.openSea.collectionUrl);
  }
  
  if (floorPrice.looksRare) {
    console.log('LooksRare Floor Price:', floorPrice.looksRare.floorPrice);
  }
}

/**
 * Example 20: Get NFT sales history
 */
export async function exampleGetNFTSales() {
  const contractAddress = '0x...';
  
  // Get recent sales for a collection
  const result = await alchemyService.getNFTSales({
    contractAddress,
    order: 'desc',
    limit: 100,
  });

  console.log(`Total sales: ${result.nftSales.length}`);
  
  result.nftSales.forEach(sale => {
    console.log(`\nSale on ${sale.marketplace}`);
    console.log(`Token ID: ${sale.tokenId}`);
    console.log(`Buyer: ${sale.buyerAddress}`);
    console.log(`Seller: ${sale.sellerAddress}`);
    console.log(`Price: ${sale.sellerFee.amount} ${sale.sellerFee.symbol}`);
    console.log(`Transaction: ${sale.transactionHash}`);
  });
}

/**
 * Example 21: Get sales for specific token
 */
export async function exampleGetTokenSales() {
  const contractAddress = '0x...';
  const tokenId = '1';
  
  const result = await alchemyService.getNFTSales({
    contractAddress,
    tokenId,
    order: 'desc',
  });

  console.log(`Sales history for token ${tokenId}:`, result.nftSales);
}

/**
 * Example 22: Get sales by wallet
 */
export async function exampleGetWalletSales() {
  const walletAddress = '0x...';
  
  // Get sales where wallet was buyer
  const purchases = await alchemyService.getNFTSales({
    buyerAddress: walletAddress,
    limit: 50,
  });
  
  console.log('Purchases:', purchases.nftSales.length);
  
  // Get sales where wallet was seller
  const sales = await alchemyService.getNFTSales({
    sellerAddress: walletAddress,
    limit: 50,
  });
  
  console.log('Sales:', sales.nftSales.length);
}

// ============================================================================
// ADVANCED EXAMPLES
// ============================================================================

/**
 * Example 23: Build NFT portfolio dashboard
 */
export async function exampleBuildPortfolio() {
  const walletAddress = '0x...';
  
  // Get all NFT contracts owned
  const contracts = await alchemyService.getContractsForOwner(walletAddress, {
    excludeFilters: ['SPAM'],
  });
  
  // Get floor prices for each collection
  const portfolio = await Promise.all(
    contracts.contracts.map(async (contract) => {
      try {
        const floorPrice = await alchemyService.getFloorPrice(contract.address);
        const metadata = await alchemyService.getContractMetadata(contract.address);
        
        return {
          address: contract.address,
          name: metadata.name,
          balance: contract.totalBalance,
          floorPrice: floorPrice.openSea?.floorPrice || 0,
          estimatedValue: (floorPrice.openSea?.floorPrice || 0) * parseInt(contract.totalBalance),
        };
      } catch (error) {
        return null;
      }
    })
  );
  
  const validPortfolio = portfolio.filter(Boolean);
  const totalValue = validPortfolio.reduce((sum, item) => sum + (item?.estimatedValue || 0), 0);
  
  console.log('Portfolio Summary:');
  console.log(`Total Collections: ${validPortfolio.length}`);
  console.log(`Estimated Total Value: ${totalValue} ETH`);
  console.log('\nCollections:', validPortfolio);
}

/**
 * Example 24: Multi-chain NFT lookup
 */
export async function exampleMultiChainLookup() {
  const walletAddress = '0x...';
  const chains = ['eth-mainnet', 'polygon-mainnet', 'base-mainnet'];
  
  const results = await Promise.all(
    chains.map(async (network) => {
      const service = createAlchemyNFTService({
        apiKey: process.env.ALCHEMY_API_KEY || '',
        network,
      });
      
      const nfts = await service.getNFTsForOwner(walletAddress, {
        excludeFilters: ['SPAM'],
      });
      
      return {
        network,
        count: nfts.totalCount,
        nfts: nfts.ownedNfts,
      };
    })
  );
  
  console.log('Multi-chain NFT holdings:');
  results.forEach(result => {
    console.log(`${result.network}: ${result.count} NFTs`);
  });
}

/**
 * Example 25: Track collection activity
 */
export async function exampleTrackCollectionActivity() {
  const contractAddress = '0x...';
  
  // Get recent sales
  const sales = await alchemyService.getNFTSales({
    contractAddress,
    order: 'desc',
    limit: 100,
  });
  
  // Calculate statistics
  const totalVolume = sales.nftSales.reduce((sum, sale) => {
    return sum + parseFloat(sale.sellerFee.amount);
  }, 0);
  
  const avgPrice = totalVolume / sales.nftSales.length;
  
  // Get floor price
  const floorPrice = await alchemyService.getFloorPrice(contractAddress);
  
  // Get total owners
  const owners = await alchemyService.getOwnersForContract(contractAddress);
  
  console.log('Collection Activity:');
  console.log(`Recent Sales: ${sales.nftSales.length}`);
  console.log(`Total Volume: ${totalVolume} ETH`);
  console.log(`Average Price: ${avgPrice} ETH`);
  console.log(`Floor Price: ${floorPrice.openSea?.floorPrice} ETH`);
  console.log(`Total Owners: ${owners.owners.length}`);
}

// ============================================================================
// Export all examples
// ============================================================================

export const examples = {
  // Ownership
  exampleGetNFTsForOwner,
  exampleIsHolderOfContract,
  exampleGetOwnersForNFT,
  exampleGetOwnersForContract,
  exampleGetContractsForOwner,
  
  // Metadata
  exampleGetNFTMetadata,
  exampleGetNFTMetadataBatch,
  exampleGetNFTsForContract,
  exampleGetContractMetadata,
  exampleGetContractMetadataBatch,
  exampleComputeRarity,
  exampleSummarizeNFTAttributes,
  exampleRefreshMetadata,
  exampleSearchContractMetadata,
  
  // Spam Detection
  exampleIsSpamContract,
  exampleIsAirdropNFT,
  exampleGetSpamContracts,
  exampleReportSpam,
  
  // Sales & Pricing
  exampleGetFloorPrice,
  exampleGetNFTSales,
  exampleGetTokenSales,
  exampleGetWalletSales,
  
  // Advanced
  exampleBuildPortfolio,
  exampleMultiChainLookup,
  exampleTrackCollectionActivity,
};
