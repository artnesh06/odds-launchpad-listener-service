/**
 * Verify Setup Script
 * Checks if all required configuration is in place
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SetupCheck {
  category: string;
  item: string;
  status: 'OK' | 'WARNING' | 'ERROR';
  message: string;
}

const checks: SetupCheck[] = [];

function addCheck(check: SetupCheck) {
  const icon =
    check.status === 'OK' ? '✅' : check.status === 'WARNING' ? '⚠️' : '❌';
  console.log(`${icon} ${check.category} - ${check.item}: ${check.message}`);
  checks.push(check);
}

/**
 * Check environment file
 */
function checkEnvironmentFile() {
  console.log('\n📋 Checking Environment Configuration...\n');

  const envPath = path.join(process.cwd(), '.env');
  const envExamplePath = path.join(process.cwd(), '.env.example');

  if (!fs.existsSync(envPath)) {
    addCheck({
      category: 'Environment',
      item: '.env file',
      status: 'ERROR',
      message: '.env file not found. Copy from .env.example',
    });
    return;
  }

  addCheck({
    category: 'Environment',
    item: '.env file',
    status: 'OK',
    message: 'Found',
  });

  // Check required variables
  const requiredVars = [
    'DATABASE_URL',
    'ALCHEMY_API_KEY_ETHEREUM',
    'RPC_URL_ETHEREUM',
  ];

  for (const varName of requiredVars) {
    if (process.env[varName]) {
      addCheck({
        category: 'Environment',
        item: varName,
        status: 'OK',
        message: 'Configured',
      });
    } else {
      addCheck({
        category: 'Environment',
        item: varName,
        status: 'ERROR',
        message: 'Not configured',
      });
    }
  }

  // Check optional variables
  const optionalVars = [
    'ALCHEMY_API_KEY_POLYGON',
    'ALCHEMY_API_KEY_ARBITRUM',
    'ALCHEMY_API_KEY_OPTIMISM',
    'ALCHEMY_API_KEY_BASE',
    'REDIS_URL',
  ];

  for (const varName of optionalVars) {
    if (process.env[varName]) {
      addCheck({
        category: 'Environment',
        item: varName,
        status: 'OK',
        message: 'Configured',
      });
    } else {
      addCheck({
        category: 'Environment',
        item: varName,
        status: 'WARNING',
        message: 'Not configured (optional)',
      });
    }
  }
}

/**
 * Check database connection
 */
async function checkDatabase() {
  console.log('\n🗄️  Checking Database...\n');

  try {
    await prisma.$queryRaw`SELECT 1`;
    addCheck({
      category: 'Database',
      item: 'Connection',
      status: 'OK',
      message: 'Connected successfully',
    });

    // Check chains
    const chainCount = await prisma.chain.count();
    if (chainCount > 0) {
      addCheck({
        category: 'Database',
        item: 'Chains',
        status: 'OK',
        message: `${chainCount} chains configured`,
      });
    } else {
      addCheck({
        category: 'Database',
        item: 'Chains',
        status: 'WARNING',
        message: 'No chains configured. Run seed script.',
      });
    }

    // Check NFT data
    const nftCount = await prisma.nFT.count();
    addCheck({
      category: 'Database',
      item: 'NFT Data',
      status: nftCount > 0 ? 'OK' : 'WARNING',
      message:
        nftCount > 0
          ? `${nftCount} NFTs indexed`
          : 'No NFTs yet. Start indexing.',
    });

    // Check marketplace data
    const salesCount = await prisma.marketplaceSale.count();
    addCheck({
      category: 'Database',
      item: 'Marketplace Data',
      status: salesCount > 0 ? 'OK' : 'WARNING',
      message:
        salesCount > 0
          ? `${salesCount} sales recorded`
          : 'No sales yet. Start indexing.',
    });
  } catch (error) {
    addCheck({
      category: 'Database',
      item: 'Connection',
      status: 'ERROR',
      message: `Failed to connect: ${error}`,
    });
  }
}

/**
 * Check required directories
 */
