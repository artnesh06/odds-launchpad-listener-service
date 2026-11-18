/**
 * Deploy Launchpad Script
 * 
 * Deploy new launchpad contract directly via factory
 * 
 * Usage:
 * npm run deploy -- --chain 6343 --name "My Collection" --symbol "MC"
 * 
 * Requirements:
 * - TEST_PRIVATE_KEY or TEST_MNEMONIC in .env
 * - Testnet ETH for gas
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { getChainConfig } from '../config/chains';
import { prisma } from '../config/database';
import OddsLaunchpadFactoryABI from '../../abi/OddsLaunchpadFactory.json';
import OddsLaunchpadABI from '../../abi/OddsLaunchpad.json';

interface DeployConfig {
  chainId: number;
  name: string;
  symbol: string;
  maxSupply?: number;
}

class LaunchpadDeployer {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet | ethers.HDNodeWallet;
  private config: DeployConfig;
  private factoryAddress: string = '';

  constructor(config: DeployConfig) {
    this.config = config;

    // Get chain config
    const chainConfig = getChainConfig(config.chainId);
    if (!chainConfig) {
      throw new Error(`Chain config not found for chainId ${config.chainId}`);
    }

    // Setup provider
    const rpcUrl = chainConfig.rpcUrl.replace('wss://', 'https://').replace('/ws/', '/');
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    // Setup wallet
    if (process.env.TEST_PRIVATE_KEY) {
      this.wallet = new ethers.Wallet(process.env.TEST_PRIVATE_KEY, this.provider);
    } else if (process.env.TEST_MNEMONIC) {
      this.wallet = ethers.Wallet.fromPhrase(process.env.TEST_MNEMONIC, this.provider);
    } else {
      throw new Error('TEST_PRIVATE_KEY or TEST_MNEMONIC not found in .env');
    }

    console.log(`🔧 Deploy Configuration:`);
    console.log(`   Chain ID: ${config.chainId}`);
    console.log(`   Wallet: ${this.wallet.address}`);
    console.log(`   Name: ${config.name}`);
    console.log(`   Symbol: ${config.symbol}`);
    console.log(`   Max Supply: ${config.maxSupply || 10000}`);
  }

  async checkBalance(): Promise<void> {
    const balance = await this.provider.getBalance(this.wallet.address);
    const balanceInEth = ethers.formatEther(balance);
    console.log(`💰 Wallet Balance: ${balanceInEth} ETH`);

    if (balance === 0n) {
      throw new Error('Wallet has no balance. Please fund with testnet ETH.');
    }
  }

  async getFactoryAddress(): Promise<void> {
    const chain = await prisma.chain.findUnique({
      where: { chainId: this.config.chainId },
      include: {
        factories: {
          where: { isActive: true }
        }
      }
    });

    if (!chain || chain.factories.length === 0) {
      throw new Error(`No active factory found for chain ${this.config.chainId}`);
    }

    this.factoryAddress = chain.factories[0].contractAddress;
    console.log(`🏭 Factory Address: ${this.factoryAddress}`);
  }

  async deployDirectly(): Promise<string> {
    console.log(`\n📝 Deploying launchpad directly...`);
    
    // Load artifact with bytecode
    const OddsLaunchpadArtifact = await import('../../abi/OddsLaunchpadArtifact.json');
    
    // Prepare collection config
    const collectionConfig = {
      name: this.config.name,
      symbol: this.config.symbol,
      baseURI: '',
      unrevealedURI: '',
      contractURI: '',
      externalLink: '',
      totalMaxSupply: this.config.maxSupply || 10000,
      treasury: this.wallet.address,
      royaltyRecipient: this.wallet.address,
      royaltyPercentage: 500, // 5%
      isRevealed: false,
      transfersEnabled: true,
      isOpenEdition: false,
      isShuffleEnabled: false, // Token ID shuffling disabled by default
      chainId: this.config.chainId
    };

    // Prepare initial phase (optional)
    const initialPhases = [{
      name: 'Public Mint',
      startTime: Math.floor(Date.now() / 1000),
      endTime: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days
      price: ethers.parseEther('0.001'),
      maxSupply: this.config.maxSupply || 10000,
      maxPerWallet: 10,
      maxPerTransaction: 5,
      merkleRoot: ethers.ZeroHash,
      isActive: true,
      requiresWhitelist: false,
      currentSupply: 0 // Initial supply is 0
    }];

    console.log(`   Creating contract factory...`);
    const ContractFactory = new ethers.ContractFactory(
      OddsLaunchpadArtifact.abi,
      OddsLaunchpadArtifact.bytecode,
      this.wallet
    );

    console.log(`   Deploying contract...`);
    console.log(`   This may take a while...`);
    
    const contract = await ContractFactory.deploy(
      collectionConfig,
      this.wallet.address, // collection owner
      initialPhases
    );

    console.log(`   Waiting for deployment...`);
    const txHash = contract.deploymentTransaction()?.hash;
    console.log(`   TX: ${txHash}`);
    console.log(`   This may take 30-60 seconds on MegaETH...`);
    console.log(`   You can check status: npm run check-deploy -- --chain=${this.config.chainId} --tx=${txHash}`);
    
    // Try to wait for deployment with polling
    let address: string | null = null;
    let attempts = 0;
    const maxAttempts = 30; // 30 attempts * 4 seconds = 2 minutes
    
    while (!address && attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`   Attempt ${attempts}/${maxAttempts}...`);
        
        // Check if receipt is available
        const receipt = await this.provider.getTransactionReceipt(txHash!);
        
        if (receipt) {
          if (receipt.status === 1 && receipt.contractAddress) {
            address = receipt.contractAddress;
            console.log(`   ✅ Deployed at: ${address}`);
            break;
          } else if (receipt.status === 0) {
            throw new Error('Deployment transaction failed');
          }
        }
        
        // Wait 4 seconds before next attempt
        await new Promise(resolve => setTimeout(resolve, 4000));
        
      } catch (error: any) {
        if (error.message.includes('failed')) {
          throw error;
        }
        // Continue polling
      }
    }
    
    if (!address) {
      console.log(`\n⏳ Deployment is taking longer than expected.`);
      console.log(`   Transaction: ${txHash}`);
      console.log(`   Check status with: npm run check-deploy -- --chain=${this.config.chainId} --tx=${txHash}`);
      console.log(`   Or check block explorer: https://explorer.megaeth.io/tx/${txHash}`);
      throw new Error('Deployment timeout - but transaction may still succeed');
    }
    
    return address;
  }

  async run(): Promise<void> {
    console.log(`\n🚀 Launchpad Deployment Script\n`);
    console.log(`=`.repeat(60));

    try {
      await this.checkBalance();
      await this.getFactoryAddress();
      
      // Deploy directly
      const launchpadAddress = await this.deployDirectly();
      
      console.log(`\n✅ Deployment successful!`);
      console.log(`\n📋 Launchpad Details:`);
      console.log(`   Address: ${launchpadAddress}`);
      console.log(`   Name: ${this.config.name}`);
      console.log(`   Symbol: ${this.config.symbol}`);
      console.log(`   Max Supply: ${this.config.maxSupply || 10000}`);
      console.log(`   Owner: ${this.wallet.address}`);
      
      console.log(`\n🎯 Next Steps:`);
      console.log(`\n1. Wait for listener to detect deployment (if running)`);
      console.log(`   npm start`);
      console.log(`\n2. Or scan historical events:`);
      console.log(`   npm run scan-history -- --chain=${this.config.chainId} --from=BLOCK_NUMBER`);
      console.log(`\n3. Test all events:`);
      console.log(`   npm run test-events -- --chain=${this.config.chainId} --launchpad=${launchpadAddress}`);
      console.log(`\n4. Or auto-test:`);
      console.log(`   npm run deploy-test -- --chain=${this.config.chainId}`);
      
      console.log(`\n` + `=`.repeat(60));

    } catch (error) {
      console.error(`\n❌ Error:`, error);
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const chainIdArg = args.find(arg => arg.startsWith('--chain='));
    const nameArg = args.find(arg => arg.startsWith('--name='));
    const symbolArg = args.find(arg => arg.startsWith('--symbol='));
    const maxSupplyArg = args.find(arg => arg.startsWith('--maxSupply='));

    if (!chainIdArg) {
      console.error('❌ Missing required arguments');
      console.log('\nUsage: npm run deploy -- --chain=6343 --name="My Collection" --symbol="MC"');
      console.log('\nExample:');
      console.log('  npm run deploy -- --chain=6343 --name="Test NFT" --symbol="TEST" --maxSupply=10000');
      process.exit(1);
    }

    const chainId = parseInt(chainIdArg.split('=')[1]);
    const name = nameArg ? nameArg.split('=')[1].replace(/"/g, '') : 'Test Collection';
    const symbol = symbolArg ? symbolArg.split('=')[1].replace(/"/g, '') : 'TEST';
    const maxSupply = maxSupplyArg ? parseInt(maxSupplyArg.split('=')[1]) : 10000;

    const config: DeployConfig = {
      chainId,
      name,
      symbol,
      maxSupply
    };

    const deployer = new LaunchpadDeployer(config);
    await deployer.run();

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
