/**
 * On-Chain NFT Sync Service
 * 
 * Sync NFT data directly from blockchain instead of relying on Alchemy indexing.
 * This is especially important for shuffle-enabled collections where Alchemy
 * may not have indexed all tokens correctly.
 */

import { ethers } from 'ethers';
import { getChainProvider } from './blockchain/chain-provider';
import { prisma } from '../config/database';
import axios from 'axios';
import { ipfsToHttpOptimized, fetchIpfsJson } from '../utils/ipfs-helpers';

interface SyncNFTOptions {
  contractAddress: string;
  chainId: number;
  rpcUrl: string;
  startFromSequential?: number;
  maxTokens?: number;
}

interface SyncResult {
  success: boolean;
  synced: number;
  errors: number;
  total: number;
  message: string;
}

// Minimal ABI for NFT operations
const NFT_ABI = [
  'function totalSupply() view returns (uint256)',
  'function totalMaxSupply() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function isShuffleEnabled() view returns (bool)',
  'function getRandomTokenId(uint256 sequentialId) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

/**
 * Fetch metadata from IPFS/HTTP URL
 */
async function fetchMetadata(tokenUri: string): Promise<any | null> {
  try {
    // data: URIs (fully on-chain metadata)
    if (tokenUri.startsWith('data:application/json')) {
      const [, payload] = tokenUri.split(',', 2);
      const json = tokenUri.includes(';base64,')
        ? Buffer.from(payload, 'base64').toString('utf8')
        : decodeURIComponent(payload);
      return JSON.parse(json);
    }
    // IPFS (with gateway fallback) or plain HTTP
    return await fetchIpfsJson(tokenUri, 8000);
  } catch (error) {
    console.error(`Failed to fetch metadata from ${tokenUri}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Process image URL from metadata
 */
async function processImageUrl(imageUrl: string | undefined): Promise<{
  originalUrl: string | null;
  cachedUrl: string | null;
  thumbnailUrl: string | null;
  pngUrl: string | null;
  contentType: string | null;
}> {
  if (!imageUrl) {
    return {
      originalUrl: null,
      cachedUrl: null,
      thumbnailUrl: null,
      pngUrl: null,
      contentType: null,
    };
  }

  // Convert IPFS to HTTP using fastest gateway
  let processedUrl = imageUrl;
  if (imageUrl.startsWith('ipfs://')) {
    processedUrl = await ipfsToHttpOptimized(imageUrl) || imageUrl;
  }

  // Determine content type from extension
  let contentType = 'image/png';
  const lowerUrl = processedUrl.toLowerCase();
  if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) {
    contentType = 'image/jpeg';
  } else if (lowerUrl.endsWith('.gif')) {
    contentType = 'image/gif';
  } else if (lowerUrl.endsWith('.svg')) {
    contentType = 'image/svg+xml';
  } else if (lowerUrl.endsWith('.webp')) {
    contentType = 'image/webp';
  }

  return {
    originalUrl: processedUrl,
    cachedUrl: processedUrl,
    thumbnailUrl: processedUrl,
    pngUrl: processedUrl,
    contentType,
  };
}

/**
 * Sync NFTs from on-chain for a specific collection
 */
export async function syncNFTsFromOnChain(options: SyncNFTOptions): Promise<SyncResult> {
  const { contractAddress, chainId, rpcUrl, startFromSequential = 0, maxTokens } = options;

  console.log('🔄 Starting on-chain NFT sync...');
  console.log(`Contract: ${contractAddress}`);
  console.log(`Chain ID: ${chainId}`);

  try {
    // Connect to blockchain
    const provider = getChainProvider(chainId, rpcUrl);
    const contract = new ethers.Contract(contractAddress, NFT_ABI, provider);

    // Get contract info
    const [totalSupply, name, symbol] = await Promise.all([
      contract.totalSupply(),
      contract.name(),
      contract.symbol(),
    ]);

    // Check if shuffle is enabled (some contracts may not have this function)
    let isShuffleEnabled = false;
    try {
      isShuffleEnabled = await contract.isShuffleEnabled();
    } catch (error) {
      console.log('⚠️ Contract does not support shuffle, assuming sequential');
    }

    console.log(`Name: ${name}`);
    console.log(`Symbol: ${symbol}`);
    console.log(`Total Supply: ${totalSupply}`);
    console.log(`Shuffle Enabled: ${isShuffleEnabled}`);

    // Update contract in database
    await prisma.nFTContract.upsert({
      where: {
        address_chainId: {
          address: contractAddress.toLowerCase(),
          chainId,
        },
      },
      create: {
        address: contractAddress.toLowerCase(),
        chainId,
        name,
        symbol,
        totalSupply: totalSupply.toString(),
        tokenType: 'ERC721',
      },
      update: {
        name,
        symbol,
        totalSupply: totalSupply.toString(),
      },
    });

    // Determine how many tokens to sync
    const tokensToSync = maxTokens 
      ? Math.min(maxTokens, Number(totalSupply) - startFromSequential)
      : Number(totalSupply) - startFromSequential;

    console.log(`Syncing ${tokensToSync} NFTs (starting from sequential ${startFromSequential})...`);

    let successCount = 0;
    let errorCount = 0;

    // Sync each NFT
    for (let i = startFromSequential; i < startFromSequential + tokensToSync; i++) {
      try {
        // Determine actual token ID
        let tokenId: bigint;
        if (isShuffleEnabled) {
          // For shuffled collections, get the random token ID
          tokenId = await contract.getRandomTokenId(i);
        } else {
          // For non-shuffled collections, sequential ID = token ID
          tokenId = BigInt(i);
        }

        // Get tokenURI
        const tokenUri = await contract.tokenURI(tokenId);

        // Fetch metadata
        const metadata = await fetchMetadata(tokenUri);
        if (!metadata) {
          console.log(`⚠️ [${i}] Token ${tokenId}: Failed to fetch metadata, skipping`);
          errorCount++;
          continue;
        }

        // Process image
        const imageData = await processImageUrl(metadata.image);

        // Upsert NFT in database
        const nft = await prisma.nFT.upsert({
          where: {
            contractAddress_tokenId_chainId: {
              contractAddress: contractAddress.toLowerCase(),
              tokenId: tokenId.toString(),
              chainId,
            },
          },
          create: {
            contractAddress: contractAddress.toLowerCase(),
            chainId,
            tokenId: tokenId.toString(),
            tokenType: 'ERC721',
            name: metadata.name || `${name} #${tokenId}`,
            description: metadata.description || null,
            tokenUri,
            imageOriginalUrl: imageData.originalUrl,
            imageCachedUrl: imageData.cachedUrl,
            imageThumbnailUrl: imageData.thumbnailUrl,
            imagePngUrl: imageData.pngUrl,
            imageContentType: imageData.contentType,
            imageSize: null,
            rawMetadata: metadata as any,
            rawTokenUri: tokenUri,
            timeLastUpdated: new Date(),
          },
          update: {
            name: metadata.name || `${name} #${tokenId}`,
            description: metadata.description || null,
            tokenUri,
            imageOriginalUrl: imageData.originalUrl,
            imageCachedUrl: imageData.cachedUrl,
            imageThumbnailUrl: imageData.thumbnailUrl,
            imagePngUrl: imageData.pngUrl,
            imageContentType: imageData.contentType,
            rawMetadata: metadata as any,
            rawTokenUri: tokenUri,
            timeLastUpdated: new Date(),
          },
        });

        // Upsert attributes
        if (metadata.attributes && Array.isArray(metadata.attributes)) {
          // Delete existing attributes
          await prisma.nFTAttribute.deleteMany({
            where: {
              nftId: nft.id,
            },
          });

          // Create new attributes
          for (const attr of metadata.attributes) {
            await prisma.nFTAttribute.create({
              data: {
                nftId: nft.id,
                traitType: attr.trait_type,
                value: String(attr.value),
                displayType: attr.display_type || null,
              },
            });
          }
        }

        console.log(`✅ [${i + 1}/${tokensToSync}] Token ${tokenId}: Synced`);
        successCount++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ [${i}] Error:`, error instanceof Error ? error.message : error);
        errorCount++;
      }
    }

    const message = `Synced ${successCount} NFTs successfully, ${errorCount} errors`;
    console.log(`✅ ${message}`);

    return {
      success: true,
      synced: successCount,
      errors: errorCount,
      total: tokensToSync,
      message,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Fatal error during sync:', errorMessage);
    
    return {
      success: false,
      synced: 0,
      errors: 0,
      total: 0,
      message: `Failed to sync: ${errorMessage}`,
    };
  }
}

/**
 * Sync a single NFT by token ID
 */
export async function syncSingleNFT(
  contractAddress: string,
  tokenId: string,
  chainId: number,
  rpcUrl: string
): Promise<{ success: boolean; message: string }> {
  console.log(`🔄 Syncing single NFT: Token ${tokenId}`);

  try {
    const provider = getChainProvider(chainId, rpcUrl);
    const contract = new ethers.Contract(contractAddress, NFT_ABI, provider);

    // Get contract info
    const [name] = await Promise.all([
      contract.name(),
    ]);

    // Get tokenURI
    const tokenUri = await contract.tokenURI(tokenId);

    // Fetch metadata
    const metadata = await fetchMetadata(tokenUri);
    if (!metadata) {
      return {
        success: false,
        message: 'Failed to fetch metadata',
      };
    }

    // Process image
    const imageData = await processImageUrl(metadata.image);

    // Upsert NFT in database
    const nft = await prisma.nFT.upsert({
      where: {
        contractAddress_tokenId_chainId: {
          contractAddress: contractAddress.toLowerCase(),
          tokenId: tokenId.toString(),
          chainId,
        },
      },
      create: {
        contractAddress: contractAddress.toLowerCase(),
        chainId,
        tokenId: tokenId.toString(),
        tokenType: 'ERC721',
        name: metadata.name || `${name} #${tokenId}`,
        description: metadata.description || null,
        tokenUri,
        imageOriginalUrl: imageData.originalUrl,
        imageCachedUrl: imageData.cachedUrl,
        imageThumbnailUrl: imageData.thumbnailUrl,
        imagePngUrl: imageData.pngUrl,
        imageContentType: imageData.contentType,
        imageSize: null,
        rawMetadata: metadata as any,
        rawTokenUri: tokenUri,
        timeLastUpdated: new Date(),
      },
      update: {
        name: metadata.name || `${name} #${tokenId}`,
        description: metadata.description || null,
        tokenUri,
        imageOriginalUrl: imageData.originalUrl,
        imageCachedUrl: imageData.cachedUrl,
        imageThumbnailUrl: imageData.thumbnailUrl,
        imagePngUrl: imageData.pngUrl,
        imageContentType: imageData.contentType,
        rawMetadata: metadata as any,
        rawTokenUri: tokenUri,
        timeLastUpdated: new Date(),
      },
    });

    // Upsert attributes
    if (metadata.attributes && Array.isArray(metadata.attributes)) {
      // Delete existing attributes
      await prisma.nFTAttribute.deleteMany({
        where: {
          nftId: nft.id,
        },
      });

      // Create new attributes
      for (const attr of metadata.attributes) {
        await prisma.nFTAttribute.create({
          data: {
            nftId: nft.id,
            traitType: attr.trait_type,
            value: String(attr.value),
            displayType: attr.display_type || null,
          },
        });
      }
    }

    console.log(`✅ Token ${tokenId}: Synced successfully`);

    return {
      success: true,
      message: 'NFT synced successfully',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Error syncing token ${tokenId}:`, errorMessage);
    
    return {
      success: false,
      message: errorMessage,
    };
  }
}
