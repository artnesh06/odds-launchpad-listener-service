/**
 * Register Launchpad to Database
 * 
 * Manually register a launchpad that was deployed directly (not via factory)
 * 
 * Usage:
 * npm run register -- --chain 6343 --address 0x123...
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { getChainConfig } from '../config/chains';
import { prisma } from '../config/database';
import OddsLaunchpadABI from '../../abi/OddsLaunchpad.json';

async function main() {
  try {
    const args = process.argv.slice(2);
    const chainIdArg = args.find(arg => arg.startsWith('--chain='));
    const addressArg = args.find(arg => arg.startsWith('--address='));

    if (!chainIdArg || !addressArg) {
      console.error('❌ Missing required arguments');
      console.log('\nUsage: npm run register -- --chain=6343 --address=0x123...');
      console.log('\nExample:');
      console.log('  npm run register -- --chain=6343 --address=0x04336824B4E8e43c40a05Fb40A2f22ff4A6d3198');
      process.exit(1);
    }

    const chainId = parseInt(chainIdArg.split('=')[1]);
    const launchpadAddress = addressArg.split('=')[1].toLowerCase();

    if (!ethers.isAddress(launchpadAddress)) {
      console.error('❌ Invalid address');
      process.exit(1);
    }

    console.log(`🔍 Registering launchpad...`);
    console.log(`   Chain ID: ${chainId}`);
    console.log(`   Address: ${launchpadAddress}`);

    // Get chain config
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig) {
      throw new Error(`Chain config not found for chainId ${chainId}`);
    }

    // Setup provider
    const rpcUrl = chainConfig.rpcUrl.replace('wss://', 'https://').replace('/ws/', '/');
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Get factory from database
    const chain = await prisma.chain.findUnique({
      where: { chainId },
      include: {
        factories: {
          where: { isActive: true }
        }
      }
    });

    if (!chain || chain.factories.length === 0) {
      throw new Error(`No active factory found for chain ${chainId}`);
    }

    const factory = chain.factories[0];
    console.log(`🏭 Factory: ${factory.contractAddress}`);

    // Check if launchpad already exists
    const existing = await prisma.launchpad.findUnique({
      where: { contractAddress: launchpadAddress }
    });

    if (existing) {
      console.log(`⚠️  Launchpad already registered!`);
      console.log(`   ID: ${existing.id}`);
      console.log(`   Name: ${existing.name}`);
      return;
    }

    // Get launchpad info from contract
    console.log(`\n📡 Fetching contract info...`);
    const launchpad = new ethers.Contract(
      launchpadAddress,
      OddsLaunchpadABI,
      provider
    );

    const [name, symbol, totalSupply, owner] = await Promise.all([
      launchpad.name(),
      launchpad.symbol(),
      launchpad.totalSupply(),
      launchpad.owner()
    ]);

    let treasury: string;
    try {
      treasury = await launchpad.treasury();
    } catch {
      treasury = owner;
    }

    // Try to get isShuffleEnabled (new field, may not exist in older contracts)
    let isShuffleEnabled = false;
    try {
      isShuffleEnabled = await launchpadContract.isShuffleEnabled();
    } catch {
      // If isShuffleEnabled() fails (older contract version), default to false
      console.log(`   isShuffleEnabled: Not available (older contract), defaulting to false`);
    }

    console.log(`   Name: ${name}`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Total Supply: ${totalSupply}`);
    console.log(`   Owner: ${owner}`);
    console.log(`   Treasury: ${treasury}`);
    console.log(`   Shuffle Enabled: ${isShuffleEnabled}`);

    // Create launchpad in database
    console.log(`\n💾 Saving to database...`);
    const created = await prisma.launchpad.create({
      data: {
        chainId,
        factoryId: factory.id,
        contractAddress: launchpadAddress,
        creator: owner,
        treasury,
        name,
        symbol,
        totalMaxSupply: Number(totalSupply),
        mintedCount: 0,
        isShuffleEnabled: isShuffleEnabled,
        status: 'ACTIVE',
        createdAt: new Date()
      }
    });

    console.log(`✅ Launchpad registered successfully!`);
    console.log(`   Database ID: ${created.id}`);
    console.log(`   Name: ${created.name}`);
    console.log(`   Address: ${created.contractAddress}`);

    console.log(`\n🎯 Next steps:`);
    console.log(`   1. Listener will now monitor this launchpad`);
    console.log(`   2. Test events: npm run test-events -- --chain=${chainId} --launchpad=${launchpadAddress}`);
    console.log(`   3. Check activities in database`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
