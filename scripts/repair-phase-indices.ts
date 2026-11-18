/**
 * Phase Index Repair CLI Script
 * 
 * Repairs phase index inconsistencies by re-syncing from smart contracts.
 * Includes dry-run mode, confirmation prompts, and rollback on error.
 * 
 * Requirements: 8.4
 * 
 * Usage:
 *   npx tsx scripts/repair-phase-indices.ts [options]
 * 
 * Options:
 *   --chain <chainId>              Chain ID (required)
 *   --collection <address>         Collection address to repair (required)
 *   --dry-run                      Preview changes without applying them
 *   --yes, -y                      Skip confirmation prompt
 *   --output <path>                Custom output file path for report
 *   --help                         Show help message
 * 
 * Examples:
 *   # Dry-run to preview changes
 *   npx tsx scripts/repair-phase-indices.ts --chain 11155111 --collection 0x1234... --dry-run
 * 
 *   # Repair with confirmation prompt
 *   npx tsx scripts/repair-phase-indices.ts --chain 11155111 --collection 0x1234...
 * 
 *   # Repair without confirmation (use with caution!)
 *   npx tsx scripts/repair-phase-indices.ts --chain 11155111 --collection 0x1234... --yes
 */

import { PrismaClient } from '@prisma/client';
import { PhaseIndexVerificationService } from '../src/lib/blockchain/services/phase-index-verification-service';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface CliOptions {
  chainId?: number;
  collectionAddress?: string;
  dryRun: boolean;
  skipConfirmation: boolean;
  outputPath?: string;
  help: boolean;
}

/**
 * Parse command-line arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    dryRun: false,
    skipConfirmation: false,
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

      case '--dry-run':
        options.dryRun = true;
        break;

      case '--yes':
      case '-y':
        options.skipConfirmation = true;
        break;

      case '--output':
        options.outputPath = args[++i];
        if (!options.outputPath) {
          console.error('❌ Output path is required after --output');
          process.exit(1);
        }
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
Phase Index Repair CLI

Repairs phase index inconsistencies by re-syncing from smart contracts.
Includes dry-run mode, confirmation prompts, and rollback on error.

Usage:
  npx tsx scripts/repair-phase-indices.ts [options]

Options:
  --chain <chainId>              Chain ID (required)
  --collection <address>         Collection address to repair (required)
  --dry-run                      Preview changes without applying them
  --yes, -y                      Skip confirmation prompt
  --output <path>                Custom output file path for report
  --help, -h                     Show this help message

Examples:
  # Dry-run to preview changes
  npx tsx scripts/repair-phase-indices.ts --chain 11155111 --collection 0x1234... --dry-run

  # Repair with confirmation prompt
  npx tsx scripts/repair-phase-indices.ts --chain 11155111 --collection 0x1234...

  # Repair without confirmation (use with caution!)
  npx tsx scripts/repair-phase-indices.ts --chain 11155111 --collection 0x1234... --yes

  # Save repair report to custom location
  npx tsx scripts/repair-phase-indices.ts --chain 11155111 --collection 0x1234... --output ./repair-report.json

Safety Features:
  - Dry-run mode to preview changes before applying
  - Confirmation prompt before making changes (unless --yes is used)
  - Automatic rollback on error
  - Detailed logging of all operations
  - Report generation for audit trail
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
 * Save repair report to file
 */
function saveReport(report: any, customPath?: string): string {
  const timestamp = generateTimestamp();
  const reportsDir = ensureReportsDirectory();

  const filename = customPath || path.join(reportsDir, `phase-repair-${timestamp}.json`);
  const content = JSON.stringify(report, null, 2);

  fs.writeFileSync(filename, content, 'utf-8');
  return filename;
}

/**
 * Ask user for confirmation
 */
async function askConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === 'yes' || normalized === 'y');
    });
  });
}

/**
 * Perform dry-run verification
 */
