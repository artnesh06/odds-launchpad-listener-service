/**
 * Alchemy NFT API Service
 * 
 * Comprehensive service for interacting with Alchemy's NFT API endpoints
 * Includes: Ownership, Metadata, Spam Detection, and Sales endpoints
 * 
 * @see https://docs.alchemy.com/reference/nft-api-endpoints
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface AlchemyConfig {
  apiKey: string;
  network?: string; // e.g., 'eth-mainnet', 'polygon-mainnet', 'base-mainnet'
  baseUrl?: string;
}

export interface NFTMetadata {
  contract: {
    address: string;
    name?: string;
    symbol?: string;
    totalSupply?: string;
    tokenType?: string;
  };
  tokenId: string;
  tokenType?: string;
  name?: string;
  description?: string;
  image?: {
    cachedUrl?: string;
    thumbnailUrl?: string;
    pngUrl?: string;
    contentType?: string;
    size?: number;
    originalUrl?: string;
  };
  raw?: {
    metadata?: any;
    tokenUri?: string;
  };
  tokenUri?: string;
  timeLastUpdated?: string;
  balance?: string;
  acquiredAt?: {
    blockTimestamp?: string;
    blockNumber?: number;
  };
}

export interface NFTOwner {
  ownerAddress: string;
  tokenBalances: Array<{
    tokenId: string;
    balance: string;
  }>;
}

export interface ContractMetadata {
  address: string;
  name?: string;
  symbol?: string;
  totalSupply?: string;
  tokenType?: string;
  contractDeployer?: string;
  deployedBlockNumber?: number;
  openSeaMetadata?: {
    floorPrice?: number;
    collectionName?: string;
    collectionSlug?: string;
    safelistRequestStatus?: string;
    imageUrl?: string;
    description?: string;
    externalUrl?: string;
    twitterUsername?: string;
    discordUrl?: string;
    bannerImageUrl?: string;
    lastIngestedAt?: string;
  };
}

export interface FloorPrice {
  openSea?: {
    floorPrice: number;
    priceCurrency: string;
    collectionUrl: string;
    retrievedAt: string;
  };
  looksRare?: {
    floorPrice: number;
    priceCurrency: string;
    collectionUrl: string;
    retrievedAt: string;
  };
}

export interface NFTSale {
  marketplace: string;
  contractAddress: string;
  tokenId: string;
  quantity: string;
  buyerAddress: string;
  sellerAddress: string;
  taker: string;
  sellerFee: {
    amount: string;
    tokenAddress: string;
    symbol: string;
    decimals: number;
  };
  protocolFee?: {
    amount: string;
    tokenAddress: string;
    symbol: string;
    decimals: number;
  };
  royaltyFee?: {
    amount: string;
    tokenAddress: string;
    symbol: string;
    decimals: number;
  };
  blockNumber: number;
  logIndex: number;
  bundleIndex: number;
  transactionHash: string;
}

export interface RarityData {
  strategyId: string;
  strategyVersion: string;
  rank: number;
  score: number;
  maxRank: number;
  totalSupply: number;
  rarityScore: number;
  prevalence: number;
}

export interface AttributeSummary {
  contractAddress: string;
  totalSupply: number;
  summary: Record<string, Array<{
    value: string;
    count: number;
    prevalence: number;
  }>>;
}

// ============================================================================
// Alchemy NFT Service Class
// ============================================================================

export class AlchemyNFTService {
  private client: AxiosInstance;
  private apiKey: string;
  private network: string;

  constructor(config: AlchemyConfig) {
    this.apiKey = config.apiKey;
    this.network = config.network || 'eth-mainnet';
    
    const baseUrl = config.baseUrl || `https://${this.network}.g.alchemy.com`;
    
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  // ==========================================================================
  // NFT OWNERSHIP ENDPOINTS
  // ==========================================================================

  /**
   * Get NFTs owned by a wallet address
   * @see https://docs.alchemy.com/reference/getnftsforowner-v3
   */
  async getNFTsForOwner(
    owner: string,
    options?: {
      pageKey?: string;
      contractAddresses?: string[];
      excludeFilters?: string[];
      includeFilters?: string[];
      pageSize?: number;
      orderBy?: 'asc' | 'desc';
      withMetadata?: boolean;
      tokenUriTimeoutInMs?: number;
    }
  ): Promise<{
    ownedNfts: NFTMetadata[];
    pageKey?: string;
    totalCount: number;
  }> {
    try {
      const params: any = {
        owner,
        ...options,
      };

      const response = await this.client.get(`/nft/v3/${this.apiKey}/getNFTsForOwner`, {
        params,
      });

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getNFTsForOwner');
    }
  }

  /**
   * Get owners of a specific NFT token
   * @see https://docs.alchemy.com/reference/getownersfornft-v3
   */
  async getOwnersForNFT(
    contractAddress: string,
    tokenId: string
  ): Promise<{
    owners: string[];
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/getOwnersForNFT`,
        {
          params: {
            contractAddress,
            tokenId,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getOwnersForNFT');
    }
  }

  /**
   * Get all owners for a given NFT contract
   * @see https://docs.alchemy.com/reference/getownersforcontract-v3
   */
  async getOwnersForContract(
    contractAddress: string,
    options?: {
      withTokenBalances?: boolean;
      block?: string;
      pageKey?: string;
    }
  ): Promise<{
    owners: NFTOwner[];
    pageKey?: string;
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/getOwnersForContract`,
        {
          params: {
            contractAddress,
            ...options,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getOwnersForContract');
    }
  }

  /**
   * Check if a wallet owns any NFT in a collection
   * @see https://docs.alchemy.com/reference/isholderofcontract-v3
   */
  async isHolderOfContract(
    wallet: string,
    contractAddress: string
  ): Promise<{
    isHolderOfContract: boolean;
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/isHolderOfContract`,
        {
          params: {
            wallet,
            contractAddress,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'isHolderOfContract');
    }
  }

  /**
   * Get list of NFT contracts owned by a wallet
   * @see https://docs.alchemy.com/reference/getcontractsforowner-v3
   */
  async getContractsForOwner(
    owner: string,
    options?: {
      pageKey?: string;
      pageSize?: number;
      excludeFilters?: string[];
      includeFilters?: string[];
      orderBy?: 'asc' | 'desc';
    }
  ): Promise<{
    contracts: Array<{
      address: string;
      totalBalance: string;
      numDistinctTokensOwned: string;
      isSpam: boolean;
      tokenId?: string;
      media?: any;
    }>;
    pageKey?: string;
    totalCount: number;
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/getContractsForOwner`,
        {
          params: {
            owner,
            ...options,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getContractsForOwner');
    }
  }

  /**
   * Get all NFT collections held by an owner address
   * @see https://docs.alchemy.com/reference/getcollectionsforowner-v3
   */
  async getCollectionsForOwner(
    owner: string,
    options?: {
      pageKey?: string;
      pageSize?: number;
      excludeFilters?: string[];
      includeFilters?: string[];
    }
  ): Promise<{
    collections: Array<{
      contractAddress: string;
      name?: string;
      symbol?: string;
      totalSupply?: string;
      tokenType?: string;
      openSeaMetadata?: any;
    }>;
    pageKey?: string;
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/getCollectionsForOwner`,
        {
          params: {
            owner,
            ...options,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getCollectionsForOwner');
    }
  }

  // ==========================================================================
  // NFT METADATA ENDPOINTS
  // ==========================================================================

  /**
   * Get all NFTs for a given contract
   * @see https://docs.alchemy.com/reference/getnftsforcontract-v3
   */
  async getNFTsForContract(
    contractAddress: string,
    options?: {
      pageKey?: string;
      pageSize?: number;
      withMetadata?: boolean;
      tokenUriTimeoutInMs?: number;
    }
  ): Promise<{
    nfts: NFTMetadata[];
    pageKey?: string;
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/getNFTsForContract`,
        {
          params: {
            contractAddress,
            ...options,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getNFTsForContract');
    }
  }

  /**
   * Get metadata for a specific NFT
   * @see https://docs.alchemy.com/reference/getnftmetadata-v3
   */
  async getNFTMetadata(
    contractAddress: string,
    tokenId: string,
    options?: {
      tokenType?: string;
      tokenUriTimeoutInMs?: number;
      refreshCache?: boolean;
    }
  ): Promise<NFTMetadata> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/getNFTMetadata`,
        {
          params: {
            contractAddress,
            tokenId,
            ...options,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getNFTMetadata');
    }
  }

  /**
   * Get metadata for multiple NFTs in a single request
   * @see https://docs.alchemy.com/reference/getnftmetadatabatch-v3
   */
  async getNFTMetadataBatch(
    tokens: Array<{
      contractAddress: string;
      tokenId: string;
      tokenType?: string;
    }>,
    options?: {
      refreshCache?: boolean;
    }
  ): Promise<{
    nfts: NFTMetadata[];
  }> {
    try {
      const response = await this.client.post(
        `/nft/v3/${this.apiKey}/getNFTMetadataBatch`,
        {
          tokens,
          ...options,
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getNFTMetadataBatch');
    }
  }

  /**
   * Get contract metadata
   * @see https://docs.alchemy.com/reference/getcontractmetadata-v3
   */
  async getContractMetadata(
    contractAddress: string
  ): Promise<ContractMetadata> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/getContractMetadata`,
        {
          params: {
            contractAddress,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getContractMetadata');
    }
  }

  /**
   * Get contract metadata for multiple contracts
   * @see https://docs.alchemy.com/reference/getcontractmetadatabatch-v3
   */
  async getContractMetadataBatch(
    contractAddresses: string[]
  ): Promise<{
    contracts: ContractMetadata[];
  }> {
    try {
      const response = await this.client.post(
        `/nft/v3/${this.apiKey}/getContractMetadataBatch`,
        {
          contractAddresses,
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getContractMetadataBatch');
    }
  }

  /**
   * Compute rarity of each attribute of an NFT
   * @see https://docs.alchemy.com/reference/computerarity-v3
   */
  async computeRarity(
    contractAddress: string,
    tokenId: string
  ): Promise<RarityData> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/computeRarity`,
        {
          params: {
            contractAddress,
            tokenId,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'computeRarity');
    }
  }

  /**
   * Trigger metadata refresh for an NFT collection
   * @see https://docs.alchemy.com/reference/invalidatecontract-v3
   */
  async invalidateContract(
    contractAddress: string
  ): Promise<{
    message: string;
  }> {
    try {
      const response = await this.client.post(
        `/nft/v3/${this.apiKey}/invalidateContract`,
        {
          contractAddress,
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'invalidateContract');
    }
  }

  /**
   * Refresh metadata for a specific NFT
   * @see https://docs.alchemy.com/reference/refreshnftmetadata-v3
   */
  async refreshNFTMetadata(
    contractAddress: string,
    tokenId: string
  ): Promise<{
    message: string;
  }> {
    try {
      const response = await this.client.post(
        `/nft/v3/${this.apiKey}/refreshNftMetadata`,
        {
          contractAddress,
          tokenId,
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'refreshNFTMetadata');
    }
  }

  /**
   * Generate summary of attribute prevalence for a collection
   * @see https://docs.alchemy.com/reference/summarizenftattributes-v3
   */
  async summarizeNFTAttributes(
    contractAddress: string
  ): Promise<AttributeSummary> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/summarizeNFTAttributes`,
        {
          params: {
            contractAddress,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'summarizeNFTAttributes');
    }
  }

  /**
   * Search contract metadata for specific keywords
   * @see https://docs.alchemy.com/reference/searchcontractmetadata
   */
  async searchContractMetadata(
    query: string
  ): Promise<{
    contracts: ContractMetadata[];
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/searchContractMetadata`,
        {
          params: {
            query,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'searchContractMetadata');
    }
  }

  // ==========================================================================
  // NFT SPAM ENDPOINTS
  // ==========================================================================

  /**
   * Get list of contracts marked as spam
   * @see https://docs.alchemy.com/reference/getspamcontracts-v3
   */
  async getSpamContracts(): Promise<{
    spamContracts: string[];
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/getSpamContracts`
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getSpamContracts');
    }
  }

  /**
   * Check if a contract is marked as spam
   * @see https://docs.alchemy.com/reference/isspamcontract-v3
   */
  async isSpamContract(
    contractAddress: string
  ): Promise<{
    isSpamContract: boolean;
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/isSpamContract`,
        {
          params: {
            contractAddress,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'isSpamContract');
    }
  }

  /**
   * Check if a token is marked as an airdrop
   * @see https://docs.alchemy.com/reference/isairdropnft-v3
   */
  async isAirdropNFT(
    contractAddress: string,
    tokenId: string
  ): Promise<{
    isAirdrop: boolean;
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/isAirdropNFT`,
        {
          params: {
            contractAddress,
            tokenId,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'isAirdropNFT');
    }
  }

  /**
   * Report a contract as spam
   * @see https://docs.alchemy.com/reference/reportspam-v3
   */
  async reportSpam(
    contractAddress: string
  ): Promise<{
    message: string;
  }> {
    try {
      const response = await this.client.post(
        `/nft/v3/${this.apiKey}/reportSpam`,
        {
          contractAddress,
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'reportSpam');
    }
  }

  // ==========================================================================
  // NFT SALES ENDPOINTS
  // ==========================================================================

  /**
   * Get floor price of an NFT collection by marketplace
   * @see https://docs.alchemy.com/reference/getfloorprice-v3
   */
  async getFloorPrice(
    contractAddress: string
  ): Promise<FloorPrice> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/getFloorPrice`,
        {
          params: {
            contractAddress,
          },
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getFloorPrice');
    }
  }

  /**
   * Get NFT sales data across marketplaces
   * @see https://docs.alchemy.com/reference/getnftsales-v3
   */
  async getNFTSales(
    options: {
      fromBlock?: number | string;
      toBlock?: number | string;
      order?: 'asc' | 'desc';
      marketplace?: string;
      contractAddress?: string;
      tokenId?: string;
      buyerAddress?: string;
      sellerAddress?: string;
      taker?: 'buyer' | 'seller';
      limit?: number;
      pageKey?: string;
    }
  ): Promise<{
    nftSales: NFTSale[];
    pageKey?: string;
  }> {
    try {
      const response = await this.client.get(
        `/nft/v3/${this.apiKey}/getNFTSales`,
        {
          params: options,
        }
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error, 'getNFTSales');
    }
  }

  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================

  /**
   * Handle API errors
   */
  private handleError(error: unknown, method: string): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const message = axiosError.response?.data 
        ? JSON.stringify(axiosError.response.data)
        : axiosError.message;
      
      return new Error(
        `Alchemy API Error [${method}]: ${message}`
      );
    }
    
    return error instanceof Error 
      ? error 
      : new Error(`Unknown error in ${method}`);
  }

  /**
   * Change network
   */
  setNetwork(network: string): void {
    this.network = network;
    this.client.defaults.baseURL = `https://${network}.g.alchemy.com`;
  }

  /**
   * Get current network
   */
  getNetwork(): string {
    return this.network;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an Alchemy NFT Service instance
 */
export function createAlchemyNFTService(config: AlchemyConfig): AlchemyNFTService {
  return new AlchemyNFTService(config);
}

// ============================================================================
// Default Export
// ============================================================================

export default AlchemyNFTService;
