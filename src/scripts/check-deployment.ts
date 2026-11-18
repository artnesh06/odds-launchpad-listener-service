/**
 * Check Deployment Status
 * 
 * Check status of a deployment transaction
 * 
 * Usage:
 * npm run check-deploy -- --chain 6343 --tx 0x123...
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { getChainConfig } from '../config/chains';

async function main() {
  try {
    const args = process.argv.slice(2);
    const chainIdArg = args.find(arg => arg.startsWith('--chain='));
    const txArg = args.find(arg => arg.startsWith('--tx='));

    if (!chainIdArg || !txArg) {
      console.error('❌ Missing required arguments');
      console.log('\nUsage: npm run check-deploy -- --chain=6343 --tx=0x123...');
      process.exit(1);
    }

    const chainId = parseInt(chainIdArg.split('=')[1]);
    const txHash = txArg.split('=')[1];

    console.log(`🔍 Checking deployment status...`);
    console.log(`   Chain ID: ${chainId}`);
    console.log(`   TX: ${txHash}`);

    // Get chain config
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig) {
      throw new Error(`Chain config not found for chainId ${chainId}`);
    }

    // Setup provider
    const rpcUrl = chainConfig.rpcUrl.replace('wss://', 'https://').replace('/ws/', '/');
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Get transaction
    console.log(`\n📡 Fetching transaction...`);
    const tx = await provider.getTransaction(txHash);

    if (!tx) {
      console.log(`❌ Transaction not found`);
      process.exit(1);
    }

    console.log(`✅ Transaction found`);
    console.log(`   From: ${tx.from}`);
    console.log(`   To: ${tx.to || 'Contract Creation'}`);
    console.log(`   Value: ${ethers.formatEther(tx.value)} ETH`);
    console.log(`   Gas Limit: ${tx.gasLimit.toString()}`);
    console.log(`   Gas Price: ${ethers.formatUnits(tx.gasPrice || 0n, 'gwei')} gwei`);

    // Get receipt with retry
    console.log(`\n📡 Fetching receipt (will retry for up to 2 minutes)...`);
    
    let receipt = null;
    let attempts = 0;
    const maxAttempts = 30;
    
    while (!receipt && attempts < maxAttempts) {
      attempts++;
      console.log(`   Attempt ${attempts}/${maxAttempts}...`);
      
      receipt = await provider.getTransactionReceipt(txHash);
      
      if (!receipt) {
        await new Promise(resolve => setTimeout(resolve, 4000));
      }
    }

    if (!receipt) {
      console.log(`⏳ Transaction still pending after ${maxAttempts * 4} seconds...`);
      console.log(`\n💡 Transaction is taking longer than expected.`);
      console.log(`   Check block explorer: https://explorer.megaeth.io/tx/${txHash}`);
      process.exit(0);
    }

    console.log(`✅ Transaction confirmed`);
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed.toString()}`);
    console.log(`   Status: ${receipt.status === 1 ? '✅ Success' : '❌ Failed'}`);

    if (receipt.status === 1 && receipt.contractAddress) {
      console.log(`\n🎉 Contract deployed successfully!`);
      console.log(`   Address: ${receipt.contractAddress}`);
      console.log(`\n🎯 Next steps:`);
      console.log(`   npm run test-events -- --chain=${chainId} --launchpad=${receipt.contractAddress}`);
    } else if (receipt.status === 0) {
      console.log(`\n❌ Deployment failed`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