async function performDryRun(chainId: number, collectionAddress: string) {
  console.log('🔍 DRY-RUN MODE: Analyzing changes without applying them');
  console.log('='.repeat(80));
  console.log('');

  const service = new PhaseIndexVerificationService();

  try {
    // First verify to see what needs to be fixed
    console.log('📊 Step 1: Verifying current state...\n');
    const verification = await service.verifyCollection(chainId, collectionAddress);

    console.log(`📦 Collection: ${collectionAddress}`);
    console.log(`🔗 Chain ID: ${chainId}`);
    console.log(`📈 Contract Phase Count: ${verification.contractPhaseCount}`);
    console.log(`💾 Database Phase Count: ${verification.databasePhaseCount}`);
    console.log(`✅ Consistent: ${verification.consistent ? 'Yes' : 'No'}`);
    console.log('');

    if (verification.consistent) {
      console.log('✅ No repairs needed! Phase indices are already consistent.');
      console.log('');
      return {
        needsRepair: false,
        verification
      };
    }

    // Show what would be changed
    console.log('📋 Changes that would be made:');
    console.log('-'.repeat(80));
    console.log('');

    const issues = verification.phases.filter(p => !p.matches);
    
    if (issues.length === 0 && verification.contractPhaseCount !== verification.databasePhaseCount) {
      console.log('⚠️  Phase count mismatch detected:');
      console.log(`   Contract has ${verification.contractPhaseCount} phases`);
      console.log(`   Database has ${verification.databasePhaseCount} phases`);
      console.log('');
      console.log('🔧 Repair would:');
      console.log('   1. Delete all existing phases from database');
      console.log(`   2. Re-sync ${verification.contractPhaseCount} phases from contract`);
      console.log('   3. Verify indices match contract');
    } else {
      console.log('⚠️  Phase index mismatches detected:');
      console.log('');

      for (const phase of issues) {
        console.log(`   Phase: ${phase.phaseName}`);
        console.log(`   Contract Index: ${phase.contractIndex}`);
        console.log(`   Database Index: ${phase.databaseIndex ?? 'NOT FOUND'}`);
        console.log(`   Action: ${phase.databaseIndex === null ? 'CREATE' : 'UPDATE'}`);
        console.log('');
      }

      console.log('🔧 Repair would:');
      console.log('   1. Backup existing phases for rollback');
      console.log('   2. Delete all existing phases from database');
      console.log(`   3. Re-sync ${verification.contractPhaseCount} phases from contract`);
      console.log('   4. Verify indices match contract');
      console.log('   5. Rollback if any errors occur');
    }

    console.log('');
    console.log('-'.repeat(80));
    console.log('');
    console.log('💡 To apply these changes, run without --dry-run flag:');
    console.log(`   npx tsx scripts/repair-phase-indices.ts --chain ${chainId} --collection ${collectionAddress}`);
    console.log('');

    return {
      needsRepair: true,
      verification,
      issueCount: issues.length
    };
  } catch (error) {
    console.error('❌ Dry-run failed:', error);
    throw error;
  }
}

/**
 * Perform actual repair
 */
