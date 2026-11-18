/**
 * Real Event Testing Script
 * 
 * Tests all event handlers with real blockchain interactions
 * 
 * Usage:
 * npm run test-events -- --chain 11155111 --launchpad 0x123...
 * 
 * Requirements:
 * - TEST_PRIVATE_KEY or TEST_MNEMONIC in .env
 * - Testnet ETH for gas
 * - Existing launchpad contract address
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { getChainConfig } from '../config/chains';
import OddsLaunchpadABI from '../../abi/OddsLaunchpad.json';

interface TestConfig {
  chainId: number;
  launchpadAddress: string;
  testCount?: number;
}

class RealEventTester {
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet | ethers.HDNodeWallet;
  private launchpad: ethers.Contract;
  private config: TestConfig;

  constructor(config: TestConfig) {
    this.config = config;

    // Get chain config
    const chainConfig = getChainConfig(config.chainId);
    if (!chainConfig) {
      throw new Error(`Chain config not found for chainId ${config.chainId}`);
    }

    // Setup provider (use HTTP for testing to avoid WebSocket issues)
    const rpcUrl = chainConfig.rpcUrl.replace('wss://', 'https://').replace('/ws/', '/');
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    // Setup wallet from private key or mnemonic
    if (process.env.TEST_PRIVATE_KEY) {
      this.wallet = new ethers.Wallet(process.env.TEST_PRIVATE_KEY, this.provider);
    } else if (process.env.TEST_MNEMONIC) {
      this.wallet = ethers.Wallet.fromPhrase(process.env.TEST_MNEMONIC, this.provider);
    } else {
      throw new Error('TEST_PRIVATE_KEY or TEST_MNEMONIC not found in .env');
    }

    // Setup launchpad contract
    this.launchpad = new ethers.Contract(
      config.launchpadAddress,
      OddsLaunchpadABI,
      this.wallet
    );

    console.log(`🔧 Test Configuration:`);
    console.log(`   Chain ID: ${config.chainId}`);
    console.log(`   Launchpad: ${config.launchpadAddress}`);
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
   * Get launchpad info
   */
  async getLaunchpadInfo(): Promise<void> {
    console.log(`\n📋 Launchpad Info:`);
    
    try {
      // Check if contract exists
      const code = await this.provider.getCode(this.config.launchpadAddress);
      
      if (code === '0x') {
        console.log(`\n⚠️  Contract not deployed yet!`);
        console.log(`   Address: ${this.config.launchpadAddress}`);
        console.log(`\n💡 Possible reasons:`);
        console.log(`   1. Transaction still pending (check block explorer)`);
        console.log(`   2. Transaction failed`);
        console.log(`   3. Wrong address`);
        console.log(`\n🔍 Check deployment status:`);
        console.log(`   npm run check-deploy -- --chain=${this.config.chainId} --tx=YOUR_TX_HASH`);
        console.log(`\n   Or check block explorer:`);
        console.log(`   https://explorer.megaeth.io/address/${this.config.launchpadAddress}`);
        throw new Error('Contract not deployed yet');
      }

      const name = await this.launchpad.name();
      const symbol = await this.launchpad.symbol();
      const owner = await this.launchpad.owner();
      const totalSupply = await this.launchpad.totalSupply();
      const paused = await this.launchpad.paused();

      console.log(`   Name: ${name}`);
      console.log(`   Symbol: ${symbol}`);
      console.log(`   Owner: ${owner}`);
      console.log(`   Total Supply: ${totalSupply}`);
      console.log(`   Paused: ${paused}`);
      console.log(`   Is Owner: ${owner.toLowerCase() === this.wallet.address.toLowerCase()}`);
    } catch (error: any) {
      if (error.message === 'Contract not deployed yet') {
        throw error;
      }
      console.error(`❌ Error getting launchpad info:`, error);
      throw error;
    }
  }

  /**
   * Test 1: Mint (Transfer event)
   */
  async testMint(): Promise<void> {
    console.log(`\n🧪 Test 1: Mint (Transfer Event)`);
    
    try {
      // Get phases count and use last phase
      const phasesCount = await this.launchpad.getMintPhasesCount();
      console.log(`   Total Phases: ${phasesCount}`);

      if (phasesCount === 0n) {
        console.log(`⚠️ No phases available. Skipping mint test.`);
        return;
      }

      // Use last phase (most recent)
      const phaseId = phasesCount - 1n;
      const phase = await this.launchpad.getMintPhase(phaseId);
      
      // Check if phase is active
      const isActive = await this.launchpad.isPhaseActive(phaseId);
      if (!isActive) {
        console.log(`⚠️ Phase ${phaseId} is not active. Skipping mint test.`);
        return;
      }

      const price = phase.price;
      console.log(`   Phase ID: ${phaseId}`);
      console.log(`   Phase Name: ${phase.name}`);
      console.log(`   Mint Price: ${ethers.formatEther(price)} ETH`);

      // Check phase requirements
      const phaseInfo = await this.launchpad.getPhaseSupplyInfo(phaseId);
      console.log(`   Current Supply: ${phaseInfo.phaseCurrentSupply} / ${phase.maxSupply}`);
      console.log(`   Requires Whitelist: ${phase.requiresWhitelist}`);

      if (phase.requiresWhitelist) {
        console.log(`   ⚠️ Phase requires whitelist. Skipping mint test.`);
        return;
      }

      if (phaseInfo.phaseCurrentSupply >= phase.maxSupply) {
        console.log(`   ⚠️ Phase supply exhausted. Skipping mint test.`);
        return;
      }

      // Mint
      console.log(`   Minting...`);
      const tx = await this.launchpad.mint(phaseId, 1, [], { value: price });
      console.log(`   TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Minted! Block: ${receipt?.blockNumber}`);
      console.log(`   Gas Used: ${receipt?.gasUsed.toString()}`);

      // Find Transfer event
      const transferEvent = receipt?.logs.find((log: any) => {
        try {
          const parsed = this.launchpad.interface.parseLog(log);
          return parsed?.name === 'Transfer';
        } catch {
          return false;
        }
      });

      if (transferEvent) {
        const parsed = this.launchpad.interface.parseLog(transferEvent);
        console.log(`   📡 Transfer Event Detected:`);
        console.log(`      From: ${parsed?.args[0]}`);
        console.log(`      To: ${parsed?.args[1]}`);
        console.log(`      Token ID: ${parsed?.args[2]}`);
      }

    } catch (error: any) {
      if (error.message.includes('execution reverted')) {
        console.error(`   ❌ Mint failed: Transaction reverted (check phase requirements, max per wallet, etc.)`);
      } else {
        console.error(`   ❌ Mint test failed:`, error.message);
      }
    }
  }

  /**
   * Test 2: Add Phase (PhaseAdded event) - Owner only
   */
  async testAddPhase(): Promise<void> {
    console.log(`\n🧪 Test 2: Add Phase (PhaseAdded Event)`);
    
    try {
      const owner = await this.launchpad.owner();
      if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
        console.log(`⚠️ Not owner. Skipping phase test.`);
        return;
      }

      const phaseData = {
        name: `Test Phase ${Date.now()}`,
        startTime: Math.floor(Date.now() / 1000),
        endTime: Math.floor(Date.now() / 1000) + 86400, // 1 day
        price: ethers.parseEther('0.001'),
        maxSupply: 100,
        maxPerWallet: 5,
        maxPerTransaction: 2,
        merkleRoot: ethers.ZeroHash,
        isActive: true,
        requiresWhitelist: false,
        currentSupply: 0
      };

      console.log(`   Adding phase (batch)...`);
      const tx = await this.launchpad.batchAddMintPhases([phaseData]);
      console.log(`   TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Phase added! Block: ${receipt?.blockNumber}`);

      // Find PhaseAdded event
      const phaseEvent = receipt?.logs.find((log: any) => {
        try {
          const parsed = this.launchpad.interface.parseLog(log);
          return parsed?.name === 'PhaseAdded';
        } catch {
          return false;
        }
      });

      if (phaseEvent) {
        const parsed = this.launchpad.interface.parseLog(phaseEvent);
        console.log(`   📡 PhaseAdded Event Detected:`);
        console.log(`      Phase ID: ${parsed?.args[0]}`);
      }

    } catch (error: any) {
      console.error(`❌ Add phase test failed:`, error.message);
    }
  }

  /**
   * Test 3: Update Phase (PhaseUpdated event) - Owner only
   */
  async testUpdatePhase(): Promise<void> {
    console.log(`\n🧪 Test 3: Update Phase (PhaseUpdated Event)`);
    
    try {
      const owner = await this.launchpad.owner();
      if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
        console.log(`⚠️ Not owner. Skipping update phase test.`);
        return;
      }

      const allPhases = await this.launchpad.getAllPhases();
      if (allPhases.length === 0) {
        console.log(`⚠️ No phase to update. Skipping.`);
        return;
      }

      // Get phase using getMintPhase for proper structure
      const phasesCount = await this.launchpad.getMintPhasesCount();
      const phaseId = phasesCount - 1n;
      const phase = await this.launchpad.getMintPhase(phaseId);
      
      const updatedPhase = {
        name: phase.name,
        startTime: phase.startTime,
        endTime: phase.endTime,
        price: phase.price,
        maxSupply: phase.maxSupply,
        maxPerWallet: phase.maxPerWallet,
        maxPerTransaction: Number(phase.maxPerTransaction) + 1, // Increase by 1
        merkleRoot: phase.merkleRoot,
        isActive: phase.isActive,
        requiresWhitelist: phase.requiresWhitelist,
        currentSupply: phase.currentSupply
      };

      console.log(`   Updating phase ${phase.name}...`);
      const tx = await this.launchpad.updateMintPhase(phaseId, updatedPhase);
      console.log(`   TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Phase updated! Block: ${receipt?.blockNumber}`);

    } catch (error: any) {
      console.error(`❌ Update phase test failed:`, error.message);
    }
  }

  /**
   * Test 4: Pause/Unpause (Paused/Unpaused events) - Owner only
   */
  async testPauseUnpause(): Promise<void> {
    console.log(`\n🧪 Test 4: Pause/Unpause (Paused/Unpaused Events)`);
    
    try {
      const owner = await this.launchpad.owner();
      if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
        console.log(`⚠️ Not owner. Skipping pause test.`);
        return;
      }

      const isPaused = await this.launchpad.paused();
      
      if (!isPaused) {
        console.log(`   Pausing...`);
        const tx = await this.launchpad.pause();
        console.log(`   TX: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`   ✅ Paused! Block: ${receipt?.blockNumber}`);

        // Wait a bit
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      console.log(`   Unpausing...`);
      const tx = await this.launchpad.unpause();
      console.log(`   TX: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`   ✅ Unpaused! Block: ${receipt?.blockNumber}`);

    } catch (error: any) {
      console.error(`❌ Pause/Unpause test failed:`, error.message);
    }
  }

  /**
   * Test 5: Update Treasury (TreasuryUpdated event) - Owner only
   */
  async testUpdateTreasury(): Promise<void> {
    console.log(`\n🧪 Test 5: Update Treasury (TreasuryUpdated Event)`);
    
    try {
      const owner = await this.launchpad.owner();
      if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
        console.log(`⚠️ Not owner. Skipping treasury test.`);
        return;
      }

      const currentTreasury = await this.launchpad.treasury();
      // Use wallet address as new treasury (can change back later)
      const newTreasury = this.wallet.address;

      if (currentTreasury.toLowerCase() === newTreasury.toLowerCase()) {
        console.log(`   Treasury already set to wallet. Skipping.`);
        return;
      }

      console.log(`   Updating treasury...`);
      console.log(`   Old: ${currentTreasury}`);
      console.log(`   New: ${newTreasury}`);
      
      const tx = await this.launchpad.setTreasury(newTreasury);
      console.log(`   TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Treasury updated! Block: ${receipt?.blockNumber}`);

    } catch (error: any) {
      console.error(`❌ Update treasury test failed:`, error.message);
    }
  }

  /**
   * Test 6: Update Base URI (BaseURIUpdated event) - Owner only
   */
  async testUpdateBaseURI(): Promise<void> {
    console.log(`\n🧪 Test 6: Update Base URI (BaseURIUpdated Event)`);
    
    try {
      const owner = await this.launchpad.owner();
      if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
        console.log(`⚠️ Not owner. Skipping base URI test.`);
        return;
      }

      const newBaseURI = `https://api.example.com/metadata/${Date.now()}/`;
      
      console.log(`   Updating base URI...`);
      console.log(`   New URI: ${newBaseURI}`);
      
      const tx = await this.launchpad.setBaseURI(newBaseURI);
      console.log(`   TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      console.log(`   ✅ Base URI updated! Block: ${receipt?.blockNumber}`);

    } catch (error: any) {
      console.error(`❌ Update base URI test failed:`, error.message);
    }
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<void> {
    console.log(`\n🚀 Starting Real Event Tests\n`);
    console.log(`=`.repeat(60));

    try {
      await this.checkBalance();
      await this.getLaunchpadInfo();

      // Run tests
      await this.testMint();
      await this.testAddPhase();
      await this.testUpdatePhase();
      await this.testPauseUnpause();
      await this.testUpdateTreasury();
      await this.testUpdateBaseURI();

      console.log(`\n` + `=`.repeat(60));
      console.log(`\n✅ All tests completed!`);
      console.log(`\n💡 Check your listener service logs to verify events were detected.`);
      console.log(`💡 Check database to verify activities were recorded.`);

    } catch (error) {
      console.error(`\n❌ Test suite failed:`, error);
      throw error;
    }
  }
}

async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const chainIdArg = args.find(arg => arg.startsWith('--chain='));
    const launchpadArg = args.find(arg => arg.startsWith('--launchpad='));

    if (!chainIdArg || !launchpadArg) {
      console.error('❌ Missing required arguments');
      console.log('\nUsage: npm run test-events -- --chain=11155111 --launchpad=0x123...');
      console.log('\nExample:');
      console.log('  npm run test-events -- --chain=11155111 --launchpad=0xYourLaunchpadAddress');
      console.log('\nRequirements:');
      console.log('  - Add TEST_PRIVATE_KEY or TEST_MNEMONIC to .env');
      console.log('  - Ensure wallet has testnet ETH');
      console.log('  - Use existing launchpad contract address');
      process.exit(1);
    }

    const chainId = parseInt(chainIdArg.split('=')[1]);
    const launchpadAddress = launchpadArg.split('=')[1];

    // Validate address
    if (!ethers.isAddress(launchpadAddress)) {
      console.error('❌ Invalid launchpad address');
      process.exit(1);
    }

    const config: TestConfig = {
      chainId,
      launchpadAddress
    };

    const tester = new RealEventTester(config);
    await tester.runAllTests();

  } catch (error) {
    console.error('❌ Error running tests:', error);
    process.exit(1);
  }
}

main();
