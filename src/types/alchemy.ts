/**
 * Alchemy NFT API Types
 * 
 * Type definitions for Alchemy NFT API responses and requests
 */

// ============================================================================
// Network Types
// ============================================================================

export type AlchemyNetwork =
  | 'eth-mainnet'
  | 'eth-sepolia'
  | 'polygon-mainnet'
  | 'polygon-amoy'
  | 'base-mainnet'
  | 'base-sepolia'
  | 'arbitrum-mainnet'
  | 'arbitrum-sepolia'
  | 'optimism-mainnet'
  | 'optimism-sepolia';

// ============================================================================
// NFT Types
// ============================================================================

export type NFTTokenType = 'ERC721' | 'ERC1155' | 'UNKNOWN';

export type NFTSpamClassification = 'SPAM' | 'AIRDROP';

export interface NFTImage {
  cachedUrl?: string;
  thumbnailUrl?: string;
  pngUrl?: string;
  contentType?: string;
  size?: number;
  originalUrl?: string;
}

export interface NFTRawMetadata {
  metadata?: Record<string, any>;
  tokenUri?: string;
  error?: string;
}

export interface NFTAcquiredAt {
  blockTimestamp?: string;
  blockNumber?: number;
}

export interface NFTContract {
  address: string;
  name?: string;
  symbol?: string;
  totalSupply?: string;
  tokenType?: NFTTokenType;
  contractDeployer?: string;
  deployedBlockNumber?: number;
}

export interface NFTMetadata {
  contract: NFTContract;
  tokenId: string;
  tokenType?: NFTTokenType;
  name?: string;
  description?: string;
  image?: NFTImage;
  raw?: NFTRawMetadata;
  tokenUri?: string;
  timeLastUpdated?: string;
  balance?: string;
  acquiredAt?: NFTAcquiredAt;
  collection?: {
    name?: string;
    slug?: string;
    externalUrl?: string;
    bannerImageUrl?: string;
  };
  mint?: {
    mintAddress?: string;
    blockNumber?: number;
    timestamp?: string;
    transactionHash?: string;
  };
}

// ============================================================================
// Ownership Types
// ============================================================================

export interface NFTTokenBalance {
  tokenId: string;
  balance: string;
}

export interface NFTOwner {
  ownerAddress: string;
  tokenBalances: NFTTokenBalance[];
}

export interface OwnedNFTContract {
  address: string;
  totalBalance: string;
  numDistinctTokensOwned: string;
  isSpam: boolean;
  tokenId?: string;
  media?: Array<{
    gateway?: string;
    thumbnail?: string;
    raw?: string;
    format?: string;
    bytes?: number;
  }>;
}

export interface NFTCollection {
  contractAddress: string;
  name?: string;
  symbol?: string;
  totalSupply?: string;
  tokenType?: NFTTokenType;
  openSeaMetadata?: OpenSeaMetadata;
  image?: NFTImage;
}

// ============================================================================
// Contract Metadata Types
// ============================================================================

export interface OpenSeaMetadata {
  floorPrice?: number;
  collectionName?: string;
  collectionSlug?: string;
  safelistRequestStatus?: 'verified' | 'approved' | 'requested' | 'not_requested';
  imageUrl?: string;
  description?: string;
  externalUrl?: string;
  twitterUsername?: string;
  discordUrl?: string;
  bannerImageUrl?: string;
  lastIngestedAt?: string;
}

export interface ContractMetadata {
  address: string;
  name?: string;
  symbol?: string;
  totalSupply?: string;
  tokenType?: NFTTokenType;
  contractDeployer?: string;
  deployedBlockNumber?: number;
  openSeaMetadata?: OpenSeaMetadata;
}

// ============================================================================
// Rarity Types
// ============================================================================

export interface NFTRarity {
  strategyId: string;
  strategyVersion: string;
  rank: number;
  score: number;
  maxRank: number;
  totalSupply: number;
  rarityScore: number;
  prevalence: number;
}

export interface NFTAttributeValue {
  value: string;
  count: number;
  prevalence: number;
}

export interface NFTAttributeSummary {
  contractAddress: string;
  totalSupply: number;
  summary: Record<string, NFTAttributeValue[]>;
}

// ============================================================================
// Sales Types
// ============================================================================

export type NFTMarketplace =
  | 'opensea'
  | 'looksrare'
  | 'x2y2'
  | 'blur'
  | 'seaport'
  | 'unknown';

export interface NFTSaleFee {
  amount: string;
  tokenAddress: string;
  symbol: string;
  decimals: number;
}

export interface NFTSale {
  marketplace: NFTMarketplace;
  contractAddress: string;
  tokenId: string;
  quantity: string;
  buyerAddress: string;
  sellerAddress: string;
  taker: 'buyer' | 'seller';
  sellerFee: NFTSaleFee;
  protocolFee?: NFTSaleFee;
  royaltyFee?: NFTSaleFee;
  blockNumber: number;
  logIndex: number;
  bundleIndex: number;
  transactionHash: string;
}

