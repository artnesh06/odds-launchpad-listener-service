/**
 * Find Duplicate Transfers
 * 
 * Script untuk detect duplicate transfer records
 * 
 * Usage:
 *   npx tsx scripts/find-duplicates.ts <contractAddress> <chainId>
 */

import { prisma } from '../src/config/database';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('❌ Usage: npx tsx scripts/find-duplicates.ts <contractAddress> <chainId>');
    process.exit(1);
  }

  const contractAddress = args[0].toLowerCase();
  const chainId = parseInt(args[1]);

  console.log('🔍 Finding Duplicate Transfers');
  console.log('='.repeat(80));
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Chain ID: ${chainId}`);
  console.log('='.repeat(80));
  console.log('');

  try {
    // Find duplicates by contractAddress + tokenId + transferType + txHash
    const duplicates = await prisma.$queryRaw<Array<{
      contractAddress: string;
      tokenId: string;
      transferType: string;
      txHash: string;
      count: bigint;
    }>>`
      SELECT 
        n."contractAddress",
        n."tokenId",
        t."transferType",
        t."txHash",
        COUNT(*) as count
      FROM nft_transfers t
      JOIN nfts n ON n.id = t."nftId"
      WHERE n."contractAddress" = ${contractAddress}
        AND n."chainId" = ${chainId}
      GROUP BY n."contractAddress", n."tokenId", t."transferType", t."txHash"
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, n."tokenId", t."txHash"
    `;

    if (duplicates.length === 0) {
      console.log('✅ No duplicates found!');
      console.log('');
      process.exit(0);
    }

    console.log(`❌ Found ${duplicates.length} duplicate transfer groups`);
    console.log('');

    let totalDuplicates = 0;
    for (const dup of duplicates) {
      const count = Number(dup.count);
      totalDuplicates += count - 1; // Exclude the original
      
      console.log(`📍 Contract: ${dup.contractAddress}`);
      console.log(`   Token ID: ${dup.tokenId}`);
      console.log(`   Type: ${dup.transferType}`);
      console.log(`   TxHash: ${dup.txHash}`);
      console.log(`   Count: ${count} (${count - 1} duplicates)`);
      
      // Get details of duplicates
      const records = await prisma.nFTTransfer.findMany({
        where: {
          txHash: dup.txHash,
          transferType: dup.transferType as any,
          nft: {
            contractAddress: dup.contractAddress,
            tokenId: dup.tokenId,
            chainId,
          },
        },
        select: {
          id: true,
          fromAddress: true,
          toAddress: true,
          logIndex: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      records.forEach((record, index) => {
        const marker = index === 0 ? '✅ KEEP' : '❌ DELETE';
        console.log(`   ${marker} ID: ${record.id}`);
        console.log(`      LogIndex: ${record.logIndex}`);
        console.log(`      From: ${record.fromAddress.slice(0, 10)}...`);
        console.log(`      To: ${record.toAddress.slice(0, 10)}...`);
        console.log(`      Created: ${record.createdAt.toISOString()}`);
      });
      
      console.log('');
    }

    console.log('='.repeat(80));
    console.log(`📊 Summary:`);
    console.log(`   Duplicate groups: ${duplicates.length}`);
    console.log(`   Total duplicate records: ${totalDuplicates}`);
    console.log('='.repeat(80));
    console.log('');

    if (process.argv.includes('--fix')) {
      console.log('🔧 Fixing duplicates...');
      console.log('   Strategy: Keep oldest record, delete newer ones');
      console.log('');

      let deletedCount = 0;

      for (const dup of duplicates) {
        // Get all records for this duplicate
        const records = await prisma.nFTTransfer.findMany({
          where: {
            txHash: dup.txHash,
            transferType: dup.transferType as any,
            nft: {
              contractAddress: dup.contractAddress,
              tokenId: dup.tokenId,
              chainId,
            },
          },
          select: {
            id: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        });

        // Keep first (oldest), delete rest
        const toDelete = records.slice(1).map(r => r.id);
        
        if (toDelete.length > 0) {
          const result = await prisma.nFTTransfer.deleteMany({
            where: {
              id: {
                in: toDelete,
              },
            },
          });

          deletedCount += result.count;
          console.log(`   ✅ Deleted ${result.count} duplicates for token ${dup.tokenId} in ${dup.txHash}`);
        }
      }

      console.log('');
      console.log(`✅ Deleted ${deletedCount} duplicate records`);
      console.log('');
      console.log('💡 Next steps:');
      console.log('   1. Run verify-collection-stats.ts to check stats');
      console.log('   2. Run verify-collection-stats.ts --fix to fix stats if needed');
    } else {
      console.log('💡 To fix duplicates, run with --fix flag:');
      console.log(`   npx tsx scripts/find-duplicates.ts ${contractAddress} ${chainId} --fix`);
    }

    console.log('');

  } catch (error) {
    console.error('');
    console.error('='.repeat(80));
    console.error('❌ Fatal Error');
    console.error('='.repeat(80));
    console.error(error);
    console.error('');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
