/**
 * NFT Event Handler
 * 
 * Processes NFT contract events:
 * - Transfer events (mint, transfer, burn)
 * - Metadata fetching and storage
 * - Ownership tracking
 * - Contract metadata syncing
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3, 3.4, 3.5, 2.1, 2.2, 2.3, 2.4
 */

import { BaseEventHandler, HandlerContext } from './base-handler';
import { getChainProvider } from '../chain-provider';
import { prisma, withDbLimit } from '../../../config/database';
import { TransferType, Prisma } from '@prisma/client';
import { AlchemyNFTService } from '../../alchemy-nft-service';
import {
  mapNFTMetadata,
  mapContractMetadata,
  extractAttributes,
  mergeNFTData,
  type MappedNFTData,
  type MappedAttribute,
  type MappedContractData
} from '../../alchemy-metadata-mapper';
import { AlchemySpamDetector } from '../../alchemy-spam-detector';
import { ethers } from 'ethers';
import { ipfsToHttpOptimized, convertIpfsToHttp, convertIpfsToCloudflare, getPinataGateway } from '../../../utils/ipfs-helpers';
import { syncSingleNFT } from '../../onchain-nft-sync';

// ============================================================================
// Type Definitions
// ============================================================================

export interface TransferEventData {
  contractAddress: string;
  tokenId: string;
  from: string;
  to: string;
  quantity: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  logIndex: number;
  tokenType: 'ERC721' | 'ERC1155';
}

export interface NFTEventHandlerConfig extends HandlerContext {
  alchemyService: AlchemyNFTService;
  spamDetector: AlchemySpamDetector;
  isAlchemySupported: boolean; // Flag to indicate if Alchemy is supported for this chain
}

// ============================================================================
// NFT Event Handler Class
// ============================================================================

export class NFTEventHandler extends BaseEventHandler {
  private alchemyService: AlchemyNFTService;
  private spamDetector: AlchemySpamDetector;
  private isAlchemySupported: boolean;
  
  // Cache providers to avoid recreating them for every mint
  private providerCache: Map<number, ethers.JsonRpcProvider> = new Map();

  constructor(config: NFTEventHandlerConfig) {
    super(config);
    this.alchemyService = config.alchemyService;
    this.spamDetector = config.spamDetector;
    this.isAlchemySupported = config.isAlchemySupported;
  }
  
  /**
   * Get or create cached provider for a chain
   */
  private getProvider(chainId: number, rpcUrl: string): ethers.JsonRpcProvider {
    // Shared failover provider (all configured RPCs) for this chain
    return getChainProvider(chainId, rpcUrl);
  }

  // ==========================================================================
  // TASK 4.1: Transfer Event Handler
  // ==========================================================================

  /**
   * Handle Transfer event - main entry point
   * Requirements: 11.1, 11.2, 11.3, 11.4
   */
  async handleTransferEvent(transferData: TransferEventData): Promise<void> {
    try {
      // Validate event data
      this.validateEventData(transferData, [
        'contractAddress',
        'tokenId',
        'from',
        'to',
        'txHash',
        'blockNumber',
        'blockTimestamp'
      ]);

      // Normalize addresses
      const normalizedData = {
        ...transferData,
        contractAddress: transferData.contractAddress.toLowerCase(),
        from: transferData.from.toLowerCase(),
        to: transferData.to.toLowerCase()
      };

      // Determine transfer type
      const transferType = this.determineTransferType(normalizedData.from, normalizedData.to);

      console.log(`📦 Processing ${transferType}: ${normalizedData.contractAddress} token ${normalizedData.tokenId}`);

      // Check for duplicate transfer record
      const isDuplicate = await this.isDuplicateTransfer(
        normalizedData.txHash,
        normalizedData.logIndex
      );

      // Even if transfer record exists, we still need to ensure NFT data exists
      // This handles the case where transfer was recorded but NFT data failed
      if (isDuplicate) {
        console.log(`⚠️ Duplicate transfer detected, skipping: ${normalizedData.txHash}`);
        
        // But still check if NFT data exists and create if missing
        if (transferType === TransferType.MINT) {
          const nftExists = await this.nftExists(normalizedData.contractAddress, normalizedData.tokenId);
          if (!nftExists) {
            console.log(`📝 NFT data missing for token ${normalizedData.tokenId}, creating...`);
            await this.ensureContractExists(normalizedData.contractAddress, normalizedData.tokenType);
            await this.syncNFTMetadata(
              normalizedData.contractAddress,
              normalizedData.tokenId,
              normalizedData.tokenType,
              {
                mintAddress: normalizedData.to,
                mintBlockNumber: normalizedData.blockNumber,
                mintTimestamp: normalizedData.blockTimestamp,
                mintTransactionHash: normalizedData.txHash
              }
            );
          }
        }
        return;
      }

      // Process based on transfer type
      switch (transferType) {
        case TransferType.MINT:
          await this.handleMint(normalizedData);
          break;
        case TransferType.BURN:
          await this.handleBurn(normalizedData);
          break;
        case TransferType.TRANSFER:
          await this.handleRegularTransfer(normalizedData);
          break;
      }

      // Create transfer record (Requirement 11.4)
      await this.createTransferRecord(normalizedData, transferType);

      console.log(`✅ Transfer processed successfully: ${transferType} ${normalizedData.tokenId}`);
    } catch (error) {
      await this.logEventError('handleTransferEvent', error, transferData);
      throw error;
    }
  }

  /**
   * Handle mint event (transfer from zero address)
   * Requirements: 11.2
   */
  private async handleMint(transferData: TransferEventData): Promise<void> {
    try {
      // Ensure contract exists in database (Task 4.7)
      await this.ensureContractExists(transferData.contractAddress, transferData.tokenType);

      // Get RPC URL from chain config
      const chain = await prisma.chain.findUnique({
        where: { chainId: this.context.chainId }
      });

      if (!chain) {
        throw new Error(`Chain ${this.context.chainId} not found in database`);
      }

      // Sync NFT metadata directly from blockchain (NO ALCHEMY!)
      console.log(`🔄 Syncing NFT #${transferData.tokenId} from on-chain...`);
      const syncResult = await syncSingleNFT(
        transferData.contractAddress,
        transferData.tokenId,
        this.context.chainId,
        chain.rpcUrl
      );

      if (!syncResult.success) {
        console.error(`❌ Failed to sync NFT from on-chain: ${syncResult.message}`);
        throw new Error(`On-chain sync failed: ${syncResult.message}`);
      }

      console.log(`✅ NFT #${transferData.tokenId} synced from on-chain successfully`);

      // Get the synced NFT data for collection image
      const nft = await prisma.nFT.findUnique({
        where: {
          contractAddress_tokenId_chainId: {
            contractAddress: transferData.contractAddress.toLowerCase(),
            tokenId: transferData.tokenId,
            chainId: this.context.chainId
          }
        }
      });

      // Sync collection image using NFT image (for Standard Collection)
      const nftImageUrl = nft?.imageCachedUrl || nft?.imageOriginalUrl;
      await this.syncCollectionImage(transferData.contractAddress, nftImageUrl || undefined);

      // Update ownership (Task 4.5)
      await this.updateOwnership(
        transferData.contractAddress,
        transferData.tokenId,
        transferData.to,
        transferData.quantity,
        {
          txHash: transferData.txHash,
          blockNumber: transferData.blockNumber,
          blockTimestamp: transferData.blockTimestamp
        }
      );

      // Update contract minted count
      await this.incrementContractSupply(transferData.contractAddress, parseInt(transferData.quantity));

      // Update analytics after mint (Requirements 1.8, 1.9)
      await this.updateCollectionAnalytics(transferData.contractAddress);

      console.log(`✅ Mint #${transferData.tokenId} → ${this.truncateAddress(transferData.to)}`);
    } catch (error) {
      console.error(`❌ Error handling mint #${transferData.tokenId}:`, error);
      throw error;
    }
  }

  /**
   * Handle burn event (transfer to zero address)
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
   */
  private async handleBurn(transferData: TransferEventData): Promise<void> {
    try {
      console.log(`🔥 Burning NFT: ${transferData.contractAddress} token ${transferData.tokenId}`);

      // Update ownership to mark as burned (Requirement 2.2)
      await this.removeOwnership(
        transferData.contractAddress,
        transferData.tokenId,
        transferData.from
      );

      // Decrement contract supply (Requirement 2.4)
      await this.decrementContractSupply(transferData.contractAddress, parseInt(transferData.quantity));

      // Decrement nft_collection_analytics totalSupply (Requirement 2.5)
      await this.decrementCollectionAnalyticsSupply(transferData.contractAddress, parseInt(transferData.quantity));

      // Decrement launchpad mintedCount if applicable (Requirement 2.6)
      await this.decrementLaunchpadMintedCount(transferData.contractAddress, parseInt(transferData.quantity));

      // Create activity record with type BURN (Requirement 2.3)
      await this.createBurnActivity(transferData);

      // Update analytics after burn (Requirement 2.7)
      await this.updateCollectionAnalytics(transferData.contractAddress);

      console.log(`✅ Burn completed: token ${transferData.tokenId} from ${this.truncateAddress(transferData.from)}`);
    } catch (error) {
      console.error(`❌ Error handling burn:`, error);
      throw error;
    }
  }

  /**
   * Handle regular transfer (between non-zero addresses)
   * Requirements: 11.1
   */
  private async handleRegularTransfer(transferData: TransferEventData): Promise<void> {
    try {
      console.log(`🔄 Transferring NFT: ${transferData.contractAddress} token ${transferData.tokenId}`);
      console.log(`   From: ${this.truncateAddress(transferData.from)} → To: ${this.truncateAddress(transferData.to)}`);

      // Ensure NFT exists (might be first time we see it)
      const nftExists = await this.nftExists(transferData.contractAddress, transferData.tokenId);
      
      if (!nftExists) {
        // Fetch metadata for this NFT
        await this.ensureContractExists(transferData.contractAddress, transferData.tokenType);
        await this.syncNFTMetadata(
          transferData.contractAddress,
          transferData.tokenId,
          transferData.tokenType
        );
      }

      // Update ownership (Task 4.5)
      await this.updateOwnership(
        transferData.contractAddress,
        transferData.tokenId,
        transferData.to,
        transferData.quantity,
        {
          txHash: transferData.txHash,
          blockNumber: transferData.blockNumber,
          blockTimestamp: transferData.blockTimestamp
        },
        transferData.from
      );

      // Update analytics after transfer (Requirements 1.8, 1.9)
      await this.updateCollectionAnalytics(transferData.contractAddress);

      console.log(`✅ Transfer completed: token ${transferData.tokenId}`);
    } catch (error) {
      console.error(`❌ Error handling transfer:`, error);
      throw error;
    }
  }

