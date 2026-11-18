# Fix: Event Listener untuk Semua Transfer dan Event

## Masalah

Event NFT transfer tidak terbaca pada transaksi: `0x3a995d10ae6be9548969edad3ddd900fd0ba0d63dc2dbd53efea34055ae2fc25`

### Root Cause

1. **Filter Transfer terlalu spesifik** - Hanya mendengarkan mint (from = ZeroAddress), tidak mendengarkan transfer biasa
2. **Event limitation terlalu ketat** - HTTP provider dengan >10 launchpads hanya mendengarkan 2 event

## Solusi

### 1. Update Transfer Filter

**File**: `src/lib/blockchain/activity-listener.ts`

```typescript
// ❌ SEBELUM: Hanya mint
const filter = contract.filters.Transfer(ethers.ZeroAddress, null, null);

// ✅ SESUDAH: Semua transfer (mint, transfer, burn)
const filter = contract.filters.Transfer(null, null, null);
```

**Lokasi perubahan**:
- Line ~985: `listenToMintEvents()`
- Line ~2403: `registerLaunchpadEventListeners()`

### 2. Update Transfer Handler Logic

**File**: `src/lib/blockchain/activity-listener.ts` (Line ~3870-3995)

```typescript
// Deteksi jenis transfer
const isZeroAddress = (addr: string) => addr.toLowerCase() === ethers.ZeroAddress.toLowerCase();
const isMint = isZeroAddress(event.from);
const isBurn = isZeroAddress(event.to);
const isTransfer = !isMint && !isBurn;

// Handle berdasarkan jenis:
// - Mint: Buat NFT + activity + mint record
// - Transfer: Update ownership + transfer record (NO activity)
// - Burn: Remove ownership + activity
```

### 3. Fix NFT Event Handler Call

**File**: `src/lib/blockchain/activity-listener.ts` (Line ~3989)

```typescript
// ❌ SEBELUM
from: ethers.ZeroAddress, // Hardcoded!

// ✅ SESUDAH
from: event.from, // Actual from address
```

### 4. Relax Event Limitations

**File**: `src/lib/blockchain/multi-chain-listener-manager.ts` (Line ~95-120)

```typescript
// ❌ SEBELUM: Terlalu ketat
if (isHttpProvider && launchpadAddresses.length > 10) {
  enabledEvents = ['Transfer', 'ContractDeployed']; // Hanya 2 event!
}

// ✅ SESUDAH: Lebih fleksibel
if (isHttpProvider && launchpadAddresses.length > 20) {
  // >20 launchpads: 4 event critical
  enabledEvents = ['Transfer', 'ContractDeployed', 'Burned', 'Revealed'];
} else if (isHttpProvider && launchpadAddresses.length > 10) {
  // 11-20 launchpads: 8 event penting
  enabledEvents = ['Transfer', 'ContractDeployed', 'Burned', 'Airdropped',
                   'PhaseAdded', 'PhaseUpdated', 'Revealed', 'Withdrawn'];
} else {
  // WebSocket atau ≤10 launchpads: SEMUA event
  enabledEvents = undefined;
}
```

## Event Coverage

### WebSocket Provider (MegaETH, Sepolia, Monad)
✅ **SEMUA 22 EVENT DIDENGARKAN**

### HTTP Provider
- **≤10 launchpads**: ✅ SEMUA event
- **11-20 launchpads**: ⚠️ 8 event penting
- **>20 launchpads**: ⚠️ 4 event critical

## Testing

```bash
# Restart service
npm run dev

# Expected logs:
# ✅ Chain 6343 using WebSocket with 10 launchpads - enabling ALL events
# 🔄 Transferring NFT: 0xBcE4...Aae5 token 953
#    From: 0x9a29...c137 → To: 0x3Fce...9d34
# ✅ Transfer completed: token 953
```

## Verifikasi Database

```sql
-- Check transfer record
SELECT * FROM nft_transfers 
WHERE "txHash" = '0x3a995d10ae6be9548969edad3ddd900fd0ba0d63dc2dbd53efea34055ae2fc25';

-- Check ownership
SELECT * FROM nft_ownership 
WHERE "contractAddress" = '0xbce4ef852f05bb42e6c66f4c0006d370b777aae5' 
  AND "tokenId" = '953';
```

## Impact

✅ Semua transfer NFT terdeteksi (mint, transfer, burn)  
✅ Ownership tracking akurat  
✅ Transfer history lengkap  
✅ WebSocket mendengarkan SEMUA event  
✅ Event penting tidak terlewat (Burned, Revealed, PhaseAdded, dll)

## Rollback

Jika ada masalah:

1. Kembalikan filter: `contract.filters.Transfer(ethers.ZeroAddress, null, null)`
2. Kembalikan hardcode: `from: ethers.ZeroAddress`
3. Kembalikan limitation: `enabledEvents = ['Transfer', 'ContractDeployed']`
