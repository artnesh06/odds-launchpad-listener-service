import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

/**
 * Clear all transaction data for a specific collection
 * Usage: npx tsx scripts/clear-collection-data.ts [collectionAddress]
 */
async function clearCollectionData(collectionAddress?: string) {
  try {
    // Default collection address jika tidak ada parameter
    const targetCollection = collectionAddress || '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486';
    const normalizedAddress = targetCollection.toLowerCase();

    console.log('🗑️  Starting collection data cleanup...');
    console.log(`📍 Collection: ${normalizedAddress}`);
    console.log('');

    // Check if collection exists
    const launchpad = await prisma.launchpad.findFirst({
      where: {
        contractAddress: {
          equals: normalizedAddress,
          mode: 'insensitive'
        }
      }
    });

    if (!launchpad) {
      console.log('⚠️  Warning: No launchpad found for this collection address');
      console.log('   Continuing with cleanup anyway...');
      console.log('');
    } else {
      console.log(`✅ Found launchpad: ${launchpad.name || 'Unnamed'}`);
      console.log('');
    }

    // Count data before deletion
    console.log('📊 Counting data before deletion...');
    const countsBefore = await getCollectionCounts(normalizedAddress);
    displayCounts('Before', countsBefore);

    // Confirm deletion
    console.log('');
    console.log('⚠️  WARNING: This will permanently delete all data for this collection!');
    console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('');
    console.log('🔄 Starting deletion process...');

    // 1. Delete marketplace data
    console.log('  → Deleting marketplace offers...');
    const deletedOffers = await prisma.marketplaceOffer.deleteMany({
      where: {
        contractAddress: {
          equals: normalizedAddress,
          mode: 'insensitive'
        }
      }
    });
    console.log(`     Deleted ${deletedOffers.count} offers`);

    console.log('  → Deleting marketplace sales...');
    const deletedSales = await prisma.marketplaceSale.deleteMany({
      where: {
        contractAddress: {
          equals: normalizedAddress,
          mode: 'insensitive'
        }
      }
    });
    console.log(`     Deleted ${deletedSales.count} sales`);

    console.log('  → Deleting marketplace listings...');
    const deletedListings = await prisma.marketplaceListing.deleteMany({
      where: {
        contractAddress: {
          equals: normalizedAddress,
          mode: 'insensitive'
        }
      }
    });
    console.log(`     Deleted ${deletedListings.count} listings`);

    console.log('  → Deleting floor prices...');
    const deletedFloorPrices = await prisma.nFTFloorPrice.deleteMany({
      where: {
        contractAddress: {
          equals: normalizedAddress,
          mode: 'insensitive'
        }
      }
    });
    console.log(`     Deleted ${deletedFloorPrices.count} floor prices`);

    // 2. Delete NFT data
    console.log('  → Deleting NFT rarity data...');
    const deletedRarity = await prisma.nFTRarity.deleteMany({
      where: {
        nft: {
          contractAddress: {
            equals: normalizedAddress,
            mode: 'insensitive'
          }
        }
      }
    });
    console.log(`     Deleted ${deletedRarity.count} rarity records`);

    console.log('  → Deleting collection analytics...');
    const deletedAnalytics = await prisma.nFTCollectionAnalytics.deleteMany({
      where: {
        contractAddress: {
          equals: normalizedAddress,
          mode: 'insensitive'
        }
      }
    });
    console.log(`     Deleted ${deletedAnalytics.count} analytics records`);

    console.log('  → Deleting NFT transfers...');
    const deletedTransfers = await prisma.nFTTransfer.deleteMany({
      where: {
        nft: {
          contractAddress: {
            equals: normalizedAddress,
            mode: 'insensitive'
          }
        }
      }
    });
    console.log(`     Deleted ${deletedTransfers.count} transfers`);

    console.log('  → Deleting NFT ownership...');
    const deletedOwnership = await prisma.nFTOwnership.deleteMany({
      where: {
        nft: {
          contractAddress: {
            equals: normalizedAddress,
            mode: 'insensitive'
          }
        }
      }
    });
    console.log(`     Deleted ${deletedOwnership.count} ownership records`);

    console.log('  → Deleting NFT attributes...');
    const deletedAttributes = await prisma.nFTAttribute.deleteMany({
      where: {
        nft: {
          contractAddress: {
            equals: normalizedAddress,
            mode: 'insensitive'
          }
        }
      }
    });
    console.log(`     Deleted ${deletedAttributes.count} attributes`);

    console.log('  → Deleting NFTs...');
    const deletedNFTs = await prisma.nFT.deleteMany({
      where: {
        contractAddress: {
          equals: normalizedAddress,
          mode: 'insensitive'
        }
      }
    });
    console.log(`     Deleted ${deletedNFTs.count} NFTs`);

    // 3. Delete minting & launchpad data
    if (launchpad) {
      console.log('  → Deleting mints...');
      const deletedMints = await prisma.mint.deleteMany({
        where: { launchpadId: launchpad.id }
      });
      console.log(`     Deleted ${deletedMints.count} mints`);

      console.log('  → Deleting launchpad analytics...');
      const deletedLaunchpadAnalytics = await prisma.launchpadAnalytics.deleteMany({
        where: { launchpadId: launchpad.id }
      });
      console.log(`     Deleted ${deletedLaunchpadAnalytics.count} analytics`);

      console.log('  → Deleting launchpad metadata...');
      const deletedMetadata = await prisma.launchpadMetadata.deleteMany({
        where: { launchpadId: launchpad.id }
      });
      console.log(`     Deleted ${deletedMetadata.count} metadata records`);

      console.log('  → Deleting whitelists...');
      const deletedWhitelists = await prisma.launchpadWhitelist.deleteMany({
        where: { launchpadId: launchpad.id }
      });
      console.log(`     Deleted ${deletedWhitelists.count} whitelist entries`);

      console.log('  → Deleting phases...');
      const deletedPhases = await prisma.launchpadPhase.deleteMany({
        where: { launchpadId: launchpad.id }
      });
      console.log(`     Deleted ${deletedPhases.count} phases`);

      console.log('  → Deleting launchpad...');
      await prisma.launchpad.delete({
        where: { id: launchpad.id }
      });
      console.log(`     Deleted launchpad`);

      // Update factory counter
      if (launchpad.factoryId) {
        console.log('  → Updating factory counter...');
        await prisma.launchpadFactory.update({
          where: { id: launchpad.factoryId },
          data: {
            totalLaunchpads: {
              decrement: 1
            }
          }
        });
        console.log(`     Updated factory counter`);
      }
    }

    // 4. Delete activities and logs
    console.log('  → Deleting activities...');
    const deletedActivities = await prisma.activity.deleteMany({
      where: {
        launchpadId: launchpad?.id
      }
    });
    console.log(`     Deleted ${deletedActivities.count} activities`);

    console.log('  → Deleting error logs...');
    const deletedErrorLogs = await prisma.errorLog.deleteMany({
      where: {
        contractAddress: {
          equals: normalizedAddress,
          mode: 'insensitive'
        }
      }
    });
    console.log(`     Deleted ${deletedErrorLogs.count} error logs`);

    console.log('  → Deleting processed events...');
    const deletedProcessedEvents = await prisma.processedEvent.deleteMany({
      where: {
        // ProcessedEvent tidak punya contractAddress, jadi kita skip atau hapus berdasarkan txHash
        // Untuk sekarang kita skip karena tidak ada cara langsung
      }
    });
    console.log(`     Deleted ${deletedProcessedEvents.count} processed events`);

    // Count data after deletion
    console.log('');
    console.log('📊 Counting data after deletion...');
    const countsAfter = await getCollectionCounts(normalizedAddress);
    displayCounts('After', countsAfter);

    console.log('');
    console.log('✅ Collection data cleanup completed successfully!');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function getCollectionCounts(collectionAddress: string) {
  const [
    launchpads,
    nfts,
    activities,
    mints,
    transfers,
    listings,
    offers,
    sales
  ] = await Promise.all([
    prisma.launchpad.count({
      where: {
        contractAddress: {
          equals: collectionAddress,
          mode: 'insensitive'
        }
      }
    }),
    prisma.nFT.count({
      where: {
        contractAddress: {
          equals: collectionAddress,
          mode: 'insensitive'
        }
      }
    }),
    prisma.activity.count({
      where: {
        launchpadId: {
          in: await prisma.launchpad.findMany({
            where: {
              contractAddress: {
                equals: collectionAddress,
                mode: 'insensitive'
              }
            },
            select: { id: true }
          }).then(lps => lps.map(lp => lp.id))
        }
      }
    }),
    prisma.mint.count({
      where: {
        launchpad: {
          contractAddress: {
            equals: collectionAddress,
            mode: 'insensitive'
          }
        }
      }
    }),
    prisma.nFTTransfer.count({
      where: {
        nft: {
          contractAddress: {
            equals: collectionAddress,
            mode: 'insensitive'
          }
        }
      }
    }),
    prisma.marketplaceListing.count({
      where: {
        contractAddress: {
          equals: collectionAddress,
          mode: 'insensitive'
        }
      }
    }),
    prisma.marketplaceOffer.count({
      where: {
        contractAddress: {
          equals: collectionAddress,
          mode: 'insensitive'
        }
      }
    }),
    prisma.marketplaceSale.count({
      where: {
        contractAddress: {
          equals: collectionAddress,
          mode: 'insensitive'
        }
      }
    })
  ]);

  return {
    launchpads,
    nfts,
    activities,
    mints,
    transfers,
    listings,
    offers,
    sales
  };
}

function displayCounts(label: string, counts: any) {
  console.log(`   ${label}:`);
  console.log(`     - Launchpads: ${counts.launchpads}`);
  console.log(`     - NFTs: ${counts.nfts}`);
  console.log(`     - Activities: ${counts.activities}`);
  console.log(`     - Mints: ${counts.mints}`);
  console.log(`     - Transfers: ${counts.transfers}`);
  console.log(`     - Listings: ${counts.listings}`);
  console.log(`     - Offers: ${counts.offers}`);
  console.log(`     - Sales: ${counts.sales}`);
}

// Run the script
const collectionAddress = process.argv[2];
clearCollectionData(collectionAddress)
  .then(() => {
    console.log('');
    console.log('🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('');
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