  /**
   * Create transfer record in database
   * Requirements: 11.4
   */
  private async createTransferRecord(
    transferData: TransferEventData,
    transferType: TransferType
  ): Promise<void> {
    try {
      // Get NFT ID
      const nft = await prisma.nFT.findUnique({
        where: {
          contractAddress_tokenId_chainId: {
            contractAddress: transferData.contractAddress,
            tokenId: transferData.tokenId,
            chainId: this.context.chainId
          }
        },
        select: { id: true }
      });

      if (!nft) {
        console.warn(`⚠️ NFT not found for transfer record: ${transferData.contractAddress} token ${transferData.tokenId}`);
        return;
      }

      // Check for duplicate before creating (prevent race condition)
      const existing = await prisma.nFTTransfer.findUnique({
        where: {
          txHash_logIndex: {
            txHash: transferData.txHash,
            logIndex: transferData.logIndex
          }
        }
      });

      if (existing) {
        console.log(`🔄 Transfer record already exists, skipping: ${transferType} ${transferData.tokenId}`);
        return;
      }

      await prisma.nFTTransfer.create({
        data: {
          chainId: this.context.chainId,
          nftId: nft.id,
          fromAddress: transferData.from,
          toAddress: transferData.to,
          quantity: transferData.quantity,
          txHash: transferData.txHash,
          blockNumber: transferData.blockNumber,
          blockTimestamp: transferData.blockTimestamp,
          logIndex: transferData.logIndex,
          transferType
        }
      });

      console.log(`📝 Transfer record created: ${transferType}`);
    } catch (error: any) {
      // Handle unique constraint violation gracefully
      if (error.code === 'P2002' || error.message?.includes('Unique constraint')) {
        console.log(`🔄 Transfer record already exists (race condition): ${transferType} ${transferData.tokenId}`);
        return;
      }
      console.error(`❌ Error creating transfer record:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // TASK 4.3: Metadata Fetching and Storage
  // ==========================================================================

  /**
   * Fetch NFT metadata from Alchemy and store in database
   * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
   * Optimized for batch minting with faster fallback
   * Returns the mapped NFT data for use by caller (e.g., for collection image)
   */
  async syncNFTMetadata(
    contractAddress: string,
    tokenId: string,
    tokenType: 'ERC721' | 'ERC1155',
    mintInfo?: {
      mintAddress: string;
      mintBlockNumber: number;
      mintTimestamp: Date;
      mintTransactionHash: string;
    }
  ): Promise<MappedNFTData | null> {
    try {
      let mappedData: MappedNFTData;
      let attributes: MappedAttribute[] = [];
      let isSpam = false;
      let isAirdrop = false;

      // Skip Alchemy if not supported for this chain (e.g., MegaETH, Monad)
      if (!this.isAlchemySupported) {
        console.log(`📡 Chain ${this.context.chainId} not supported by Alchemy, fetching directly from blockchain`);
        mappedData = await this.fetchMetadataFromContract(
          contractAddress,
          tokenId,
          tokenType
        );
      } else {
        // Try to fetch from contract first (RPC-based, no Alchemy dependency)
        // Only use Alchemy if RPC fails and Alchemy is available
        let useAlchemy = this.isAlchemySupported;
        
        try {
          // Try RPC-based metadata fetch first
          mappedData = await this.fetchMetadataFromContract(
            contractAddress,
            tokenId,
            tokenType
          );
          console.log(`✅ Fetched metadata via RPC for token ${tokenId}`);
        } catch (rpcError: any) {
          console.log(`⚠️ RPC metadata fetch failed for token ${tokenId}: ${rpcError.message}`);
          
          // Fallback to Alchemy only if supported
          if (useAlchemy) {
            try {
              console.log(`🔄 Trying Alchemy as fallback for token ${tokenId}...`);
              
              // Fetch metadata from Alchemy with timeout
              const alchemyPromise = this.alchemyService.getNFTMetadata(
                contractAddress,
                tokenId,
                { tokenType, refreshCache: false }
              );
              
              // 10 second timeout for Alchemy
              const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Alchemy timeout')), 10000);
              });
              
              const alchemyMetadata = await Promise.race([alchemyPromise, timeoutPromise]);

              // Check if Alchemy couldn't identify the contract
              if (alchemyMetadata.tokenType === 'NOT_A_CONTRACT' || 
                  (!alchemyMetadata.name && !alchemyMetadata.tokenUri && !alchemyMetadata.raw?.tokenUri)) {
                console.log(`⚠️ Alchemy returned incomplete data for token ${tokenId}, using minimal data`);
                throw new Error('Alchemy could not identify contract');
              }

              // Check spam status (with timeout)
              try {
                const spamPromise = Promise.all([
                  this.spamDetector.isSpamContract(contractAddress),
                  this.spamDetector.isAirdropNFT(contractAddress, tokenId)
                ]);
                const spamTimeout = new Promise<[boolean, boolean]>((resolve) => {
                  setTimeout(() => resolve([false, false]), 2000);
                });
                [isSpam, isAirdrop] = await Promise.race([spamPromise, spamTimeout]);
              } catch {
                isSpam = false;
                isAirdrop = false;
              }

              // Map to database schema
              mappedData = mapNFTMetadata(
                alchemyMetadata as any,
                this.context.chainId,
                isSpam,
                isAirdrop
              );

              // Extract attributes
              attributes = extractAttributes(mappedData.rawMetadata);
              
              console.log(`✅ Fetched metadata via Alchemy for token ${tokenId}`);
            } catch (alchemyError: any) {
              // If Alchemy also fails, create minimal metadata
              console.warn(`⚠️ Alchemy also failed for token ${tokenId}: ${alchemyError.message}`);
              
              // Check if it's a capacity limit error
              if (alchemyError.message?.includes('capacity limit exceeded')) {
                console.warn(`⚠️ Alchemy capacity limit exceeded - will use RPC-only from now on`);
                // Disable Alchemy for future calls in this session
                this.isAlchemySupported = false;
              }
              
              // Create minimal metadata as last resort
              mappedData = this.createMinimalNFTMetadata(contractAddress, tokenId, tokenType);
            }
          } else {
            // Alchemy not available, create minimal metadata
            console.log(`⚠️ Creating minimal metadata for token ${tokenId} (Alchemy not available)`);
            mappedData = this.createMinimalNFTMetadata(contractAddress, tokenId, tokenType);
          }
        }
      }

      // Add mint info if provided
      if (mintInfo) {
        mappedData.mintAddress = mintInfo.mintAddress;
        mappedData.mintBlockNumber = mintInfo.mintBlockNumber;
        mappedData.mintTimestamp = mintInfo.mintTimestamp;
        mappedData.mintTransactionHash = mintInfo.mintTransactionHash;
      }

      // Store in database
      await this.storeNFTData(mappedData, attributes);
      console.log(`💾 NFT #${tokenId} metadata stored in database`);
      
      // Return mapped data for caller use
      return mappedData;
    } catch (error) {
      console.error(`❌ Error syncing NFT metadata token ${tokenId}:`, error);
      await this.logEventError('syncNFTMetadata', error, { contractAddress, tokenId });
      // Re-throw so caller knows it failed
      throw error;
    }
  }

  /**
   * Fetch metadata directly from contract (fallback when Alchemy is unavailable)
   * Requirements: 10.5 - Fallback to direct blockchain queries
   */
  private async fetchMetadataFromContract(
    contractAddress: string,
    tokenId: string,
    tokenType: 'ERC721' | 'ERC1155'
  ): Promise<MappedNFTData> {
    try {
      let tokenUri: string | null = null;
      let metadata: any = null;
      let contractName: string | null = null;
      
      // Step 1: Get RPC URL from chain config
      const chain = await prisma.chain.findUnique({
        where: { chainId: this.context.chainId }
      });

      if (!chain) {
        throw new Error(`Chain ${this.context.chainId} not found in database`);
      }

      // Step 2: Try to call tokenURI() directly from contract
      try {
        // Validate contract address before creating contract (prevents ENS resolution on non-ENS chains)
        if (!ethers.isAddress(contractAddress)) {
          throw new Error(`Invalid contract address: ${contractAddress}`);
        }

        // Use cached provider to avoid "failed to detect network" errors
        const provider = this.getProvider(this.context.chainId, chain.rpcUrl);
        
        const contract = new ethers.Contract(
          contractAddress,
          [
            'function tokenURI(uint256 tokenId) view returns (string)',
            'function name() view returns (string)',
            'function symbol() view returns (string)'
          ],
          provider
        );

        // Get tokenURI from contract
        try {
          tokenUri = await contract.tokenURI(tokenId);
        } catch (uriError: any) {
          // Silent fail, will try launchpad baseURI
        }

        // Get contract name
        try {
          contractName = await contract.name();
        } catch (nameError: any) {
          // Silent fail
        }
      } catch (contractError: any) {
        // Silent fail, will try launchpad
      }

      // Step 2: If no tokenURI from contract, try launchpad baseURI
      if (!tokenUri) {
        try {
          const launchpad = await prisma.launchpad.findUnique({
            where: {
              contractAddress: contractAddress.toLowerCase()
            }
          });

          if (launchpad?.baseURI) {
            // Normalize baseURI (ensure proper format)
            let baseUri = launchpad.baseURI.trim();
            
            // Replace placeholder CONTRACT_ADDRESS with actual contract address
            if (baseUri.includes('CONTRACT_ADDRESS')) {
              baseUri = baseUri.replace(/CONTRACT_ADDRESS/g, contractAddress.toLowerCase());
              console.log(`📝 Replaced CONTRACT_ADDRESS placeholder: ${baseUri}`);
            }
            
            // Check if baseURI is an API endpoint (for Standard Collection with manifest)
            if (baseUri.includes('/api/metadata/')) {
              // Standard Collection: baseURI points to API resolver
              // Format: https://domain.com/api/metadata/[contractAddress]/
              // Ensure trailing slash
              if (!baseUri.endsWith('/')) {
                baseUri = `${baseUri}/`;
              }
              tokenUri = `${baseUri}${tokenId}`;
              console.log(`📝 Standard Collection (API resolver): ${tokenUri}`);
            }
            // Check if this is an Open Edition (baseURI points to a single metadata file)
            else if (baseUri.includes('.json')) {
              // Open Edition: baseURI is direct URL to metadata.json
              // All tokens use the same metadata file
              tokenUri = baseUri;
              console.log(`📝 Open Edition detected: Using baseURI directly for all tokens`);
            } else {
              // Standard Collection (direct IPFS): append tokenId
              // Ensure trailing slash
              if (!baseUri.endsWith('/')) {
                baseUri = `${baseUri}/`;
              }
              tokenUri = `${baseUri}${tokenId}.json`;
              console.log(`📝 Standard Collection (direct IPFS): ${tokenUri}`);
            }
          }
          
          // Use launchpad name if contract name not available
          if (!contractName && launchpad?.name) {
            contractName = launchpad.name;
          }
        } catch (dbError) {
          // Silent fail
        }
      }

      // Step 3: Fetch metadata JSON from tokenURI
      let fetchUrl: string | null = tokenUri; // Declare outside try block for error handling
      if (tokenUri) {
        try {
          // Handle IPFS URIs - use fastest gateway
          if (tokenUri.startsWith('ipfs://')) {
            fetchUrl = await ipfsToHttpOptimized(tokenUri) || tokenUri;
          }

          console.log(`🔍 Fetching metadata from: ${fetchUrl}`);

          // Guard against null fetchUrl
          if (!fetchUrl) {
            throw new Error('No fetch URL available');
          }

          // Timeout 10 seconds for IPFS metadata fetching (IPFS can be slow)
          const response = await fetch(fetchUrl, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'NFT-Listener-Service/1.0'
            },
            signal: AbortSignal.timeout(10000)
          });
          
          if (response.ok) {
            metadata = await response.json();
            console.log(`✅ Metadata fetched successfully for token ${tokenId}`);
          } else if (response.status === 404) {
            // Workaround: If tokenURI points to API endpoint that doesn't exist yet,
            // try to fetch collection metadata from contractURI and generate token metadata
            try {
              const launchpad = await prisma.launchpad.findUnique({
                where: { contractAddress: contractAddress.toLowerCase() }
              });
              
              if (launchpad?.contractURI) {
                let contractMetadataUrl = launchpad.contractURI;
                if (contractMetadataUrl.startsWith('ipfs://')) {
                  contractMetadataUrl = await ipfsToHttpOptimized(contractMetadataUrl) || contractMetadataUrl;
                }
                
                const collectionResponse = await fetch(contractMetadataUrl, {
                  headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'NFT-Listener-Service/1.0'
                  },
                  signal: AbortSignal.timeout(5000) // Shorter timeout for batch minting
                });
                
                if (collectionResponse.ok) {
                  const collectionMetadata: any = await collectionResponse.json();
                  
                  // Generate token metadata from collection metadata
                  metadata = {
                    name: `${collectionMetadata?.name || launchpad.name} #${tokenId}`,
                    description: collectionMetadata?.description || launchpad.description || null,
                    image: collectionMetadata?.image || null,
                    external_url: collectionMetadata?.external_link || launchpad.externalLink || null,
                    attributes: []
                  };
                }
              }
            } catch (collectionError: any) {
              // Silent fail
            }
          }
        } catch (fetchError: any) {
          console.warn(`⚠️ Failed to fetch metadata from ${fetchUrl || tokenUri}: ${fetchError.message}`);
          
          // Try alternative IPFS gateway if original was IPFS
          if (tokenUri && tokenUri.startsWith('ipfs://') && !metadata) {
            try {
              const altUrl = convertIpfsToCloudflare(tokenUri);
              console.log(`🔄 Trying alternative gateway (Cloudflare): ${altUrl}`);
              
              const altResponse = await fetch(altUrl, {
                headers: {
                  'Accept': 'application/json',
                  'User-Agent': 'NFT-Listener-Service/1.0'
                },
                signal: AbortSignal.timeout(5000)
              });
              
              if (altResponse.ok) {
                metadata = await altResponse.json();
                console.log(`✅ Metadata fetched from alternative gateway`);
              }
            } catch (altError: any) {
              console.warn(`⚠️ Alternative gateway also failed: ${altError.message}`);
            }
          }
        }
      }