function checkDirectories() {
  console.log('\n📁 Checking Directories...\n');

  const requiredDirs = [
    'src/lib/listeners',
    'src/lib/handlers',
    'src/lib/processors',
    'src/lib/analytics',
    'src/lib/cache',
    'src/lib/monitoring',
    'src/lib/validation',
    'src/lib/queries',
    'scripts',
    'docs',
  ];

  for (const dir of requiredDirs) {
    const dirPath = path.join(process.cwd(), dir);
    if (fs.existsSync(dirPath)) {
      addCheck({
        category: 'Directories',
        item: dir,
        status: 'OK',
        message: 'Exists',
      });
    } else {
      addCheck({
        category: 'Directories',
        item: dir,
        status: 'ERROR',
        message: 'Missing',
      });
    }
  }
}

/**
 * Check documentation
 */
function checkDocumentation() {
  console.log('\n📚 Checking Documentation...\n');

  const requiredDocs = [
    'docs/API_DOCUMENTATION.md',
    'docs/DEPLOYMENT_GUIDE.md',
    'NFT_INDEXER_IMPLEMENTATION_SUMMARY.md',
    'NFT_INDEXER_QUICK_START.md',
    'MIGRATION_GUIDE.md',
  ];

  for (const doc of requiredDocs) {
    const docPath = path.join(process.cwd(), doc);
    if (fs.existsSync(docPath)) {
      addCheck({
        category: 'Documentation',
        item: path.basename(doc),
        status: 'OK',
        message: 'Available',
      });
    } else {
      addCheck({
        category: 'Documentation',
        item: path.basename(doc),
        status: 'WARNING',
        message: 'Missing',
      });
    }
  }
}

/**
 * Generate setup report
 */
function generateReport() {
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 Setup Verification Summary:\n');

  const okCount = checks.filter((c) => c.status === 'OK').length;
  const warningCount = checks.filter((c) => c.status === 'WARNING').length;
  const errorCount = checks.filter((c) => c.status === 'ERROR').length;

  console.log(`   Total Checks: ${checks.length}`);
  console.log(`   ✅ OK: ${okCount}`);
  console.log(`   ⚠️  Warnings: ${warningCount}`);
  console.log(`   ❌ Errors: ${errorCount}`);

  if (errorCount > 0) {
    console.log('\n❌ Critical Issues Found:\n');
    checks
      .filter((c) => c.status === 'ERROR')
      .forEach((check) => {
        console.log(`   - ${check.category} / ${check.item}: ${check.message}`);
      });
    console.log('\n⚠️  Please fix these issues before proceeding.');
  }

  if (warningCount > 0 && errorCount === 0) {
    console.log('\n⚠️  Warnings (non-critical):\n');
    checks
      .filter((c) => c.status === 'WARNING')
      .forEach((check) => {
        console.log(`   - ${check.category} / ${check.item}: ${check.message}`);
      });
    console.log('\n💡 These are optional but recommended.');
  }

  if (errorCount === 0 && warningCount === 0) {
    console.log('\n✅ Perfect! All checks passed.');
    console.log('\n🚀 Your NFT Indexer is ready to go!');
    console.log('\nNext steps:');
    console.log('   1. npm run dev (start development server)');
    console.log('   2. Check health: curl http://localhost:3000/api/health');
    console.log('   3. Start indexing: See NFT_INDEXER_QUICK_START.md');
  } else if (errorCount === 0) {
    console.log('\n✅ Setup is functional with minor warnings.');
    console.log('\n🚀 You can proceed with deployment.');
    console.log('\nNext steps:');
    console.log('   1. Review warnings above');
    console.log('   2. npm run dev (start development server)');
    console.log('   3. See NFT_INDEXER_QUICK_START.md for next steps');
  }

  console.log('\n' + '='.repeat(60));
}

/**
 * Main verification function
 */
async function verifySetup() {
  console.log('🔍 NFT Indexer Setup Verification');
  console.log('='.repeat(60));

  checkEnvironmentFile();
  await checkDatabase();
  checkDirectories();
  checkDocumentation();

  generateReport();
}

// Run if called directly
if (require.main === module) {
  verifySetup()
    .catch((error) => {
      console.error('\n❌ Verification failed:', error);
      process.exit(1);
    })
    .finally(() => {
      prisma.$disconnect();
    });
}

export { verifySetup };