async function performRepair(
  chainId: number,
  collectionAddress: string,
  skipConfirmation: boolean
) {
  console.log('🔧 REPAIR MODE: Fixing phase index inconsistencies');
  console.log('='.repeat(80));
  console.log('');

  const service = new PhaseIndexVerificationService();

  try {
    // First verify to show what will be fixed
    console.log('📊 Step 1: Verifying current state...\n');
    const verification = await service.verifyCollection(chainId, collectionAddress);

    console.log(`📦 Collection: ${collectionAddress}`);
    console.log(`🔗 Chain ID: ${chainId}`);
    console.log(`📈 Contract Phase Count: ${verification.contractPhaseCount}`);
    console.log(`💾 Database Phase Count: ${verification.databasePhaseCount}`);
    console.log(`✅ Consistent: ${verification.consistent ? 'Yes' : 'No'}`);
    console.log('');

    if (verification.consistent) {
      console.log('✅ No repairs needed! Phase indices are already consistent.');
      console.log('');
      return {
        success: true,
        phasesRepaired: 0,
        errors: [],
        skipped: true,
        message: 'No repairs needed'
      };
    }

    // Show what will be changed
    const issues = verification.phases.filter(p => !p.matches);
    console.log(`⚠️  Found ${issues.length} phase index issue(s)`);
    console.log('');

    // Ask for confirmation unless skipped
    if (!skipConfirmation) {
      console.log('⚠️  WARNING: This operation will:');
      console.log('   1. Delete all existing phases from database');
      console.log(`   2. Re-sync ${verification.contractPhaseCount} phases from contract`);
      console.log('   3. Automatic rollback will occur if any errors happen');
      console.log('');

      const confirmed = await askConfirmation('Do you want to proceed with the repair?');

      if (!confirmed) {
        console.log('');
        console.log('❌ Repair cancelled by user');
        console.log('');
        return {
          success: false,
          phasesRepaired: 0,
          errors: ['Cancelled by user'],
          cancelled: true
        };
      }
    }

    console.log('');
    console.log('🔧 Step 2: Performing repair...\n');

    // Perform the repair
    const result = await service.repairCollection(chainId, collectionAddress);

    console.log('');
    if (result.success) {
      console.log('✅ Repair completed successfully!');
      console.log(`   Phases repaired: ${result.phasesRepaired}`);
    } else {
      console.log('❌ Repair failed!');
      console.log(`   Errors: ${result.errors.length}`);
      for (const error of result.errors) {
        console.log(`   - ${error}`);
      }
    }
    console.log('');

    // Verify repair was successful
    if (result.success) {
      console.log('🔍 Step 3: Verifying repair...\n');
      const postVerification = await service.verifyCollection(chainId, collectionAddress);

      if (postVerification.consistent) {
        console.log('✅ Post-repair verification passed!');
        console.log('   All phase indices are now consistent.');
      } else {
        console.log('⚠️  Post-repair verification found issues!');
        console.log('   Some inconsistencies may remain.');
        result.success = false;
        result.errors.push('Post-repair verification failed');
      }
      console.log('');
    }

    return result;
  } catch (error) {
    console.error('❌ Repair failed with error:', error);
    return {
      success: false,
      phasesRepaired: 0,
      errors: [String(error)]
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

  // Validate required options
  if (!options.chainId) {
    console.error('❌ Chain ID is required');
    console.log('   Use: --chain <chainId>');
    console.log('   Example: --chain 11155111');
    console.log('');
    console.log('Use --help for more information');
    process.exit(1);
  }

  if (!options.collectionAddress) {
    console.error('❌ Collection address is required');
    console.log('   Use: --collection <address>');
    console.log('   Example: --collection 0x1234567890123456789012345678901234567890');
    console.log('');
    console.log('Use --help for more information');
    process.exit(1);
  }

  console.log('🚀 Starting Phase Index Repair CLI\n');

  try {
    let result: any;

    if (options.dryRun) {
      // Dry-run mode
      result = await performDryRun(options.chainId, options.collectionAddress);
      
      // Save dry-run report
      const report = {
        mode: 'dry-run',
        timestamp: new Date().toISOString(),
        chainId: options.chainId,
        collectionAddress: options.collectionAddress,
        ...result
      };

      if (options.outputPath || result.needsRepair) {
        const reportPath = saveReport(report, options.outputPath);
        console.log(`📄 Dry-run report saved to: ${reportPath}`);
        console.log('');
      }

      process.exit(result.needsRepair ? 1 : 0);
    } else {
      // Actual repair mode
      result = await performRepair(
        options.chainId,
        options.collectionAddress,
        options.skipConfirmation
      );

      // Save repair report
      const report = {
        mode: 'repair',
        timestamp: new Date().toISOString(),
        chainId: options.chainId,
        collectionAddress: options.collectionAddress,
        ...result
      };

      const reportPath = saveReport(report, options.outputPath);
      console.log(`📄 Repair report saved to: ${reportPath}`);
      console.log('');

      // Exit with appropriate code
      if (result.success) {
        console.log('✅ Repair completed successfully');
        process.exit(0);
      } else if (result.cancelled) {
        console.log('⚠️  Repair was cancelled');
        process.exit(2);
      } else {
        console.log('❌ Repair failed');
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    
    // Save error report
    const errorReport = {
      mode: options.dryRun ? 'dry-run' : 'repair',
      timestamp: new Date().toISOString(),
      chainId: options.chainId,
      collectionAddress: options.collectionAddress,
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined
    };

    try {
      const reportPath = saveReport(errorReport, options.outputPath);
      console.log(`📄 Error report saved to: ${reportPath}`);
    } catch (saveError) {
      console.error('Failed to save error report:', saveError);
    }

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

export { main as repairPhaseIndices };
