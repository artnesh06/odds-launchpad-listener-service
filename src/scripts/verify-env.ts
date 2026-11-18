#!/usr/bin/env tsx
/**
 * Script untuk memverifikasi environment variables
 * Jalankan di Railway atau local untuk cek konfigurasi RPC
 */

import 'dotenv/config';

console.log('========================================');
console.log('🔍 Environment Variables Verification');
console.log('========================================\n');

const envVars = [
  'MEGAETH_RPC_URL',
  'SEPOLIA_RPC_URL',
  'MONAD_RPC_URL'
];

let hasIssues = false;

envVars.forEach(varName => {
  const value = process.env[varName];
  
  console.log(`\n📋 ${varName}:`);
  
  if (!value) {
    console.log('   ❌ NOT SET - will use fallback from chains.ts');
    return;
  }
  
  console.log(`   Value: ${value.substring(0, 50)}...`);
  
  // Check protocol
  if (value.startsWith('wss://')) {
    console.log('   ✅ Using WebSocket (wss://) - CORRECT');
  } else if (value.startsWith('ws://')) {
    console.log('   ⚠️  Using WebSocket (ws://) - OK but not secure');
  } else if (value.startsWith('https://')) {
    console.log('   ❌ Using HTTPS - WILL CAUSE POLLING!');
    hasIssues = true;
  } else if (value.startsWith('http://')) {
    console.log('   ❌ Using HTTP - WILL CAUSE POLLING!');
    hasIssues = true;
  } else {
    console.log('   ⚠️  Unknown protocol');
    hasIssues = true;
  }
});

console.log('\n========================================');
console.log('📊 Summary');
console.log('========================================\n');

if (hasIssues) {
  console.log('❌ ISSUES FOUND!');
  console.log('\n⚠️  Some RPC URLs are using HTTP/HTTPS which will cause polling.');
  console.log('   This results in high eth_getFilterChanges API usage.\n');
  console.log('🔧 Fix:');
  console.log('   1. Update environment variables to use wss:// instead of https://');
  console.log('   2. In Railway: Settings → Variables → Edit each variable');
  console.log('   3. Change https:// to wss://');
  console.log('   4. Save and restart service\n');
  process.exit(1);
} else {
  console.log('✅ All RPC URLs are correctly configured!');
  console.log('   Using WebSocket connections - no polling.\n');
  process.exit(0);
}
