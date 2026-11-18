/**
 * Script to sync collection metadata from contractURI for existing collections
 * 
 * This script will:
 * 1. Find all launchpads that have contractURI but no metadata image
 * 2. Fetch metadata from contractURI
 * 3. Update LaunchpadMetadata with the image
 * 
 * Usage: npx ts-node scripts/sync-collection-metadata.ts
 */

import { PrismaClient } from '@prisma/client';
import { ipfsToHttpOptimized, convertIpfsToHttp } from '../src/utils/ipfs-helpers';

const prisma = new PrismaClient();

/**
 * Fetch collection metadata from contractURI (IPFS or HTTP)
 */
async function fetchContractMetadata(contractURI: string): Promise<{
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
      fetchUrl = await ipfsToHttpOptimized(contractURI) || contractURI;
    }
    
    console.log(`  📥 Fetching from: ${fetchUrl}`);
    
    const response = await fetch(fetchUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'NFT-Listener-Service/1.0'
      },
      signal: AbortSignal.timeout(15000) // 15 second timeout
    });
    
    if (!response.ok) {
      console.warn(`  ⚠️ Failed to fetch: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const metadata = await response.json() as any;
    return {
      image: metadata.image,
      name: metadata.name,
      description: metadata.description,
      external_link: metadata.external_link
    };
  } catch (error: any) {
    console.error(`  ❌ Error fetching: ${error.message}`);
    return null;
  }
}

async function syncCollectionMetadata() {
  console.log('🔄 Starting collection metadata sync...\n');
  
  // Find all launchpads with contractURI but no metadata image
  const launchpads = await prisma.launchpad.findMany({
    where: {
      AND: [
        { contractURI: { not: null } },
        { contractURI: { not: '' } }
      ]
    },
    include: {
      metadata: true
    }
  });
  
  console.log(`📊 Found ${launchpads.length} launchpads with contractURI\n`);
  
  let synced = 0;
  let skipped = 0;
  let failed = 0;
  
  for (const launchpad of launchpads) {
    console.log(`\n📦 Processing: ${launchpad.name} (${launchpad.contractAddress})`);
    
    // Skip if already has metadata image
    if (launchpad.metadata?.image) {
      console.log(`  ✅ Already has image, skipping`);
      skipped++;
      continue;
    }
    
    // Fetch metadata from contractURI
    const contractMetadata = await fetchContractMetadata(launchpad.contractURI!);
    
    if (!contractMetadata?.image) {
      console.log(`  ⚠️ No image found in contractURI metadata`);
      failed++;
      continue;
    }
    
    // Convert IPFS URL to HTTP gateway using fastest gateway
    let imageUrl = contractMetadata.image;
    if (imageUrl.startsWith('ipfs://')) {
      imageUrl = await ipfsToHttpOptimized(imageUrl) || imageUrl;
    }
    
    // Upsert LaunchpadMetadata
    await prisma.launchpadMetadata.upsert({
      where: { launchpadId: launchpad.id },
      create: {
        launchpadId: launchpad.id,
        image: imageUrl
      },
      update: {
        image: imageUrl
      }
    });
    
    console.log(`  ✅ Synced image: ${imageUrl.substring(0, 60)}...`);
    synced++;
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 SYNC COMPLETE');
  console.log('='.repeat(60));
  console.log(`  ✅ Synced: ${synced}`);
  console.log(`  ⏭️ Skipped (already has image): ${skipped}`);
  console.log(`  ❌ Failed (no image in contractURI): ${failed}`);
  console.log('='.repeat(60) + '\n');
}

// Run the script
syncCollectionMetadata()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
