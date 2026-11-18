/**
 * Phase Index Verification CLI Script
 * 
 * Verifies phase index consistency between database and smart contracts.
 * Generates detailed reports with mismatches and saves to file.
 * 
 * Requirements: 8.2, 8.3
 * 
 * Usage:
 *   npx tsx scripts/verify-phase-indices.ts [options]
 * 
 * Options:
 *   --chain <chainId>              Filter by specific chain ID (e.g., --chain 11155111)
 *   --collection <address>         Verify specific collection address
 *   --output <path>                Custom output file path (default: reports/phase-verification-{timestamp}.json)
 *   --format <json|text>           Output format (default: json)
 *   --help                         Show help message
 * 
 * Examples:
 *   # Verify all collections on all chains
 *   npx tsx scripts/verify-phase-indices.ts
 * 
 *   # Verify all collections on Sepolia
 *   npx tsx scripts/verify-phase-indices.ts --chain 11155111
 * 
 *   # Verify specific collection
 *   npx tsx scripts/verify-phase-indices.ts --collection 0x1234... --chain 11155111
 * 
 *   # Generate text report
 *   npx tsx scripts/verify-phase-indices.ts --format text
 */

import { PrismaClient } from '@prisma/client';
import { PhaseIndexVerificationService } from '../src/lib/blockchain/services/phase-index-verification-service';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface CliOptions {
  chainId?: number;
  collectionAddress?: string;
  outputPath?: string;
  format: 'json' | 'text';
  cleanup: boolean;
  help: boolean;
}

/**
 * Parse command-line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    format: 'json',
    cleanup: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--chain':
        options.chainId = parseInt(args[++i], 10);
        if (isNaN(options.chainId)) {
          console.error('❌ Invalid chain ID. Must be a number.');
          process.exit(1);
        }
        break;

      case '--collection':
        options.collectionAddress = args[++i];
        if (!options.collectionAddress) {
          console.error('❌ Collection address is required after --collection');
          process.exit(1);
        }
        break;

      case '--output':
        options.outputPath = args[++i];
        if (!options.outputPath) {
          console.error('❌ Output path is required after --output');
          process.exit(1);
        }
        break;

      case '--format':
        const format = args[++i];
        if (format !== 'json' && format !== 'text') {
          console.error('❌ Invalid format. Must be "json" or "text".');
          process.exit(1);
        }
        options.format = format;
        break;

      case '--cleanup':
        options.cleanup = true;
        break;

      case '--help':
      case '-h':
        options.help = true;
        break;

      default:
        console.error(`❌ Unknown option: ${arg}`);
        console.log('Use --help to see available options');
        process.exit(1);
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Phase Index Verification CLI

Verifies phase index consistency between database and smart contracts.
Generates detailed reports with mismatches and saves to file.

Usage:
  npx tsx scripts/verify-phase-indices.ts [options]

Options:
  --chain <chainId>              Filter by specific chain ID (e.g., --chain 11155111)
  --collection <address>         Verify specific collection address
  --output <path>                Custom output file path (default: reports/phase-verification-{timestamp}.json)
  --format <json|text>           Output format (default: json)
  --cleanup                      Clean up orphaned whitelist records after verification
  --help, -h                     Show this help message

Examples:
  # Verify all collections on all chains
  npx tsx scripts/verify-phase-indices.ts

  # Verify all collections on Sepolia
  npx tsx scripts/verify-phase-indices.ts --chain 11155111

  # Verify specific collection
  npx tsx scripts/verify-phase-indices.ts --collection 0x1234... --chain 11155111

  # Generate text report
  npx tsx scripts/verify-phase-indices.ts --format text

  # Custom output path
  npx tsx scripts/verify-phase-indices.ts --output ./my-report.json

  # Clean up orphaned whitelist records
  npx tsx scripts/verify-phase-indices.ts --cleanup

  # Verify and cleanup specific collection
  npx tsx scripts/verify-phase-indices.ts --collection 0x1234... --chain 11155111 --cleanup
`);
}

/**
 * Generate timestamp for report filename
 */
function generateTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').split('Z')[0];
}

/**
 * Ensure reports directory exists
 */
function ensureReportsDirectory(): string {
  const reportsDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
    console.log(`📁 Created reports directory: ${reportsDir}`);
  }
  return reportsDir;
}

/**
 * Format report as JSON
 */
function formatReportAsJson(report: any): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Format report as human-readable text
 */
function formatReportAsText(report: any): string {
  const lines: string[] = [];

  lines.push('='.repeat(80));
  lines.push('PHASE INDEX VERIFICATION REPORT');
  lines.push('='.repeat(80));
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Summary
  lines.push('SUMMARY');
  lines.push('-'.repeat(80));
  lines.push(`Total Collections: ${report.totalCollections}`);
  lines.push(`Collections Checked: ${report.collectionsChecked}`);
  lines.push(`Consistent: ${report.summary.consistent}`);
  lines.push(`Inconsistent: ${report.summary.inconsistent}`);
  lines.push(`Errors: ${report.summary.errors}`);
  if (report.summary.orphanedWhitelistRecords !== undefined) {
    lines.push(`Orphaned Whitelist Records: ${report.summary.orphanedWhitelistRecords}`);
  }
  lines.push('');

  // Mismatches
  if (report.mismatches && report.mismatches.length > 0) {
    lines.push('MISMATCHES DETECTED');
    lines.push('-'.repeat(80));
    lines.push('');

    for (const mismatch of report.mismatches) {
      lines.push(`Collection: ${mismatch.collectionName}`);
      lines.push(`Address: ${mismatch.contractAddress}`);
      lines.push(`Chain ID: ${mismatch.chainId}`);
      lines.push('');

      if (mismatch.issues && mismatch.issues.length > 0) {
        lines.push('Issues:');
        for (const issue of mismatch.issues) {
          lines.push(`  [${issue.severity.toUpperCase()}] ${issue.phaseName}`);
          lines.push(`    Expected Index: ${issue.expectedIndex}`);
          lines.push(`    Actual Index: ${issue.actualIndex}`);
          lines.push(`    Description: ${issue.description}`);
          lines.push('');
        }
      }

      lines.push('-'.repeat(80));
      lines.push('');
    }
  } else {
    lines.push('✅ NO MISMATCHES FOUND');
    lines.push('-'.repeat(80));
    lines.push('');
    lines.push('All collections have consistent phase indices!');
    lines.push('');
  }

  // Orphaned Whitelists
  if (report.orphanedWhitelists && report.orphanedWhitelists.length > 0) {
    lines.push('ORPHANED WHITELIST RECORDS');
    lines.push('-'.repeat(80));
    lines.push('');

    for (const orphaned of report.orphanedWhitelists) {
      lines.push(`Collection: ${orphaned.collectionName}`);
      lines.push(`Address: ${orphaned.contractAddress}`);
      lines.push(`Chain ID: ${orphaned.chainId}`);
      lines.push('');

      if (orphaned.orphanedRecords && orphaned.orphanedRecords.length > 0) {
        lines.push('Orphaned Phase IDs:');
        for (const record of orphaned.orphanedRecords) {
          lines.push(`  Phase ID ${record.phaseId}: ${record.addressCount} addresses`);
          const displayAddresses = record.addresses.slice(0, 5);
          lines.push(`    Addresses: ${displayAddresses.join(', ')}${record.addresses.length > 5 ? '...' : ''}`);
          lines.push('');
        }
      }

      lines.push('-'.repeat(80));
      lines.push('');
    }
  }

  lines.push('='.repeat(80));
  lines.push('END OF REPORT');
  lines.push('='.repeat(80));

  return lines.join('\n');
}

/**
 * Save report to file
 */
function saveReport(report: any, format: 'json' | 'text', customPath?: string): string {
  const timestamp = generateTimestamp();
  const reportsDir = ensureReportsDirectory();

  let filename: string;
  let content: string;

  if (customPath) {
    filename = customPath;
  } else {
    const extension = format === 'json' ? 'json' : 'txt';
    filename = path.join(reportsDir, `phase-verification-${timestamp}.${extension}`);
  }

  if (format === 'json') {
    content = formatReportAsJson(report);
  } else {
    content = formatReportAsText(report);
  }

  fs.writeFileSync(filename, content, 'utf-8');
  return filename;
}

