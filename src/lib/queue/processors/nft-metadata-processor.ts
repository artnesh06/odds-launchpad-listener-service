import { Job } from 'bull';
import { NFTMetadataJob } from '../queue-config';
import { prisma, withRetry, withDbLimit } from '../../../config/database';
import { AlchemyNFTService } from '../../alchemy-nft-service';

/**
 * NFT Metadata Processor
 * Fetches and stores NFT metadata
 */
export class NFTMetadataProcessor {
  private alchemyService: AlchemyNFTService;

  constructor(alchemyService: AlchemyNFTService) {
    this.alchemyService = alchemyService;
  }

  /**
   * Process NFT metadata job
   */
  async process(job: Job<NFTMetadataJob>): Promise<void> {
    const { chainId, contractAddress, tokenId, tokenUri, forceRefresh } = job.data;

    console.log(`📦 Fetching metadata: ${contractAddress}:${tokenId}`);

    try {
      await job.progress(10);

      // Check if metadata already exists and not forcing refresh
      if (!forceRefresh) {
        const existing = await this.checkExistingMetadata(chainId, contractAddress, tokenId);
        if (existing) {
          console.log(`⏭️ Metadata already exists for ${contractAddress}:${tokenId}`);
          return;
        }
      }

      await job.progress(30);

      // Fetch metadata from Alchemy
      const metadata = await this.alchemyService.getNFTMetadata(contractAddress, tokenId);

      if (!metadata) {
        throw new Error('Failed to fetch metadata');
      }

      await job.progress(60);

      // Store metadata
      await this.storeMetadata(chainId, contractAddress, tokenId, metadata);

      await job.progress(100);

      console.log(`✅ Metadata stored for ${contractAddress}:${tokenId}`);
    } catch (error) {
      console.error(`❌ Error processing metadata:`, error);
      throw error;
    }
  }

  /**
   * Check if metadata already exists
   */
  private async checkExistingMetadata(
    chainId: number,
    contractAddress: string,
    tokenId: string
  ): Promise<boolean> {
    return withDbLimit(async () => {
      const nft = await prisma.nFT.findUnique({
        where: {
          contractAddress_tokenId_chainId: {
            contractAddress: contractAddress.toLowerCase(),
            tokenId,
            chainId,
          },
        },
        select: {
          name: true,
          rawMetadata: true,
        },
      });

      return !!(nft && nft.name && nft.rawMetadata);
    });
  }

  /**
   * Store metadata in database
   */
  private async storeMetadata(
    chainId: number,
    contractAddress: string,
    tokenId: string,
    metadata: any
  ): Promise<void> {
    await withRetry(async () => {
      await withDbLimit(async () => {
        // Update NFT with metadata
        const nft = await prisma.nFT.update({
          where: {
            contractAddress_tokenId_chainId: {
              contractAddress: contractAddress.toLowerCase(),
              tokenId,
              chainId,
            },
          },
          data: {
            name: metadata.name,
            description: metadata.description,
            tokenUri: metadata.tokenUri,
            imageCachedUrl: metadata.image?.cachedUrl,
            imageThumbnailUrl: metadata.image?.thumbnailUrl,
            imagePngUrl: metadata.image?.pngUrl,
            imageContentType: metadata.image?.contentType,
            imageSize: metadata.image?.size,
            imageOriginalUrl: metadata.image?.originalUrl,
            rawMetadata: metadata.raw as any,
            timeLastUpdated: new Date(),
          },
        });

        // Store attributes
        if (metadata.attributes && metadata.attributes.length > 0) {
          // Delete existing attributes
          await prisma.nFTAttribute.deleteMany({
            where: { nftId: nft.id },
          });

          // Create new attributes
          await prisma.nFTAttribute.createMany({
            data: metadata.attributes.map((attr: any) => ({
              nftId: nft.id,
              traitType: attr.trait_type,
              value: attr.value,
              displayType: attr.display_type,
            })),
          });
        }
      });
    });
  }
}