      // Step 4: Process image URL (handle IPFS) - use Pinata gateway
      let imageUrl = metadata?.image || null;
      let originalImageUrl = metadata?.image || null; // Keep track of original before processing
      
      // Debug logging for image processing
      console.log(`🖼️ Processing image for token ${tokenId}:`);
      console.log(`   └─ metadata.image: ${metadata?.image || '(null)'}`);
      console.log(`   └─ Initial imageUrl: ${imageUrl || '(null)'}`);
      
      // Helper function to check if URL is relative path
      const isRelativePath = (url: string): boolean => {
        if (!url) return false;
        // Check for relative paths: ./file.png, ../file.png, file.png, 5.png
        return !url.startsWith('ipfs://') && 
               !url.startsWith('http://') && 
               !url.startsWith('https://') &&
               !url.startsWith('data:'); // Also exclude data URIs
      };
      
      // If image is just a filename or relative path, resolve using imageManifestHash or manifestHash
      if (imageUrl && isRelativePath(imageUrl)) {
        console.log(`🔍 Image is relative path/filename: ${imageUrl}, resolving from hash...`);
        
        try {
          const launchpad = await prisma.launchpad.findUnique({
            where: { contractAddress: contractAddress.toLowerCase() },
            select: { manifestHash: true, imageManifestHash: true }
          });
          
          const launchpadAny = launchpad as any;
          
          const isValidHash = (hash: string | null | undefined): boolean => {
            if (!hash) return false;
            // Invalid if empty, "{}", or too short (valid IPFS CID is 46+ chars)
            const trimmed = hash.trim();
            return trimmed.length >= 46 && trimmed !== '{}' && !trimmed.startsWith('{');
          };
          
          let manifestHashToUse: string | null = null;
          
          // Try imageManifestHash first (if field exists)
          if (isValidHash(launchpadAny?.imageManifestHash)) {
            manifestHashToUse = launchpadAny.imageManifestHash;
            console.log(`📦 Using imageManifestHash: ${manifestHashToUse}`);
          } else if (isValidHash(launchpad?.manifestHash)) {
            // Fallback to manifestHash
            manifestHashToUse = launchpad!.manifestHash!;
            console.log(`📦 imageManifestHash invalid, using manifestHash: ${manifestHashToUse}`);
          }
          
          if (manifestHashToUse) {
            // Fetch the manifest JSON to get the actual image IPFS hash for this tokenId
            try {
              const manifestUrl = `${getPinataGateway()}${manifestHashToUse}`;
              console.log(`🔍 Fetching image manifest from: ${manifestUrl}`);
              
              const manifestResponse = await fetch(manifestUrl, {
                headers: {
                  'Accept': 'application/json',
                  'User-Agent': 'NFT-Listener-Service/1.0'
                },
                signal: AbortSignal.timeout(10000)
              });
              
              if (manifestResponse.ok) {
                const manifestData = await manifestResponse.json() as Record<string, string>;
                
                // Manifest is a JSON object with tokenId as key and IPFS URL as value
                // e.g., { "0": "ipfs://QmTFY3bfWG1CwGGQThch6hVDXeWpSoocKRDRkqW5D3fxjn", ... }
                const tokenImageUrl = manifestData[tokenId] || manifestData[tokenId.toString()];
                
                if (tokenImageUrl) {
                  // Manifest returned full URL (could be ipfs://, https://, or http://)
                  imageUrl = tokenImageUrl;
                  originalImageUrl = tokenImageUrl;
                  console.log(`✅ Resolved image URL from manifest: ${imageUrl}`);
                } else {
                  console.log(`⚠️ Token ${tokenId} not found in manifest, using fallback`);
                  // Fallback: assume it's a folder with numbered files
                  // Remove leading ./ or ../ from imageUrl
                  const cleanImagePath = imageUrl.replace(/^\.\.?\//, '');
                  imageUrl = `ipfs://${manifestHashToUse}/${cleanImagePath}`;
                  originalImageUrl = imageUrl;
                  console.log(`📦 Fallback image URL: ${imageUrl}`);
                }
              } else {
                console.log(`⚠️ Failed to fetch manifest (${manifestResponse.status}), using folder fallback`);
                // Fallback: assume it's a folder with numbered files
                const cleanImagePath = imageUrl.replace(/^\.\.?\//, '');
                imageUrl = `ipfs://${manifestHashToUse}/${cleanImagePath}`;
                originalImageUrl = imageUrl;
              }
            } catch (manifestError: any) {
              console.warn(`⚠️ Failed to fetch manifest: ${manifestError.message}, using folder fallback`);
              // Fallback: assume it's a folder with numbered files
              const cleanImagePath = imageUrl.replace(/^\.\.?\//, '');
              imageUrl = `ipfs://${manifestHashToUse}/${cleanImagePath}`;
              originalImageUrl = imageUrl;
            }
          } else {
            console.log(`⚠️ No valid hash found for ${contractAddress}`);
          }
        } catch (resolveError: any) {
          console.warn(`⚠️ Failed to resolve image: ${resolveError.message}`);
        }
      }
      
      // Convert IPFS URL to gateway URL for cached/display URLs
      let cachedImageUrl = imageUrl;
      if (cachedImageUrl && cachedImageUrl.startsWith('ipfs://')) {
        // Use fastest IPFS gateway
        cachedImageUrl = await ipfsToHttpOptimized(cachedImageUrl) || cachedImageUrl;
      }

      // Debug logging
      if (!cachedImageUrl) {
        console.warn(`⚠️ No image URL found for token ${tokenId}. TokenURI: ${tokenUri}, Metadata: ${JSON.stringify(metadata)}`);
      } else {
        console.log(`🖼️ Cached Image URL for token ${tokenId}: ${cachedImageUrl}`);
        console.log(`🖼️ Original Image URL for token ${tokenId}: ${originalImageUrl}`);
      }

      // Step 5: Determine NFT name
      let nftName = metadata?.name || null;
      if (!nftName && contractName) {
        nftName = `${contractName} #${tokenId}`;
      }
      if (!nftName) {
        nftName = `Token #${tokenId}`;
      }

      // Map metadata to database schema
      const mappedData: MappedNFTData = {
        chainId: this.context.chainId,
        contractAddress: contractAddress.toLowerCase(),
        tokenId: tokenId,
        tokenType: tokenType,
        name: nftName,
        description: metadata?.description || null,
        tokenUri: tokenUri,
        imageCachedUrl: cachedImageUrl,
        imageThumbnailUrl: cachedImageUrl,
        imagePngUrl: cachedImageUrl,
        imageContentType: cachedImageUrl ? (cachedImageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg') : null,
        imageSize: null,
        imageOriginalUrl: originalImageUrl, // Store the full IPFS URL, not relative path
        rawMetadata: metadata || {},
        rawTokenUri: tokenUri,
        timeLastUpdated: new Date(),
        acquiredBlockTimestamp: null,
        acquiredBlockNumber: null,
        mintAddress: null,
        mintBlockNumber: null,
        mintTimestamp: null,
        mintTransactionHash: null,
        isSpam: false,
        isAirdrop: false
      };

      return mappedData;
    } catch (error: any) {
      console.error(`❌ Error fetching metadata from contract:`, error?.message || error);
      
      // Last resort: Try to fetch metadata from tokenUri if we have one
      // This handles cases where earlier steps failed but we still have a valid tokenUri
      try {
        // Try to get tokenUri from contract directly
        const chain = await prisma.chain.findUnique({
          where: { chainId: this.context.chainId }
        });
        
        if (chain) {
          const provider = this.getProvider(this.context.chainId, chain.rpcUrl);
          const contract = new ethers.Contract(
            contractAddress,
            ['function tokenURI(uint256 tokenId) view returns (string)'],
            provider
          );
          
          try {
            const tokenUri = await contract.tokenURI(tokenId);
            if (tokenUri) {
              console.log(`🔄 Retry: Got tokenURI from contract: ${tokenUri}`);
              
              // Try to fetch metadata
              let fetchUrl = tokenUri;
              if (tokenUri.startsWith('ipfs://')) {
                fetchUrl = await ipfsToHttpOptimized(tokenUri) || tokenUri;
              }
              
              const response = await fetch(fetchUrl, {
                headers: {
                  'Accept': 'application/json',
                  'User-Agent': 'NFT-Listener-Service/1.0'
                },
                signal: AbortSignal.timeout(10000) // Longer timeout for retry
              });
              
              if (response.ok) {
                const metadata: any = await response.json();
                console.log(`✅ Retry: Metadata fetched successfully`);
                
                // Helper function to check if URL is relative path
                const isRelativePath = (url: string): boolean => {
                  if (!url) return false;
                  return !url.startsWith('ipfs://') && 
                         !url.startsWith('http://') && 
                         !url.startsWith('https://') &&
                         !url.startsWith('data:');
                };
                
                // Process image URL - handle relative paths
                let imageUrl = metadata?.image || null;
                let originalImageUrl = metadata?.image || null;
                
                // If image is relative path, try to resolve it
                if (imageUrl && isRelativePath(imageUrl)) {
                  console.log(`🔍 Retry: Image is relative path: ${imageUrl}`);
                  // Try to get manifestHash from launchpad
                  try {
                    const launchpad = await prisma.launchpad.findUnique({
                      where: { contractAddress: contractAddress.toLowerCase() },
                      select: { manifestHash: true, imageManifestHash: true }
                    });
                    
                    const launchpadAny = launchpad as any;
                    const manifestHashToUse = launchpadAny?.imageManifestHash || launchpad?.manifestHash;
                    
                    if (manifestHashToUse && manifestHashToUse.length >= 46) {
                      // Remove leading ./ or ../
                      const cleanImagePath = imageUrl.replace(/^\.\.?\//, '');
                      imageUrl = `ipfs://${manifestHashToUse}/${cleanImagePath}`;
                      originalImageUrl = imageUrl;
                      console.log(`✅ Retry: Resolved to ${imageUrl}`);
                    }
                  } catch {
                    // Silent fail
                  }
                }
                
                // Convert IPFS to HTTP gateway
                let cachedImageUrl = imageUrl;
                if (cachedImageUrl && cachedImageUrl.startsWith('ipfs://')) {
                  cachedImageUrl = await ipfsToHttpOptimized(cachedImageUrl) || cachedImageUrl;
                }
                
                return {
                  chainId: this.context.chainId,
                  contractAddress: contractAddress.toLowerCase(),
                  tokenId: tokenId,
                  tokenType: tokenType,
                  name: metadata?.name || `Token #${tokenId}`,
                  description: metadata?.description || null,
                  tokenUri: tokenUri,
                  imageCachedUrl: cachedImageUrl,
                  imageThumbnailUrl: cachedImageUrl,
                  imagePngUrl: cachedImageUrl,
                  imageContentType: cachedImageUrl ? 'image/jpeg' : null,
                  imageSize: null,
                  imageOriginalUrl: originalImageUrl, // Store full IPFS URL
                  rawMetadata: metadata || {},
                  rawTokenUri: tokenUri,
                  timeLastUpdated: new Date(),
                  acquiredBlockTimestamp: null,
                  acquiredBlockNumber: null,
                  mintAddress: null,
                  mintBlockNumber: null,
                  mintTimestamp: null,
                  mintTransactionHash: null,
                  isSpam: false,
                  isAirdrop: false
                };
              }
            }
          } catch (retryError: any) {
            console.warn(`⚠️ Retry also failed: ${retryError?.message || retryError}`);
          }
        }
      } catch (fallbackError: any) {
        console.warn(`⚠️ Fallback fetch also failed: ${fallbackError?.message || fallbackError}`);
      }
      
      // Return minimal metadata as last resort
      console.warn(`⚠️ Returning minimal metadata for token ${tokenId} - all fetches failed`);
      return {
        chainId: this.context.chainId,
        contractAddress: contractAddress.toLowerCase(),
        tokenId: tokenId,
        tokenType: tokenType,
        name: `Token #${tokenId}`,
        description: null,
        tokenUri: null,
        imageCachedUrl: null,
        imageThumbnailUrl: null,
        imagePngUrl: null,
        imageContentType: null,
        imageSize: null,
        imageOriginalUrl: null,
        rawMetadata: null,
        rawTokenUri: null,
        timeLastUpdated: new Date(),
        acquiredBlockTimestamp: null,
        acquiredBlockNumber: null,
        mintAddress: null,
        mintBlockNumber: null,
        mintTimestamp: null,
        mintTransactionHash: null,
        isSpam: false,
        isAirdrop: false
      };
    }
  }

  /**
   * Store NFT data and attributes in database
   * Includes retry mechanism for batch minting scenarios
   */
  private async storeNFTData(
    nftData: MappedNFTData,
    attributes: MappedAttribute[]
  ): Promise<void> {
    const maxRetries = 3;
    let lastError: any;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use withDbLimit to prevent connection exhaustion
        await withDbLimit(async () => {
          // Check if NFT already exists
          const existingNFT = await prisma.nFT.findUnique({
            where: {
              contractAddress_tokenId_chainId: {
                contractAddress: nftData.contractAddress,
                tokenId: nftData.tokenId,
                chainId: nftData.chainId
              }
            }
          });

          if (existingNFT) {
            // Update existing NFT
            const mergedData = mergeNFTData(existingNFT, nftData);
            
            await prisma.nFT.update({
              where: { id: existingNFT.id },
              data: {
                ...mergedData,
                rawMetadata: mergedData.rawMetadata as Prisma.InputJsonValue,
                timeLastUpdated: new Date()
              }
            });

            // Delete old attributes and create new ones
            await prisma.nFTAttribute.deleteMany({
              where: { nftId: existingNFT.id }
            });

            if (attributes.length > 0) {
              await prisma.nFTAttribute.createMany({
                data: attributes.map(attr => ({
                  nftId: existingNFT.id,
                  ...attr
                }))
              });
            }
          } else {
            // Create new NFT with attributes
            await prisma.nFT.create({
              data: {
                ...nftData,
                rawMetadata: nftData.rawMetadata as Prisma.InputJsonValue,
                attributes: {
                  create: attributes
                }
              }
            });
            
            // Debug logging for image URLs
            console.log(`💾 NFT #${nftData.tokenId} saved - Image URLs:`, {
              imageCachedUrl: nftData.imageCachedUrl,
              imageThumbnailUrl: nftData.imageThumbnailUrl,
              imageOriginalUrl: nftData.imageOriginalUrl
            });
          }
        });
        
        // Success - return
        return;
      } catch (error: any) {
        lastError = error;
        
        // Handle unique constraint violation (race condition)
        if (error.code === 'P2002' || error.message?.includes('Unique constraint')) {
          console.log(`🔄 NFT #${nftData.tokenId} already exists (race condition)`);
          return;
        }
        
        // Handle retryable errors
        const isRetryable = 
          error.code === 'P2034' || // Deadlock
          error.code === 'P2037' || // Too many connections
          error.code === 'P1001' || // Can't reach database
          error.code === 'P1002' || // Database timeout
          error.message?.includes('deadlock') ||
          error.message?.includes('timeout') ||
          error.message?.includes('too many clients') ||
          error.message?.includes('Connection');
        
        if (isRetryable && attempt < maxRetries) {
          console.warn(`⚠️ Retryable error storing NFT #${nftData.tokenId}, attempt ${attempt}/${maxRetries}`);
          await this.sleep(500 * attempt); // Longer backoff
          continue;
        }
        
        console.error(`❌ Error storing NFT #${nftData.tokenId}:`, error);
        throw error;
      }
    }
    
    throw lastError;
  }

  /**
   * Handle metadata refresh
   * Requirements: 1.4
   */
  async refreshNFTMetadata(
    contractAddress: string,
    tokenId: string
  ): Promise<void> {
    try {
      console.log(`🔄 Refreshing metadata for ${contractAddress} token ${tokenId}`);

      // Trigger Alchemy refresh
      await this.alchemyService.refreshNFTMetadata(contractAddress, tokenId);

      // Wait a bit for Alchemy to process
      await this.sleep(2000);

      // Fetch updated metadata
      const nft = await prisma.nFT.findUnique({
        where: {
          contractAddress_tokenId_chainId: {
            contractAddress: contractAddress.toLowerCase(),
            tokenId,
            chainId: this.context.chainId
          }
        }
      });

      if (nft) {
        await this.syncNFTMetadata(contractAddress, tokenId, nft.tokenType as 'ERC721' | 'ERC1155');
      }

      console.log(`✅ Metadata refreshed for token ${tokenId}`);
    } catch (error) {
      console.error(`❌ Error refreshing metadata:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // TASK 4.5: Ownership Tracking
  // ==========================================================================

  /**
   * Update current ownership on transfers
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
   */
  private async updateOwnership(
    contractAddress: string,
    tokenId: string,
    newOwner: string,
    quantity: string,
    txInfo: {
      txHash: string;
      blockNumber: number;
      blockTimestamp: Date;
    },
    previousOwner?: string
  ): Promise<void> {
    try {
      // Get NFT
      const nft = await prisma.nFT.findUnique({
        where: {
          contractAddress_tokenId_chainId: {
            contractAddress,
            tokenId,
            chainId: this.context.chainId
          }
        },
        select: { id: true, tokenType: true }
      });

      if (!nft) {
        console.warn(`⚠️ NFT not found for ownership update: ${contractAddress} token ${tokenId}`);
        return;
      }

      // Mark previous ownership as not current (Requirement 3.5)
      if (previousOwner) {
        await prisma.nFTOwnership.updateMany({
          where: {
            nftId: nft.id,
            ownerAddress: previousOwner,
            isCurrent: true
          },
          data: {
            isCurrent: false
          }
        });
      } else {
        // For mints, mark all previous ownerships as not current
        await prisma.nFTOwnership.updateMany({
          where: {
            nftId: nft.id,
            isCurrent: true
          },
          data: {
            isCurrent: false
          }
        });
      }

      // Create new ownership record (Requirements 3.1, 3.2, 3.3, 3.4)
      await prisma.nFTOwnership.create({
        data: {
          nftId: nft.id,
          ownerAddress: newOwner,
          balance: quantity,
          acquiredAt: txInfo.blockTimestamp,
          acquiredBlock: txInfo.blockNumber,
          acquiredTxHash: txInfo.txHash,
          isCurrent: true
        }
      });
    } catch (error) {
      console.error(`❌ Error updating ownership token ${tokenId}:`, error);
      throw error;
    }
  }

  /**
   * Remove ownership (for burns)
   */
  private async removeOwnership(
    contractAddress: string,
    tokenId: string,
    owner: string
  ): Promise<void> {
    try {
      const nft = await prisma.nFT.findUnique({
        where: {
          contractAddress_tokenId_chainId: {
            contractAddress,
            tokenId,
            chainId: this.context.chainId
          }
        },
        select: { id: true }
      });

      if (!nft) {
        return;
      }

      // Mark all ownerships as not current
      await prisma.nFTOwnership.updateMany({
        where: {
          nftId: nft.id,
          isCurrent: true
        },
        data: {
          isCurrent: false
        }
      });

      console.log(`🔥 Ownership removed for burned token ${tokenId}`);
    } catch (error) {
      console.error(`❌ Error removing ownership:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // TASK 4.7: Contract Metadata Syncing
  // ==========================================================================

  /**
   * Ensure contract exists in database, fetch if not
   * Requirements: 2.1, 2.2, 2.3, 2.4
   */
  private async ensureContractExists(
    contractAddress: string,
    tokenType: 'ERC721' | 'ERC1155'
  ): Promise<void> {
    try {
      const existing = await prisma.nFTContract.findUnique({
        where: {
          address_chainId: {
            address: contractAddress,
            chainId: this.context.chainId
          }
        }
      });

      if (!existing) {
        await this.syncContractMetadata(contractAddress, tokenType);
      }
    } catch (error) {
      console.error(`❌ Error ensuring contract exists:`, error);
      throw error;
    }
  }

  /**
   * Fetch and store contract metadata
   * Requirements: 2.1, 2.2, 2.3, 2.4
   * 
   * UPDATED: Now uses RPC + IPFS instead of Alchemy to avoid API limits
   */
  async syncContractMetadata(
    contractAddress: string,
    tokenType?: 'ERC721' | 'ERC1155'
  ): Promise<void> {
    try {
      console.log(`🔍 Fetching contract metadata for ${contractAddress} via RPC`);

      // Try to fetch from blockchain RPC first (no Alchemy dependency)
      const metadata = await this.fetchContractMetadataFromRPC(contractAddress, tokenType);

      // Store in database
      await this.storeContractData(metadata);

      console.log(`✅ Contract metadata synced via RPC: ${metadata.name || contractAddress}`);
    } catch (error) {
      console.error(`❌ Error syncing contract metadata:`, error);
      // Create minimal contract record as fallback
      await this.createMinimalContract(contractAddress, tokenType);
    }
  }

  /**
   * Fetch contract metadata from blockchain RPC (no Alchemy)
   */
  private async fetchContractMetadataFromRPC(
    contractAddress: string,
    tokenType?: 'ERC721' | 'ERC1155'
  ): Promise<MappedContractData> {
    // Get provider from cache or create new one
    const rpcUrl = process.env[`CHAIN_${this.context.chainId}_RPC_URL`] || process.env.RPC_URL || '';
    const provider = this.getProvider(this.context.chainId, rpcUrl);
    
    const contract = new ethers.Contract(
      contractAddress,
      [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function totalSupply() view returns (uint256)',
        'function owner() view returns (address)',
        'function contractURI() view returns (string)',
      ],
      provider
    );

    // Fetch basic contract info from RPC
    const [name, symbol, totalSupply, owner, contractURI] = await Promise.allSettled([
      contract.name(),
      contract.symbol(),
      contract.totalSupply(),
      contract.owner().catch(() => null),
      contract.contractURI().catch(() => null),
    ]);

    // Extract values from settled promises
    const contractName = name.status === 'fulfilled' ? name.value : 'Unknown';
    const contractSymbol = symbol.status === 'fulfilled' ? symbol.value : 'UNKNOWN';
    const contractTotalSupply = totalSupply.status === 'fulfilled' ? totalSupply.value.toString() : '0';
    const contractOwner = owner.status === 'fulfilled' ? owner.value : null;
    const contractURIValue = contractURI.status === 'fulfilled' ? contractURI.value : null;

    // Try to fetch additional metadata from contractURI if available
    let imageUrl: string | null = null;
    let description: string | null = null;

    if (contractURIValue) {
      try {
        const metadata = await this.fetchContractMetadata(contractURIValue);
        imageUrl = metadata?.image || null;
        description = metadata?.description || null;
      } catch (metadataError) {
        console.warn(`⚠️ Failed to fetch contractURI metadata:`, metadataError);
      }
    }

    // Build mapped contract data
    const mappedData: MappedContractData = {
      address: contractAddress.toLowerCase(),
      chainId: this.context.chainId,
      name: contractName,
      symbol: contractSymbol,
      totalSupply: contractTotalSupply,
      tokenType: tokenType || 'ERC721',
      contractDeployer: contractOwner || null,
      deployedBlockNumber: null,
      openSeaFloorPrice: null,
      openSeaCollectionName: null,
      openSeaCollectionSlug: null,
      openSeaSafelistStatus: null,
      openSeaImageUrl: imageUrl,
      openSeaDescription: description,
      openSeaExternalUrl: null,
      openSeaTwitter: null,
      openSeaDiscord: null,
      openSeaBannerImageUrl: null,
      openSeaLastIngestedAt: null,
    };

    return mappedData;
  }

  /**
   * Store contract data in database
   */
  private async storeContractData(contractData: MappedContractData): Promise<void> {
    try {
      await prisma.nFTContract.upsert({
        where: {
          address_chainId: {
            address: contractData.address,
            chainId: contractData.chainId
          }
        },
        create: contractData,
        update: {
          ...contractData,
          updatedAt: new Date()
        }
      });

      console.log(`📝 Contract data stored: ${contractData.address}`);
    } catch (error) {
      console.error(`❌ Error storing contract data:`, error);
      throw error;
    }
  }

  /**
   * Create minimal contract record when Alchemy fails
   */
  private async createMinimalContract(
    contractAddress: string,
    tokenType?: 'ERC721' | 'ERC1155'
  ): Promise<void> {
    try {
      await prisma.nFTContract.upsert({
        where: {
          address_chainId: {
            address: contractAddress,
            chainId: this.context.chainId
          }
        },
        create: {
          address: contractAddress,
          chainId: this.context.chainId,
          tokenType: tokenType || 'UNKNOWN'
        },
        update: {}
      });

      console.log(`📝 Minimal contract record created: ${contractAddress}`);
    } catch (error) {
      console.error(`❌ Error creating minimal contract:`, error);
      throw error;
    }
  }

  /**
   * Create minimal NFT metadata when all fetch methods fail
   */
  private createMinimalNFTMetadata(
    contractAddress: string,
    tokenId: string,
    tokenType?: 'ERC721' | 'ERC1155'
  ): MappedNFTData {
    return {
      chainId: this.context.chainId,
      contractAddress: contractAddress.toLowerCase(),
      tokenId: tokenId,
      tokenType: tokenType || 'ERC721',
      name: `Token #${tokenId}`,
      description: null,
      tokenUri: null,
      imageCachedUrl: null,
      imageThumbnailUrl: null,
      imagePngUrl: null,
      imageContentType: null,
      imageSize: null,
      imageOriginalUrl: null,
      rawMetadata: null,
      rawTokenUri: null,
      timeLastUpdated: new Date(),
      acquiredBlockTimestamp: null,
      acquiredBlockNumber: null,
      mintAddress: null,
      mintBlockNumber: null,
      mintTimestamp: null,
      mintTransactionHash: null,
      isSpam: false,
      isAirdrop: false
    };
  }

  /**
   * Update OpenSea metadata
   * Requirements: 2.3
   * 
   * UPDATED: Skip if Alchemy not available (optional feature)
   */
  async updateOpenSeaMetadata(contractAddress: string): Promise<void> {
    // Skip if Alchemy is not supported for this chain
    if (!this.isAlchemySupported) {
      console.log(`⏭️ Skipping OpenSea metadata update (Alchemy not supported for chain ${this.context.chainId})`);
      return;
    }

    try {
      console.log(`🔄 Updating OpenSea metadata for ${contractAddress}`);

      // Fetch fresh metadata from Alchemy
      const alchemyMetadata = await this.alchemyService.getContractMetadata(contractAddress);
      const mappedData = mapContractMetadata(alchemyMetadata as any, this.context.chainId);

      // Update only OpenSea fields
      await prisma.nFTContract.update({
        where: {
          address_chainId: {
            address: contractAddress,
            chainId: this.context.chainId
          }
        },
        data: {
          openSeaFloorPrice: mappedData.openSeaFloorPrice,
          openSeaCollectionName: mappedData.openSeaCollectionName,
          openSeaCollectionSlug: mappedData.openSeaCollectionSlug,
          openSeaSafelistStatus: mappedData.openSeaSafelistStatus,
          openSeaImageUrl: mappedData.openSeaImageUrl,
          openSeaDescription: mappedData.openSeaDescription,
          openSeaExternalUrl: mappedData.openSeaExternalUrl,
          openSeaTwitter: mappedData.openSeaTwitter,
          openSeaDiscord: mappedData.openSeaDiscord,
          openSeaBannerImageUrl: mappedData.openSeaBannerImageUrl,
          openSeaLastIngestedAt: mappedData.openSeaLastIngestedAt,
          updatedAt: new Date()
        }
      });

      console.log(`✅ OpenSea metadata updated`);
    } catch (error: any) {
      // Don't throw error if it's just Alchemy limit - this is optional metadata
      if (error.message?.includes('capacity limit exceeded')) {
        console.warn(`⚠️ Alchemy capacity limit exceeded, skipping OpenSea metadata update`);
      } else {
        console.error(`❌ Error updating OpenSea metadata:`, error);
      }
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Determine transfer type based on from/to addresses
   */
  private determineTransferType(from: string, to: string): TransferType {
    const zeroAddress = ethers.ZeroAddress.toLowerCase();
    
    if (from === zeroAddress) {
      return TransferType.MINT;
    } else if (to === zeroAddress) {
      return TransferType.BURN;
    } else {
      return TransferType.TRANSFER;
    }
  }

  /**
   * Check if transfer already exists
   */
  private async isDuplicateTransfer(txHash: string, logIndex: number): Promise<boolean> {
    const existing = await prisma.nFTTransfer.findUnique({
      where: {
        txHash_logIndex: {
          txHash,
          logIndex
        }
      }
    });

    return !!existing;
  }

  /**
   * Check if NFT exists in database
   */
  private async nftExists(contractAddress: string, tokenId: string): Promise<boolean> {
    const nft = await prisma.nFT.findUnique({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress,
          tokenId,
          chainId: this.context.chainId
        }
      }
    });

    return !!nft;
  }

  /**
   * Increment contract supply
   */
  private async incrementContractSupply(contractAddress: string, quantity: number): Promise<void> {
    try {
      const contract = await prisma.nFTContract.findUnique({
        where: {
          address_chainId: {
            address: contractAddress,
            chainId: this.context.chainId
          }
        }
      });

      if (contract && contract.totalSupply) {
        const newSupply = (BigInt(contract.totalSupply) + BigInt(quantity)).toString();
        await prisma.nFTContract.update({
          where: {
            address_chainId: {
              address: contractAddress,
              chainId: this.context.chainId
            }
          },
          data: {
            totalSupply: newSupply
          }
        });
      }
    } catch (error) {
      console.error(`❌ Error incrementing contract supply:`, error);
      // Don't throw - not critical
    }
  }

  /**
   * Decrement contract supply
   */
  private async decrementContractSupply(contractAddress: string, quantity: number): Promise<void> {
    try {
      const contract = await prisma.nFTContract.findUnique({
        where: {
          address_chainId: {
            address: contractAddress,
            chainId: this.context.chainId
          }
        }
      });

      if (contract && contract.totalSupply) {
        const currentSupply = BigInt(contract.totalSupply);
        const newSupply = currentSupply > BigInt(quantity) 
          ? (currentSupply - BigInt(quantity)).toString()
          : '0';
        
        await prisma.nFTContract.update({
          where: {
            address_chainId: {
              address: contractAddress,
              chainId: this.context.chainId
            }
          },
          data: {
            totalSupply: newSupply
          }
        });
      }
    } catch (error) {
      console.error(`❌ Error decrementing contract supply:`, error);
      // Don't throw - not critical
    }
  }

  /**
   * Decrement nft_collection_analytics totalSupply
   * Requirement 2.5
   */
  private async decrementCollectionAnalyticsSupply(contractAddress: string, quantity: number): Promise<void> {
    try {
      const analytics = await prisma.nFTCollectionAnalytics.findUnique({
        where: {
          contractAddress_chainId: {
            contractAddress,
            chainId: this.context.chainId
          }
        }
      });

      if (analytics) {
        const currentSupply = analytics.totalSupply;
        const newSupply = currentSupply > quantity ? currentSupply - quantity : 0;
        
        await prisma.nFTCollectionAnalytics.update({
          where: {
            contractAddress_chainId: {
              contractAddress,
              chainId: this.context.chainId
            }
          },
          data: {
            totalSupply: newSupply,
            calculatedAt: new Date()
          }
        });
        
        console.log(`📊 Collection analytics supply decremented: ${currentSupply} → ${newSupply}`);
      }
    } catch (error) {
      console.error(`❌ Error decrementing collection analytics supply:`, error);
      // Don't throw - not critical
    }
  }

  /**
   * Decrement launchpad mintedCount if applicable
   * Requirement 2.6
   */
  private async decrementLaunchpadMintedCount(contractAddress: string, quantity: number): Promise<void> {
    try {
      const launchpad = await prisma.launchpad.findUnique({
        where: {
          contractAddress: contractAddress.toLowerCase()
        }
      });

      if (launchpad) {
        const currentCount = launchpad.mintedCount;
        const newCount = currentCount > quantity ? currentCount - quantity : 0;
        
        await prisma.launchpad.update({
          where: {
            contractAddress: contractAddress.toLowerCase()
          },
          data: {
            mintedCount: newCount,
            updatedAt: new Date()
          }
        });
        
        console.log(`🚀 Launchpad mintedCount decremented: ${currentCount} → ${newCount}`);
      }
    } catch (error) {
      console.error(`❌ Error decrementing launchpad mintedCount:`, error);
      // Don't throw - not critical
    }
  }

  /**
   * Create activity record for burn event
   * Requirement 2.3
   */
  private async createBurnActivity(transferData: TransferEventData): Promise<void> {
    try {
      // Check if launchpad exists for this contract
      const launchpad = await prisma.launchpad.findUnique({
        where: {
          contractAddress: transferData.contractAddress.toLowerCase()
        },
        select: { id: true, name: true }
      });

      // Fetch NFT image before creating activity
      const nft = await prisma.nFT.findUnique({
        where: {
          contractAddress_tokenId_chainId: {
            contractAddress: transferData.contractAddress.toLowerCase(),
            tokenId: transferData.tokenId,
            chainId: this.context.chainId,
          },
        },
        select: {
          imageCachedUrl: true,
          imageOriginalUrl: true,
          imageThumbnailUrl: true,
        },
      });

      // Use NFT image (prioritize cached, then thumbnail, then original)
      const tokenImage = nft?.imageCachedUrl || nft?.imageThumbnailUrl || nft?.imageOriginalUrl || null;

      await prisma.activity.create({
        data: {
          chainId: this.context.chainId,
          launchpadId: launchpad?.id || null,
          type: 'BURN_OCCURRED',
          actor: transferData.from,
          description: `Token #${transferData.tokenId} burned from ${this.truncateAddress(transferData.from)}`,
          txHash: transferData.txHash,
          blockNumber: transferData.blockNumber,
          metadata: {
            contractAddress: transferData.contractAddress,
            tokenId: transferData.tokenId,
            quantity: transferData.quantity,
            from: transferData.from,
            blockTimestamp: transferData.blockTimestamp.toISOString(),
            tokenImage, // Add NFT individual image
            originalImage: nft?.imageOriginalUrl || null, // Add original IPFS URL
          }
        }
      });
      
      console.log(`📝 Burn activity record created`);
    } catch (error) {
      console.error(`❌ Error creating burn activity:`, error);
      // Don't throw - not critical
    }
  }

  /**
   * Update collection analytics after transfer events
   * Requirements: 1.8, 1.9, 2.7, 16.1, 16.2, 16.3, 16.4, 16.5
   * 
   * Uses upsert operations to handle missing analytics records gracefully (Requirement 16.4)
   * Updates nft_collection_analytics after mint, burn, transfer, sale (Requirements 16.1, 16.2, 16.3)
   * Updates launchpad_analytics after mint, burn (Requirement 16.2)
   */
  private async updateCollectionAnalytics(contractAddress: string): Promise<void> {
    try {
      console.log(`📊 Updating collection analytics for ${contractAddress}`);

      // Calculate unique holders from nft_ownership table (Requirement 16.5)
      const uniqueHolders = await prisma.nFTOwnership.groupBy({
        by: ['ownerAddress'],
        where: {
          nft: {
            contractAddress,
            chainId: this.context.chainId
          },
          isCurrent: true
        },
        _count: true
      });

      const holderCount = uniqueHolders.length;

      // Calculate total supply from NFT records
      const totalSupply = await prisma.nFT.count({
        where: {
          contractAddress,
          chainId: this.context.chainId
        }
      });

      // Get current analytics to preserve existing data
      const currentAnalytics = await prisma.nFTCollectionAnalytics.findUnique({
        where: {
          contractAddress_chainId: {
            contractAddress,
            chainId: this.context.chainId
          }
        }
      });

      // Update nft_collection_analytics with upsert (Requirements 16.1, 16.4)
      await prisma.nFTCollectionAnalytics.upsert({
        where: {
          contractAddress_chainId: {
            contractAddress,
            chainId: this.context.chainId
          }
        },
        create: {
          contractAddress,
          chainId: this.context.chainId,
          uniqueHolders: holderCount,
          totalSupply: totalSupply,
          totalVolume: '0',
          volume24h: '0',
          volume7d: '0',
          volume30d: '0',
          totalSales: 0,
          sales24h: 0,
          sales7d: 0,
          sales30d: 0,
          lastSalePrice: undefined,
          avgSalePrice: undefined,
          highestSale: undefined,
          floorPrice: undefined,
          calculatedAt: new Date()
        },
        update: {
          uniqueHolders: holderCount,
          totalSupply: totalSupply,
          calculatedAt: new Date(),
          // Preserve existing sales/volume data
          totalVolume: currentAnalytics?.totalVolume || '0',
          volume24h: currentAnalytics?.volume24h || '0',
          volume7d: currentAnalytics?.volume7d || '0',
          volume30d: currentAnalytics?.volume30d || '0',
          totalSales: currentAnalytics?.totalSales || 0,
          sales24h: currentAnalytics?.sales24h || 0,
          sales7d: currentAnalytics?.sales7d || 0,
          sales30d: currentAnalytics?.sales30d || 0,
          lastSalePrice: currentAnalytics?.lastSalePrice || undefined,
          avgSalePrice: currentAnalytics?.avgSalePrice || undefined,
          highestSale: currentAnalytics?.highestSale || undefined,
          floorPrice: currentAnalytics?.floorPrice || undefined
        }
      });

      console.log(`✅ Collection analytics updated: ${holderCount} unique holders, ${totalSupply} total supply`);

      // Update launchpad_analytics if this is a launchpad contract (Requirements 16.2, 16.4)
      const launchpad = await prisma.launchpad.findUnique({
        where: {
          contractAddress: contractAddress.toLowerCase()
        },
        select: { id: true }
      });

      if (launchpad) {
        // Get current launchpad analytics to preserve existing data
        const currentLaunchpadAnalytics = await prisma.launchpadAnalytics.findUnique({
          where: {
            launchpadId: launchpad.id
          }
        });

        await prisma.launchpadAnalytics.upsert({
          where: {
            launchpadId: launchpad.id
          },
          create: {
            launchpadId: launchpad.id,
            uniqueHolders: holderCount,
            totalVolume: '0',
            totalMints: 0,
            calculatedAt: new Date()
          },
          update: {
            uniqueHolders: holderCount,
            calculatedAt: new Date(),
            // Preserve existing data
            totalVolume: currentLaunchpadAnalytics?.totalVolume || '0',
            totalMints: currentLaunchpadAnalytics?.totalMints || 0
          }
        });

        console.log(`✅ Launchpad analytics updated: ${holderCount} unique holders`);
      }
    } catch (error) {
      console.error(`❌ Error updating collection analytics:`, error);
      // Don't throw - not critical, but log for monitoring
      await this.logEventError('updateCollectionAnalytics', error, { contractAddress });
    }
  }

  // ==========================================================================
  // Batch Processing Support
  // ==========================================================================

  /**
   * Process multiple transfer events in batch
   * Requirements: 17.1, 17.2, 17.3, 17.5
   * 
   * Processes events in batches of 100 items (Requirement 17.1)
   * Maintains transaction atomicity per batch (Requirement 17.2)
   * Retries individual items from failed batches (Requirement 17.3)
   * Updates analytics once per batch instead of per event (Requirement 17.5)
   */
  async handleTransferEventBatch(transferEvents: TransferEventData[]): Promise<void> {
    const BATCH_SIZE = 100;
    const contractAddresses = new Set<string>();
    const failedItems: TransferEventData[] = [];

    console.log(`📦 Processing ${transferEvents.length} transfer events in batches of ${BATCH_SIZE}`);

    // Process in chunks of BATCH_SIZE
    for (let i = 0; i < transferEvents.length; i += BATCH_SIZE) {
      const batch = transferEvents.slice(i, i + BATCH_SIZE);
      
      try {
        // Process batch within transaction (Requirement 17.2)
        await prisma.$transaction(async (tx) => {
          for (const transferData of batch) {
            try {
              // Validate and normalize
              this.validateEventData(transferData, [
                'contractAddress',
                'tokenId',
                'from',
                'to',
                'txHash',
                'blockNumber',
                'blockTimestamp'
              ]);

              const normalizedData = {
                ...transferData,
                contractAddress: transferData.contractAddress.toLowerCase(),
                from: transferData.from.toLowerCase(),
                to: transferData.to.toLowerCase()
              };

              // Track contract for analytics update
              contractAddresses.add(normalizedData.contractAddress);

              // Determine transfer type
              const transferType = this.determineTransferType(normalizedData.from, normalizedData.to);

              // Check for duplicate
              const isDuplicate = await this.isDuplicateTransfer(
                normalizedData.txHash,
                normalizedData.logIndex
              );

              if (isDuplicate) {
                console.log(`⚠️ Duplicate transfer in batch, skipping: ${normalizedData.txHash}`);
                continue;
              }

              // Process based on transfer type
              switch (transferType) {
                case TransferType.MINT:
                  await this.handleMintInTransaction(tx, normalizedData);
                  break;
                case TransferType.BURN:
                  await this.handleBurnInTransaction(tx, normalizedData);
                  break;
                case TransferType.TRANSFER:
                  await this.handleRegularTransferInTransaction(tx, normalizedData);
                  break;
              }

              // Create transfer record
              await this.createTransferRecordInTransaction(tx, normalizedData, transferType);
            } catch (error) {
              console.error(`❌ Error processing transfer in batch:`, error);
              // Track failed item for retry (Requirement 17.3)
              failedItems.push(transferData);
              // Log but continue with other items in batch
              await this.logEventError('handleTransferEventBatch', error, transferData);
            }
          }
        });

        console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1} processed: ${batch.length} transfers`);
      } catch (error) {
        console.error(`❌ Batch transaction failed:`, error);
        await this.logEventError('handleTransferEventBatch', error, { batchIndex: i, batchSize: batch.length });
        
        // Add all items from failed batch to retry list (Requirement 17.3)
        failedItems.push(...batch);
      }
    }

    // Retry individual items from failed batches (Requirement 17.3)
    if (failedItems.length > 0) {
      console.log(`🔄 Retrying ${failedItems.length} failed items individually`);
      await this.retryFailedTransfers(failedItems, contractAddresses);
    }

    // Update analytics once per batch for all affected contracts (Requirement 17.5)
    console.log(`📊 Updating analytics for ${contractAddresses.size} contracts`);
    for (const contractAddress of contractAddresses) {
      try {
        await this.updateCollectionAnalytics(contractAddress);
      } catch (error) {
        console.error(`❌ Error updating analytics for ${contractAddress}:`, error);
        // Continue with other contracts
      }
    }

    console.log(`✅ Batch processing complete: ${transferEvents.length} transfers processed, ${failedItems.length} failed`);
  }

  /**
   * Retry individual items from failed batches
   * Requirement: 17.3
   * 
   * Tracks which items succeeded and which failed
   * Continues processing successful items
   */
  private async retryFailedTransfers(
    failedItems: TransferEventData[],
    contractAddresses: Set<string>
  ): Promise<void> {
    let successCount = 0;
    let failCount = 0;

    for (const transferData of failedItems) {
      try {
        // Validate and normalize
        this.validateEventData(transferData, [
          'contractAddress',
          'tokenId',
          'from',
          'to',
          'txHash',
          'blockNumber',
          'blockTimestamp'
        ]);

        const normalizedData = {
          ...transferData,
          contractAddress: transferData.contractAddress.toLowerCase(),
          from: transferData.from.toLowerCase(),
          to: transferData.to.toLowerCase()
        };

        // Track contract for analytics update
        contractAddresses.add(normalizedData.contractAddress);

        // Determine transfer type
        const transferType = this.determineTransferType(normalizedData.from, normalizedData.to);

        // Check for duplicate
        const isDuplicate = await this.isDuplicateTransfer(
          normalizedData.txHash,
          normalizedData.logIndex
        );

        if (isDuplicate) {
          console.log(`⚠️ Duplicate transfer in retry, skipping: ${normalizedData.txHash}`);
          successCount++; // Count as success since it's already processed
          continue;
        }

        // Process in individual transaction
        await prisma.$transaction(async (tx) => {
          // Process based on transfer type
          switch (transferType) {
            case TransferType.MINT:
              await this.handleMintInTransaction(tx, normalizedData);
              break;
            case TransferType.BURN:
              await this.handleBurnInTransaction(tx, normalizedData);
              break;
            case TransferType.TRANSFER:
              await this.handleRegularTransferInTransaction(tx, normalizedData);
              break;
          }

          // Create transfer record
          await this.createTransferRecordInTransaction(tx, normalizedData, transferType);
        });

        successCount++;
        console.log(`✅ Retry successful: ${normalizedData.txHash}`);
      } catch (error) {
        failCount++;
        console.error(`❌ Retry failed for transfer:`, error);
        await this.logEventError('retryFailedTransfers', error, transferData);
        // Continue with other items
      }
    }

    console.log(`🔄 Retry complete: ${successCount} succeeded, ${failCount} failed`);
  }

  /**
   * Handle mint within a transaction (for batch processing)
   */
  private async handleMintInTransaction(tx: any, transferData: TransferEventData): Promise<void> {
    // Ensure contract exists
    await this.ensureContractExistsInTransaction(tx, transferData.contractAddress, transferData.tokenType);

    // Sync NFT metadata (outside transaction for performance)
    // This will be handled separately for batch operations

    // Update ownership
    await this.updateOwnershipInTransaction(
      tx,
      transferData.contractAddress,
      transferData.tokenId,
      transferData.to,
      transferData.quantity,
      {
        txHash: transferData.txHash,
        blockNumber: transferData.blockNumber,
        blockTimestamp: transferData.blockTimestamp
      }
    );
  }

  /**
   * Handle burn within a transaction (for batch processing)
   */
  private async handleBurnInTransaction(tx: any, transferData: TransferEventData): Promise<void> {
    // Remove ownership
    await this.removeOwnershipInTransaction(
      tx,
      transferData.contractAddress,
      transferData.tokenId,
      transferData.from
    );

    // Decrement supplies (handled outside transaction for performance)
  }

  /**
   * Handle regular transfer within a transaction (for batch processing)
   */
  private async handleRegularTransferInTransaction(tx: any, transferData: TransferEventData): Promise<void> {
    // Update ownership
    await this.updateOwnershipInTransaction(
      tx,
      transferData.contractAddress,
      transferData.tokenId,
      transferData.to,
      transferData.quantity,
      {
        txHash: transferData.txHash,
        blockNumber: transferData.blockNumber,
        blockTimestamp: transferData.blockTimestamp
      },
      transferData.from
    );
  }

  /**
   * Create transfer record within a transaction (for batch processing)
   */
  private async createTransferRecordInTransaction(
    tx: any,
    transferData: TransferEventData,
    transferType: TransferType
  ): Promise<void> {
    // Get NFT ID
    const nft = await tx.nFT.findUnique({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress: transferData.contractAddress,
          tokenId: transferData.tokenId,
          chainId: this.context.chainId
        }
      },
      select: { id: true }
    });

    if (!nft) {
      console.warn(`⚠️ NFT not found for transfer record: ${transferData.contractAddress} token ${transferData.tokenId}`);
      return;
    }

    // Create transfer record
    try {
      await tx.nFTTransfer.create({
        data: {
          chainId: this.context.chainId,
          nftId: nft.id,
          fromAddress: transferData.from,
          toAddress: transferData.to,
          quantity: transferData.quantity,
          txHash: transferData.txHash,
          blockNumber: transferData.blockNumber,
          blockTimestamp: transferData.blockTimestamp,
          logIndex: transferData.logIndex,
          transferType
        }
      });
    } catch (error: any) {
      // Handle unique constraint violation gracefully
      if (error.code === 'P2002' || error.message?.includes('Unique constraint')) {
        console.log(`🔄 Transfer record already exists (race condition): ${transferType} ${transferData.tokenId}`);
        return;
      }
      throw error;
    }
  }

  /**
   * Ensure contract exists within a transaction (for batch processing)
   */
  private async ensureContractExistsInTransaction(
    tx: any,
    contractAddress: string,
    tokenType: 'ERC721' | 'ERC1155'
  ): Promise<void> {
    const existing = await tx.nFTContract.findUnique({
      where: {
        address_chainId: {
          address: contractAddress,
          chainId: this.context.chainId
        }
      }
    });

    if (!existing) {
      await tx.nFTContract.create({
        data: {
          address: contractAddress,
          chainId: this.context.chainId,
          tokenType: tokenType || 'UNKNOWN'
        }
      });
    }
  }

  /**
   * Update ownership within a transaction (for batch processing)
   */
  private async updateOwnershipInTransaction(
    tx: any,
    contractAddress: string,
    tokenId: string,
    newOwner: string,
    quantity: string,
    txInfo: {
      txHash: string;
      blockNumber: number;
      blockTimestamp: Date;
    },
    previousOwner?: string
  ): Promise<void> {
    // Get NFT
    const nft = await tx.nFT.findUnique({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress,
          tokenId,
          chainId: this.context.chainId
        }
      },
      select: { id: true, tokenType: true }
    });

    if (!nft) {
      console.warn(`⚠️ NFT not found for ownership update: ${contractAddress} token ${tokenId}`);
      return;
    }

    // Mark previous ownership as not current
    if (previousOwner) {
      await tx.nFTOwnership.updateMany({
        where: {
          nftId: nft.id,
          ownerAddress: previousOwner,
          isCurrent: true
        },
        data: {
          isCurrent: false
        }
      });
    } else {
      // For mints, mark all previous ownerships as not current
      await tx.nFTOwnership.updateMany({
        where: {
          nftId: nft.id,
          isCurrent: true
        },
        data: {
          isCurrent: false
        }
      });
    }

    // Create new ownership record
    await tx.nFTOwnership.create({
      data: {
        nftId: nft.id,
        ownerAddress: newOwner,
        balance: quantity,
        acquiredAt: txInfo.blockTimestamp,
        acquiredBlock: txInfo.blockNumber,
        acquiredTxHash: txInfo.txHash,
        isCurrent: true
      }
    });
  }

  /**
   * Remove ownership within a transaction (for batch processing)
   */
  private async removeOwnershipInTransaction(
    tx: any,
    contractAddress: string,
    tokenId: string,
    owner: string
  ): Promise<void> {
    const nft = await tx.nFT.findUnique({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress,
          tokenId,
          chainId: this.context.chainId
        }
      },
      select: { id: true }
    });

    if (!nft) {
      return;
    }

    // Mark all ownerships as not current
    await tx.nFTOwnership.updateMany({
      where: {
        nftId: nft.id,
        isCurrent: true
      },
      data: {
        isCurrent: false
      }
    });
  }

  /**
   * Fetch collection metadata from contractURI (IPFS or HTTP)
   * Used to extract image, name, description for LaunchpadMetadata
   */
  private async fetchContractMetadata(contractURI: string): Promise<{
    image?: string;
    name?: string;
    description?: string;
    external_link?: string;
  } | null> {
    if (!contractURI) return null;
    
    try {
      let fetchUrl = contractURI;
      
      // Convert IPFS URL to HTTP gateway using fastest gateway
      if (contractURI.startsWith('ipfs://')) {
        const { ipfsToHttpOptimized } = await import('../../../utils/ipfs-helpers');
        fetchUrl = await ipfsToHttpOptimized(contractURI) || contractURI;
      }
      
      console.log(`📥 Fetching contract metadata from: ${fetchUrl}`);
      
      const response = await fetch(fetchUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'NFT-Listener-Service/1.0'
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      
      if (!response.ok) {
        console.warn(`⚠️ Failed to fetch contract metadata: ${response.status} ${response.statusText}`);
        return null;
      }
      
      const metadata = await response.json() as any;
      console.log(`✅ Contract metadata fetched successfully:`, {
        name: metadata.name,
        hasImage: !!metadata.image,
        hasDescription: !!metadata.description
      });
      
      return {
        image: metadata.image,
        name: metadata.name,
        description: metadata.description,
        external_link: metadata.external_link
      };
    } catch (error) {
      console.error(`❌ Error fetching contract metadata from ${contractURI}:`, error);
      return null;
    }
  }

  /**
   * Sync collection image from contractURI or first minted NFT to LaunchpadMetadata
   * Priority: 1. contractURI image, 2. NFT image, 3. First minted NFT image
   * For Standard Collection, this ensures collection metadata is properly populated
   */
  async syncCollectionImage(contractAddress: string, nftImageUrl?: string): Promise<void> {
    try {
      const normalizedAddress = contractAddress.toLowerCase();
      
      // Get launchpad with metadata
      const launchpad = await prisma.launchpad.findUnique({
        where: { contractAddress: normalizedAddress },
        include: { metadata: true }
      });

      if (!launchpad) {
        console.log(`⚠️ Launchpad not found for collection image sync: ${normalizedAddress}`);
        return;
      }

      // Skip if metadata already has an image
      if (launchpad.metadata?.image) {
        console.log(`✅ Collection image already exists for ${normalizedAddress}`);
        return;
      }

      let collectionImage: string | null = null;

      // Priority 1: Try to fetch from contractURI (for Standard Collection)
      if (launchpad.contractURI) {
        console.log(`📥 Attempting to fetch collection image from contractURI: ${launchpad.contractURI}`);
        const contractMetadata = await this.fetchContractMetadata(launchpad.contractURI);
        
        if (contractMetadata?.image) {
          collectionImage = contractMetadata.image;
          // Handle IPFS image URL
          if (collectionImage.startsWith('ipfs://')) {
            collectionImage = await ipfsToHttpOptimized(collectionImage) || collectionImage;
          }
          console.log(`✅ Collection image extracted from contractURI: ${collectionImage}`);
        }
      }

      // Priority 2: Use provided NFT image URL if contractURI didn't have image
      if (!collectionImage && nftImageUrl) {
        collectionImage = nftImageUrl;
        // Handle IPFS image URL
        if (collectionImage.startsWith('ipfs://')) {
          collectionImage = await ipfsToHttpOptimized(collectionImage) || collectionImage;
        }
        console.log(`📷 Using provided NFT image as collection image: ${collectionImage}`);
      }

      // Priority 3: If no image yet, try to get from first minted NFT
      if (!collectionImage) {
        const firstNft = await prisma.nFT.findFirst({
          where: {
            contractAddress: normalizedAddress,
            chainId: this.context.chainId
          },
          orderBy: { tokenId: 'asc' },
          select: { imageCachedUrl: true, imageOriginalUrl: true }
        });
        
        collectionImage = firstNft?.imageCachedUrl || firstNft?.imageOriginalUrl || null;
        
        if (collectionImage) {
          console.log(`📷 Using first NFT image as collection image: ${collectionImage}`);
        }
      }

      if (!collectionImage) {
        console.log(`ℹ️ No image available for collection ${normalizedAddress}`);
        return;
      }

      // Upsert LaunchpadMetadata with collection image
      await prisma.launchpadMetadata.upsert({
        where: { launchpadId: launchpad.id },
        create: {
          launchpadId: launchpad.id,
          image: collectionImage
        },
        update: {
          image: collectionImage
        }
      });

      console.log(`✅ Collection image synced for ${normalizedAddress}: ${collectionImage}`);

      // ========================================================================
      // SOLUTION 2: Update existing LAUNCHPAD_CREATED activity with collection image
      // This fixes activities that were created before metadata was available
      // ========================================================================
      try {
        // Find LAUNCHPAD_CREATED activities with null collectionImage
        const activitiesToUpdate = await prisma.activity.findMany({
          where: {
            launchpadId: launchpad.id,
            type: 'LAUNCHPAD_CREATED'
          }
        });

        for (const activity of activitiesToUpdate) {
          const metadata = activity.metadata as any;
          
          // Only update if collectionImage is null or missing
          if (!metadata?.collectionImage) {
            await prisma.activity.update({
              where: { id: activity.id },
              data: {
                metadata: {
                  ...metadata,
                  collectionImage: collectionImage
                }
              }
            });
            
            console.log(`✅ Updated LAUNCHPAD_CREATED activity ${activity.id} with collection image`);
          }
        }
      } catch (updateError) {
        console.error(`❌ Error updating LAUNCHPAD_CREATED activities:`, updateError);
        // Continue even if update fails
      }
    } catch (error) {
      console.error(`❌ Error syncing collection image:`, error);
      // Don't throw - not critical
    }
  }
}

