/**
 * Get Deployed Contract Address
 * 
 * Calculate contract address from deployment transaction
 * 
 * Usage:
 * npm run get-address -- --chain 6343 --tx 0x123...
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
      console.log('\nUsage: npm run get-address -- --chain=6343 --tx=0x123...');
      process.exit(1);
    }

    const chainId = parseInt(chainIdArg.split('=')[1]);
    const txHash = txArg.split('=')[1];

    console.log(`🔍 Getting deployed contract address...`);
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
    console.log(`   Nonce: ${tx.nonce}`);

    // Calculate contract address
    // Contract address = keccak256(rlp([sender, nonce]))[12:]
    const contractAddress = ethers.getCreateAddress({
      from: tx.from,
      nonce: tx.nonce
    });

    console.log(`\n📍 Calculated Contract Address:`);
    console.log(`   ${contractAddress}`);

    console.log(`\n💡 This is the predicted address based on sender and nonce.`);
    console.log(`   If transaction succeeds, contract will be deployed at this address.`);

    // Try to get receipt
    console.log(`\n📡 Checking if transaction is confirmed...`);
    const receipt = await provider.getTransactionReceipt(txHash);

    if (receipt) {
      console.log(`✅ Transaction confirmed!`);
      console.log(`   Block: ${receipt.blockNumber}`);
      console.log(`   Status: ${receipt.status === 1 ? '✅ Success' : '❌ Failed'}`);
      
      if (receipt.contractAddress) {
        console.log(`   Actual Address: ${receipt.contractAddress}`);
        
        if (receipt.contractAddress.toLowerCase() === contractAddress.toLowerCase()) {
          console.log(`   ✅ Matches calculated address!`);
        }
      }

      console.log(`\n🎯 Next steps:`);
      console.log(`   npm run test-events -- --chain=${chainId} --launchpad=${contractAddress}`);
    } else {
      console.log(`⏳ Transaction not yet confirmed`);
      console.log(`\n🎯 You can try testing with calculated address:`);
      console.log(`   npm run test-events -- --chain=${chainId} --launchpad=${contractAddress}`);
      console.log(`\n   Or wait and check again:`);
      console.log(`   npm run check-deploy -- --chain=${chainId} --tx=${txHash}`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