/**
 * Print summary to console
 */
function printSummary(report: any) {
  console.log('\n' + '='.repeat(80));
  console.log('VERIFICATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Collections: ${report.totalCollections}`);
  console.log(`Collections Checked: ${report.collectionsChecked}`);
  console.log(`✅ Consistent: ${report.summary.consistent}`);
  console.log(`⚠️  Inconsistent: ${report.summary.inconsistent}`);
  console.log(`❌ Errors: ${report.summary.errors}`);
  if (report.summary.orphanedWhitelistRecords !== undefined) {
    console.log(`🗑️  Orphaned Whitelist Records: ${report.summary.orphanedWhitelistRecords}`);
  }
  console.log('='.repeat(80));

  if (report.summary.inconsistent > 0) {
    console.log('\n⚠️  MISMATCHES DETECTED:');
    console.log('-'.repeat(80));

    for (const mismatch of report.mismatches) {
      console.log(`\n📦 ${mismatch.collectionName} (${mismatch.contractAddress})`);
      console.log(`   Chain ID: ${mismatch.chainId}`);
      console.log(`   Issues: ${mismatch.issues.length}`);

      for (const issue of mismatch.issues) {
        const icon = issue.severity === 'critical' ? '❌' : '⚠️';
        console.log(`   ${icon} ${issue.phaseName}`);
        console.log(`      Expected: ${issue.expectedIndex}, Actual: ${issue.actualIndex}`);
        console.log(`      ${issue.description}`);
      }
    }

    console.log('\n' + '-'.repeat(80));
    console.log('💡 To fix these issues, run the repair script:');
    console.log('   npx tsx scripts/repair-phase-indices.ts --collection <address> --chain <chainId>');
  } else if (report.summary.errors > 0) {
    console.log('\n❌ ERRORS OCCURRED:');
    console.log('-'.repeat(80));
    console.log('Some collections could not be verified. Check the detailed report for more information.');
  } else {
    console.log('\n✅ ALL COLLECTIONS ARE CONSISTENT!');
    console.log('-'.repeat(80));
    console.log('No phase index mismatches detected.');
  }

  // Display orphaned whitelist information
  if (report.orphanedWhitelists && report.orphanedWhitelists.length > 0) {
    console.log('\n🗑️  ORPHANED WHITELIST RECORDS DETECTED:');
    console.log('-'.repeat(80));

    for (const orphaned of report.orphanedWhitelists) {
      console.log(`\n📦 ${orphaned.collectionName} (${orphaned.contractAddress})`);
      console.log(`   Chain ID: ${orphaned.chainId}`);
      console.log(`   Orphaned Phases: ${orphaned.orphanedRecords.length}`);

      for (const record of orphaned.orphanedRecords) {
        console.log(`   🗑️  Phase ID ${record.phaseId}: ${record.addressCount} addresses`);
        const displayAddresses = record.addresses.slice(0, 3);
        console.log(`      ${displayAddresses.join(', ')}${record.addresses.length > 3 ? '...' : ''}`);
      }
    }

    console.log('\n' + '-'.repeat(80));
    console.log('💡 To clean up orphaned whitelist records, run:');
    console.log('   npx tsx scripts/verify-phase-indices.ts --cleanup');
    console.log('   or for a specific collection:');
    console.log('   npx tsx scripts/verify-phase-indices.ts --collection <address> --chain <chainId> --cleanup');
  }

  console.log('\n');
}

/**
 * Verify all collections on specified chains
 */
async function verifyAllCollections(chainId?: number, cleanup: boolean = false) {
  console.log('🔍 Phase Index Verification');
  console.log('='.repeat(80));

  if (chainId) {
    console.log(`📊 Verifying collections on chain ${chainId}...`);
  } else {
    console.log('📊 Verifying collections on all chains...');
  }

  if (cleanup) {
    console.log(`🧹 Cleanup mode: ENABLED`);
  }

  console.log('');

  const service = new PhaseIndexVerificationService();

  // Get all chains to verify
  const chains = chainId
    ? await prisma.chain.findMany({ where: { chainId } })
    : await prisma.chain.findMany();

  if (chains.length === 0) {
    console.error('❌ No chains found in database');
    if (chainId) {
      console.error(`   Chain ID ${chainId} does not exist`);
    }
    process.exit(1);
  }

  console.log(`🔗 Found ${chains.length} chain(s) to verify\n`);

  // Aggregate report across all chains
  const aggregateReport = {
    totalCollections: 0,
    collectionsChecked: 0,
    mismatches: [] as any[],
    orphanedWhitelists: [] as any[],
    summary: {
      consistent: 0,
      inconsistent: 0,
      errors: 0,
      orphanedWhitelistRecords: 0
    },
    chains: [] as any[],
    cleanupResults: [] as any[]
  };

  // Verify each chain
  for (const chain of chains) {
    console.log(`\n🔗 Verifying chain: ${chain.name} (${chain.chainId})`);
    console.log('-'.repeat(80));

    try {
      const report = await service.verifyAllCollections(chain.chainId);

      // Add to aggregate
      aggregateReport.totalCollections += report.totalCollections;
      aggregateReport.collectionsChecked += report.collectionsChecked;
      aggregateReport.summary.consistent += report.summary.consistent;
      aggregateReport.summary.inconsistent += report.summary.inconsistent;
      aggregateReport.summary.errors += report.summary.errors;
      aggregateReport.mismatches.push(...report.mismatches);
      
      if (report.orphanedWhitelists) {
        aggregateReport.orphanedWhitelists.push(...report.orphanedWhitelists);
      }
      if (report.summary.orphanedWhitelistRecords !== undefined) {
        aggregateReport.summary.orphanedWhitelistRecords += report.summary.orphanedWhitelistRecords;
      }

      // Store chain-specific report
      aggregateReport.chains.push({
        chainId: chain.chainId,
        chainName: chain.name,
        report
      });

      console.log(`✅ Chain ${chain.chainId} verification complete`);

      // Cleanup orphaned whitelists if requested
      if (cleanup && report.orphanedWhitelists && report.orphanedWhitelists.length > 0) {
        console.log(`\n🧹 Cleaning up orphaned whitelists on chain ${chain.chainId}...`);

        for (const orphaned of report.orphanedWhitelists) {
          const cleanupResult = await service.cleanupOrphanedWhitelistsByCollection(
            orphaned.chainId,
            orphaned.contractAddress
          );

          aggregateReport.cleanupResults.push({
            contractAddress: orphaned.contractAddress,
            collectionName: orphaned.collectionName,
            chainId: orphaned.chainId,
            success: cleanupResult.success,
            deletedCount: cleanupResult.deletedCount,
            errors: cleanupResult.errors
          });

          if (cleanupResult.success) {
            console.log(`✅ ${orphaned.collectionName}: Cleaned up ${cleanupResult.deletedCount} records`);
          } else {
            console.error(`❌ ${orphaned.collectionName}: Cleanup failed:`, cleanupResult.errors);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error verifying chain ${chain.chainId}:`, error);
      aggregateReport.summary.errors++;
    }
  }

  return aggregateReport;
}

/**
 * Verify a specific collection
 */
async function verifySpecificCollection(chainId: number, collectionAddress: string, cleanup: boolean = false) {
  console.log('🔍 Phase Index Verification');
  console.log('='.repeat(80));
  console.log(`📦 Verifying collection: ${collectionAddress}`);
  console.log(`🔗 Chain ID: ${chainId}`);
  if (cleanup) {
    console.log(`🧹 Cleanup mode: ENABLED`);
  }
  console.log('');

  const service = new PhaseIndexVerificationService();

  try {
    const verification = await service.verifyCollection(chainId, collectionAddress);

    // Convert to report format
    const report = {
      totalCollections: 1,
      collectionsChecked: 1,
      mismatches: [] as any[],
      orphanedWhitelists: [] as any[],
      summary: {
        consistent: verification.consistent ? 1 : 0,
        inconsistent: verification.consistent ? 0 : 1,
        errors: 0,
        orphanedWhitelistRecords: 0
      },
      verification,
      cleanupResults: [] as any[]
    };

    if (!verification.consistent) {
      // Get collection name
      const launchpad = await prisma.launchpad.findFirst({
        where: {
          chainId,
          contractAddress: collectionAddress
        }
      });

      const issues = verification.phases
        .filter(p => !p.matches)
        .map(p => ({
          phaseName: p.phaseName,
          expectedIndex: p.contractIndex,
          actualIndex: p.databaseIndex ?? -1,
          severity: 'critical' as const,
          description: p.databaseIndex === null
            ? `Phase exists in contract at index ${p.contractIndex} but not found in database`
            : `Phase index mismatch: contract has ${p.contractIndex}, database has ${p.databaseIndex}`
        }));

      report.mismatches.push({
        contractAddress: collectionAddress,
        collectionName: launchpad?.name || 'Unknown',
        chainId,
        issues
      });
    }

    // Handle orphaned whitelists
    if (verification.orphanedWhitelists && verification.orphanedWhitelists.length > 0) {
      const launchpad = await prisma.launchpad.findFirst({
        where: {
          chainId,
          contractAddress: collectionAddress
        }
      });

      const totalOrphaned = verification.orphanedWhitelists.reduce(
        (sum, record) => sum + record.addressCount,
        0
      );

      report.orphanedWhitelists.push({
        contractAddress: collectionAddress,
        collectionName: launchpad?.name || 'Unknown',
        chainId,
        orphanedRecords: verification.orphanedWhitelists
      });

      report.summary.orphanedWhitelistRecords = totalOrphaned;

      // Cleanup if requested
      if (cleanup) {
        console.log('\n🧹 Cleaning up orphaned whitelist records...');
        const cleanupResult = await service.cleanupOrphanedWhitelistsByCollection(
          chainId,
          collectionAddress
        );

        report.cleanupResults.push({
          contractAddress: collectionAddress,
          success: cleanupResult.success,
          deletedCount: cleanupResult.deletedCount,
          errors: cleanupResult.errors
        });

        if (cleanupResult.success) {
          console.log(`✅ Cleaned up ${cleanupResult.deletedCount} orphaned whitelist records`);
        } else {
          console.error(`❌ Cleanup failed:`, cleanupResult.errors);
        }
      }
    }

    return report;
  } catch (error) {
    console.error(`❌ Error verifying collection:`, error);
    return {
      totalCollections: 1,
      collectionsChecked: 0,
      mismatches: [],
      orphanedWhitelists: [],
      summary: {
        consistent: 0,
        inconsistent: 0,
        errors: 1,
        orphanedWhitelistRecords: 0
      },
      error: String(error)
    };
  }
}

/**
 * Main function
 */
async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log('🚀 Starting Phase Index Verification CLI\n');

  let report: any;

  try {
    // Verify specific collection or all collections
    if (options.collectionAddress) {
      if (!options.chainId) {
        console.error('❌ Chain ID is required when verifying a specific collection');
        console.log('   Use: --chain <chainId> --collection <address>');
        process.exit(1);
      }

      report = await verifySpecificCollection(options.chainId, options.collectionAddress, options.cleanup);
    } else {
      report = await verifyAllCollections(options.chainId, options.cleanup);
    }

    // Print summary to console
    printSummary(report);

    // Save report to file
    const reportPath = saveReport(report, options.format, options.outputPath);
    console.log(`📄 Report saved to: ${reportPath}`);

    // Exit with appropriate code
    if (report.summary.inconsistent > 0 || report.summary.errors > 0) {
      console.log('\n⚠️  Verification completed with issues');
      process.exit(1);
    } else {
      console.log('\n✅ Verification completed successfully');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ Verification failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main()
    .catch((error) => {
      console.error('\n❌ Fatal error:', error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}

export { main as verifyPhaseIndices };