export interface MarketplaceFloorPrice {
  floorPrice: number;
  priceCurrency: string;
  collectionUrl: string;
  retrievedAt: string;
}

export interface NFTFloorPrice {
  openSea?: MarketplaceFloorPrice;
  looksRare?: MarketplaceFloorPrice;
}

// ============================================================================
// Request Options Types
// ============================================================================

export interface GetNFTsForOwnerOptions {
  pageKey?: string;
  contractAddresses?: string[];
  excludeFilters?: NFTSpamClassification[];
  includeFilters?: NFTSpamClassification[];
  pageSize?: number;
  orderBy?: 'asc' | 'desc';
  withMetadata?: boolean;
  tokenUriTimeoutInMs?: number;
}

export interface GetOwnersForContractOptions {
  withTokenBalances?: boolean;
  block?: string;
  pageKey?: string;
}

export interface GetContractsForOwnerOptions {
  pageKey?: string;
  pageSize?: number;
  excludeFilters?: NFTSpamClassification[];
  includeFilters?: NFTSpamClassification[];
  orderBy?: 'asc' | 'desc';
}

export interface GetCollectionsForOwnerOptions {
  pageKey?: string;
  pageSize?: number;
  excludeFilters?: NFTSpamClassification[];
  includeFilters?: NFTSpamClassification[];
}

export interface GetNFTsForContractOptions {
  pageKey?: string;
  pageSize?: number;
  withMetadata?: boolean;
  tokenUriTimeoutInMs?: number;
}

export interface GetNFTMetadataOptions {
  tokenType?: NFTTokenType;
  tokenUriTimeoutInMs?: number;
  refreshCache?: boolean;
}

export interface GetNFTMetadataBatchOptions {
  refreshCache?: boolean;
}

export interface NFTToken {
  contractAddress: string;
  tokenId: string;
  tokenType?: NFTTokenType;
}

export interface GetNFTSalesOptions {
  fromBlock?: number | string;
  toBlock?: number | string;
  order?: 'asc' | 'desc';
  marketplace?: NFTMarketplace;
  contractAddress?: string;
  tokenId?: string;
  buyerAddress?: string;
  sellerAddress?: string;
  taker?: 'buyer' | 'seller';
  limit?: number;
  pageKey?: string;
}

// ============================================================================
// Response Types
// ============================================================================

export interface GetNFTsForOwnerResponse {
  ownedNfts: NFTMetadata[];
  pageKey?: string;
  totalCount: number;
}

export interface GetOwnersForNFTResponse {
  owners: string[];
}

export interface GetOwnersForContractResponse {
  owners: NFTOwner[];
  pageKey?: string;
}

export interface IsHolderOfContractResponse {
  isHolderOfContract: boolean;
}

export interface GetContractsForOwnerResponse {
  contracts: OwnedNFTContract[];
  pageKey?: string;
  totalCount: number;
}

export interface GetCollectionsForOwnerResponse {
  collections: NFTCollection[];
  pageKey?: string;
}

export interface GetNFTsForContractResponse {
  nfts: NFTMetadata[];
  pageKey?: string;
}

export interface GetNFTMetadataBatchResponse {
  nfts: NFTMetadata[];
}

export interface GetContractMetadataBatchResponse {
  contracts: ContractMetadata[];
}

export interface GetSpamContractsResponse {
  spamContracts: string[];
}

export interface IsSpamContractResponse {
  isSpamContract: boolean;
}

export interface IsAirdropNFTResponse {
  isAirdrop: boolean;
}

export interface ReportSpamResponse {
  message: string;
}

export interface RefreshMetadataResponse {
  message: string;
}

export interface GetNFTSalesResponse {
  nftSales: NFTSale[];
  pageKey?: string;
}

// ============================================================================
// Utility Types
// ============================================================================

export interface AlchemyError {
  code: string;
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pageKey?: string;
  totalCount?: number;
}

// ============================================================================
// Portfolio Types (Custom)
// ============================================================================

export interface NFTPortfolioItem {
  address: string;
  name: string;
  symbol?: string;
  balance: number;
  distinctTokens: number;
  floorPrice: number;
  estimatedValue: number;
  image?: string;
  isSpam: boolean;
}

export interface NFTPortfolio {
  wallet: string;
  totalCollections: number;
  totalNFTs: number;
  totalValue: number;
  collections: NFTPortfolioItem[];
}

export interface NFTCollectionActivity {
  contractAddress: string;
  recentSales: number;
  totalVolume: number;
  avgPrice: number;
  floorPrice: number;
  totalOwners: number;
  sales: NFTSale[];
}

export interface NFTRarityInfo {
  tokenId: string;
  name?: string;
  rank: number;
  maxRank: number;
  rarityScore: number;
  percentile: number;
  totalSupply: number;
}
