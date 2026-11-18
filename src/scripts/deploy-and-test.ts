/**
 * Deploy and Test Script
 * 
 * Deploy new launchpad contract and test all events
 * 
 * Usage:
 * npm run deploy-test -- --chain 11155111
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
}

class DeployAndTester {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet | ethers.HDNodeWallet;
  private config: DeployConfig;
  private factoryAddress: string = '';
  private launchpadAddress: string = '';

  constructor(config: DeployConfig) {
    this.config = config;

    // Get chain config
    const chainConfig = getChainConfig(config.chainId);
    if (!chainConfig) {
      throw new Error(`Chain config not found for chainId ${config.chainId}`);
    }

    // Setup provider (use HTTP for testing)
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

    console.log(`🔧 Configuration:`);
    console.log(`   Chain ID: ${config.chainId}`);
    console.log(`   Wallet: ${this.wallet.address}`);
  }

  /**
   * Check wallet balance
   */
  async checkBalance(): Promise<void> {
    const balance = await this.provider.getBalance(this.wallet.address);
    const balanceInEth = ethers.formatEther(balance);
    console.log(`💰 Wallet Balance: ${balanceInEth} ETH`);

    if (balance === 0n) {
      throw new Error('Wallet has no balance. Please fund with testnet ETH.');
    }
  }

  /**
   * Get factory address from database
   */
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

  /**
   * Deploy new launchpad via web app or direct contract call
   * For simplicity, we'll use the factory's deployMasterContract if available
   * Otherwise, user should deploy via web app first
   */
  async deployLaunchpad(): Promise<void> {
    console.log(`\n📝 Deploying new launchpad...`);
    console.log(`⚠️  Please deploy a new launchpad via the web app using wallet: ${this.wallet.address}`);
    console.log(`⚠️  After deployment, enter the launchpad address below.`);
    console.log(`\n💡 Or use existing launchpad where you are the owner.`);
    
    // For now, we'll ask user to provide the address
    // In production, this would integrate with the actual deployment flow
    throw new Error('Please deploy launchpad via web app first, then use: npm run test-events -- --chain=CHAIN_ID --launchpad=ADDRESS');
  }

  /**
   * Alternative: Use existing launchpad where wallet is owner
   */
  async findOwnedLaunchpad(): Promise<string | null> {
    console.log(`\n🔍 Looking for launchpads owned by ${this.wallet.address}...`);
    
    // Try both lowercase and original case
    const launchpads = await prisma.launchpad.findMany({
      where: {
        chainId: this.config.chainId,
        OR: [
          { creator: this.wallet.address.toLowerCase() },
          { creator: this.wallet.address }
        ]
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    console.log(`   Found ${launchpads.length} launchpads on chain ${this.config.chainId}`);

    if (launchpads.length > 0) {
      // Check ownership via contract call to be sure
      for (const lp of launchpads) {
        try {
          const contract = new ethers.Contract(
            lp.contractAddress,
            OddsLaunchpadABI,
            this.provider
          );
          const owner = await contract.owner();
          
          if (owner.toLowerCase() === this.wallet.address.toLowerCase()) {
            console.log(`✅ Found owned launchpad: ${lp.contractAddress}`);
            console.log(`   Name: ${lp.name}`);
            return lp.contractAddress;
          }
        } catch (error) {
          // Skip if contract call fails
          continue;
        }
      }
    }

    console.log(`⚠️  No owned launchpad found.`);
    return null;
  }

  /**
   * Test all events on the launchpad
   */
  async testAllEvents(launchpadAddress: string): Promise<void> {
    console.log(`\n🧪 Testing all events on ${launchpadAddress}...`);
    
    const launchpad = new ethers.Contract(
      launchpadAddress,
      OddsLaunchpadABI,
      this.wallet
    );

    // Get launchpad info
    const name = await launchpad.name();
    const owner = await launchpad.owner();
    console.log(`   Name: ${name}`);
    console.log(`   Owner: ${owner}`);
    console.log(`   Is Owner: ${owner.toLowerCase() === this.wallet.address.toLowerCase()}`);

    if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
      throw new Error('Wallet is not the owner of this launchpad');
    }

    // Test 1: Add Phase
    await this.testAddPhase(launchpad);

    // Test 2: Mint
    await this.testMint(launchpad);

    // Test 3: Update Phase
    await this.testUpdatePhase(launchpad);

    // Test 4: Pause/Unpause
    await this.testPauseUnpause(launchpad);

    // Test 5: Update Treasury
    await this.testUpdateTreasury(launchpad);

    // Test 6: Update Base URI
    await this.testUpdateBaseURI(launchpad);

    console.log(`\n✅ All tests completed!`);
  }

  private async testAddPhase(launchpad: ethers.Contract): Promise<void> {
    console.log(`\n🧪 Test 1: Add Phase (PhaseAdded Event)`);
    
    try {
      const phaseData = {
        name: `Test Phase ${Date.now()}`,
        startTime: Math.floor(Date.now() / 1000),
        endTime: Math.floor(Date.now() / 1000) + 86400,
        price: ethers.parseEther('0.001'),
        maxSupply: 100,
        maxPerWallet: 5,
        maxPerTransaction: 2,
        merkleRoot: ethers.ZeroHash,
        isActive: true
      };

      console.log(`   Adding phase...`);
      const tx = await launchpad.addMintPhase(phaseData);
      console.log(`   TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Phase added! Block: ${receipt?.blockNumber}`);
      console.log(`   Gas Used: ${receipt?.gasUsed.toString()}`);

    } catch (error: any) {
      console.error(`   ❌ Failed:`, error.message);
    }
  }

  private async testMint(launchpad: ethers.Contract): Promise<void> {
    console.log(`\n🧪 Test 2: Mint (Transfer Event)`);
    
    try {
      const activePhases = await launchpad.getActivePhases();
      
      if (activePhases.length === 0) {
        console.log(`   ⚠️  No active phase. Skipping.`);
        return;
      }

      // Get phase ID from phases count
      const phasesCount = await launchpad.getMintPhasesCount();
      const phaseId = phasesCount - 1n; // Last phase (just added)
      
      const phase = await launchpad.getMintPhase(phaseId);
      const price = phase.price;
      
      console.log(`   Phase ID: ${phaseId}`);
      console.log(`   Price: ${ethers.formatEther(price)} ETH`);
      console.log(`   Minting...`);
      
      const tx = await launchpad.mint(phaseId, 1, [], { value: price });
      console.log(`   TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Minted! Block: ${receipt?.blockNumber}`);
      console.log(`   Gas Used: ${receipt?.gasUsed.toString()}`);

    } catch (error: any) {
      console.error(`   ❌ Failed:`, error.message);
    }
  }

  private async testUpdatePhase(launchpad: ethers.Contract): Promise<void> {
    console.log(`\n🧪 Test 3: Update Phase (PhaseUpdated Event)`);
    
    try {
      const phasesCount = await launchpad.getMintPhasesCount();
      
      if (phasesCount === 0n) {
        console.log(`   ⚠️  No phase to update. Skipping.`);
        return;
      }

      const phaseId = phasesCount - 1n;
      const phase = await launchpad.getMintPhase(phaseId);
      
      const updatedPhase = {
        name: phase.name,
        startTime: phase.startTime,
        endTime: phase.endTime,
        price: phase.price,
        maxSupply: phase.maxSupply,
        maxPerWallet: phase.maxPerWallet,
        maxPerTransaction: Number(phase.maxPerTransaction) + 1,
        merkleRoot: phase.merkleRoot,
        isActive: phase.isActive
      };

      console.log(`   Updating phase ${phaseId}...`);
      const tx = await launchpad.updateMintPhase(phaseId, updatedPhase);
      console.log(`   TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Phase updated! Block: ${receipt?.blockNumber}`);
      console.log(`   Gas Used: ${receipt?.gasUsed.toString()}`);

    } catch (error: any) {
      console.error(`   ❌ Failed:`, error.message);
    }
  }

  private async testPauseUnpause(launchpad: ethers.Contract): Promise<void> {
    console.log(`\n🧪 Test 4: Pause/Unpause (Paused/Unpaused Events)`);
    
    try {
      console.log(`   Pausing...`);
      let tx = await launchpad.pause();
      console.log(`   TX: ${tx.hash}`);
      let receipt = await tx.wait();
      console.log(`   ✅ Paused! Block: ${receipt?.blockNumber}`);

      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log(`   Unpausing...`);
      tx = await launchpad.unpause();
      console.log(`   TX: ${tx.hash}`);
      receipt = await tx.wait();
      console.log(`   ✅ Unpaused! Block: ${receipt?.blockNumber}`);

    } catch (error: any) {
      console.error(`   ❌ Failed:`, error.message);
    }
  }

  private async testUpdateTreasury(launchpad: ethers.Contract): Promise<void> {
    console.log(`\n🧪 Test 5: Update Treasury (TreasuryUpdated Event)`);
    
    try {
      const newTreasury = this.wallet.address;
      
      console.log(`   Updating treasury to ${newTreasury}...`);
      const tx = await launchpad.setTreasury(newTreasury);
      console.log(`   TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Treasury updated! Block: ${receipt?.blockNumber}`);
      console.log(`   Gas Used: ${receipt?.gasUsed.toString()}`);

    } catch (error: any) {
      console.error(`   ❌ Failed:`, error.message);
    }
  }

  private async testUpdateBaseURI(launchpad: ethers.Contract): Promise<void> {
    console.log(`\n🧪 Test 6: Update Base URI (BaseURIUpdated Event)`);
    
    try {
      const newBaseURI = `https://api.example.com/metadata/${Date.now()}/`;
      
      console.log(`   Updating base URI...`);
      const tx = await launchpad.setBaseURI(newBaseURI);
      console.log(`   TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Base URI updated! Block: ${receipt?.blockNumber}`);
      console.log(`   Gas Used: ${receipt?.gasUsed.toString()}`);

    } catch (error: any) {
      console.error(`   ❌ Failed:`, error.message);
    }
  }

  async run(): Promise<void> {
    console.log(`\n🚀 Deploy and Test Script\n`);
    console.log(`=`.repeat(60));

    try {
      await this.checkBalance();
      await this.getFactoryAddress();

      // Try to find existing owned launchpad
      const ownedLaunchpad = await this.findOwnedLaunchpad();

      if (ownedLaunchpad) {
        console.log(`\n✅ Using existing launchpad: ${ownedLaunchpad}`);
        await this.testAllEvents(ownedLaunchpad);
      } else {
        console.log(`\n⚠️  No owned launchpad found.`);
        console.log(`\n📝 To deploy and test a new launchpad:`);
        console.log(`\n   Option 1: Deploy via Web App (Recommended)`);
        console.log(`   ----------------------------------------`);
        console.log(`   1. Go to your web app`);
        console.log(`   2. Connect wallet: ${this.wallet.address}`);
        console.log(`   3. Deploy new launchpad`);
        console.log(`   4. Wait for ContractDeployed event to be detected`);
        console.log(`   5. Run this script again: npm run deploy-test -- --chain=${this.config.chainId}`);
        console.log(`\n   Option 2: Test Existing Launchpad`);
        console.log(`   ----------------------------------------`);
        console.log(`   If you already deployed, run:`);
        console.log(`   npm run test-events -- --chain=${this.config.chainId} --launchpad=YOUR_ADDRESS`);
        console.log(`\n   Option 3: Check Listener Service`);
        console.log(`   ----------------------------------------`);
        console.log(`   Make sure listener service is running to detect new deployments:`);
        console.log(`   npm start`);
      }

      console.log(`\n` + `=`.repeat(60));
      console.log(`\n💡 Check listener service logs to verify events were detected.`);
      console.log(`💡 Check database to verify activities were recorded.`);

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

    if (!chainIdArg) {
      console.error('❌ Missing required argument');
      console.log('\nUsage: npm run deploy-test -- --chain=11155111');
      console.log('\nExample:');
      console.log('  npm run deploy-test -- --chain=11155111');
      console.log('  npm run deploy-test -- --chain=6343');
      process.exit(1);
    }

    const chainId = parseInt(chainIdArg.split('=')[1]);

    const config: DeployConfig = { chainId };
    const tester = new DeployAndTester(config);
    await tester.run();

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
