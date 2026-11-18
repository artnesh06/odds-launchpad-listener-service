# Checklist Railway Deployment - Polling Issue

## 🔍 Langkah Debugging

### 1. **Cek Railway Logs**
Buka Railway dashboard dan cek logs saat startup. Cari baris ini:

**YANG BENAR (WebSocket):**
```
🔌 Using WebSocket provider for chain 6343
🔌 NFT Listener: Using WebSocket provider for chain 6343
🔌 Marketplace Listener: Using WebSocket provider for chain 6343
```

**YANG SALAH (HTTP/Polling):**
```
📡 Using HTTP provider for chain 6343 (polling interval: 10s, 15 launchpads)
📡 NFT Listener: Using HTTP provider for chain 6343
```

### 2. **Cek Environment Variables di Railway**

Pastikan environment variables di Railway dashboard sudah benar:

```bash
MEGAETH_RPC_URL=wss://megaeth-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
SEPOLIA_RPC_URL=wss://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
MONAD_RPC_URL=wss://monad-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
```

**PENTING:** Harus dimulai dengan `wss://` bukan `https://`

### 3. **Cek Build Logs**

Pastikan build berhasil dan tidak ada error:
- Cek tab "Deployments" di Railway
- Klik deployment terbaru
- Lihat "Build Logs" dan "Deploy Logs"

### 4. **Force Redeploy**

Jika environment variables sudah benar tapi masih polling:

1. Buka Railway dashboard
2. Pilih service
3. Klik "Settings" tab
4. Scroll ke bawah, klik "Restart"
5. Atau trigger redeploy dengan push dummy commit:
   ```bash
   git commit --allow-empty -m "Force redeploy to fix polling"
   git push
   ```

---

## 🚨 Kemungkinan Masalah

### Masalah 1: Environment Variables Tidak Terbaca

**Gejala:** Logs menunjukkan HTTP provider meskipun env vars sudah WSS

**Penyebab:** Railway mungkin tidak reload env vars setelah perubahan

**Solusi:**
1. Buka Railway dashboard → Service → Variables
2. Edit setiap variable (tambah spasi lalu hapus)
3. Klik "Save"
4. Restart service

### Masalah 2: Kode Lama Masih Ter-cache

**Gejala:** Perubahan kode tidak terlihat di logs

**Penyebab:** Railway cache build artifacts

**Solusi:**
```bash
# Di Railway dashboard:
Settings → Danger Zone → Clear Build Cache
# Lalu redeploy
```

### Masalah 3: Multiple Instances Running

**Gejala:** Beberapa instance service berjalan bersamaan

**Penyebab:** Railway auto-scaling atau failed restart

**Solusi:**
1. Railway dashboard → Service → Settings
2. Cek "Replicas" - pastikan hanya 1
3. Restart service

### Masalah 4: Alchemy Dashboard Delay

**Gejala:** Perubahan sudah benar tapi dashboard masih menunjukkan hits lama

**Penyebab:** Alchemy dashboard cache/delay

**Solusi:**
- Tunggu 5-10 menit
- Refresh dashboard
- Cek timestamp hits terakhir

---

## ✅ Verifikasi Deployment Berhasil

### A. Cek Railway Logs (Real-time)

```bash
# Install Railway CLI jika belum
npm i -g @railway/cli

# Login
railway login

# Link ke project
railway link

# Stream logs
railway logs
```

Cari output:
```
🔌 Using WebSocket provider for chain 6343
✅ Activity listener started for chain 6343
```

### B. Cek Alchemy Dashboard

1. Buka https://dashboard.alchemy.com/
2. Pilih app MegaETH Testnet
3. Tab "Requests"
4. Filter by method: `eth_getFilterChanges`
5. **Seharusnya:** Tidak ada request baru setelah deployment
6. **Cek timestamp:** Pastikan hits terakhir sebelum deployment

### C. Test Event Processing

Lakukan transaksi test di blockchain:
1. Mint NFT di salah satu launchpad
2. Cek database apakah event tercatat
3. Cek Railway logs untuk konfirmasi event diterima

```sql
-- Cek event terbaru
SELECT * FROM "Activity" 
WHERE "chainId" = 6343 
ORDER BY "timestamp" DESC 
LIMIT 5;
```

---

## 🔧 Quick Fix Commands

### Restart Railway Service
```bash
railway service restart
```

### Redeploy Latest
```bash
railway up
```

### Check Current Env Vars
```bash
railway variables
```

### Set Env Var (jika perlu)
```bash
railway variables set MEGAETH_RPC_URL="wss://megaeth-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY"
```

---

## 📊 Expected Results After Fix

### Railway Logs
```
🚀 Initializing multi-chain activity listeners...
📊 Found 3 active chains with factories
🔍 Initializing chain 6343 (MegaETH Testnet V2) with 15 launchpads
   RPC URL: wss://megaeth-testnet.g.alchemy.com/v2/...
🔌 Using WebSocket provider for chain 6343
✅ Activity listener started for chain 6343
```

### Alchemy Dashboard
- **Before:** 450-900 `eth_getFilterChanges` per minute
- **After:** 0 `eth_getFilterChanges` (only `eth_subscribe`)
- **Reduction:** ~95% API usage

### Performance
- ✅ Real-time event processing (no polling delay)
- ✅ No rate limit errors
- ✅ Lower latency
- ✅ More stable connection

---

## 🆘 Jika Masih Bermasalah

### Debug Checklist:

1. ✅ Environment variables di Railway menggunakan `wss://`?
2. ✅ Service sudah di-restart setelah perubahan env vars?
3. ✅ Build logs tidak ada error?
4. ✅ Railway logs menunjukkan "Using WebSocket provider"?
5. ✅ Tidak ada multiple instances running?
6. ✅ Sudah tunggu 5-10 menit untuk Alchemy dashboard update?

### Jika Semua Sudah Dicek:

**Kemungkinan:** Ada kode lain yang masih membuat HTTP provider

**Solusi:** Cari semua tempat yang membuat provider:

```bash
# Di local
grep -r "new ethers.JsonRpcProvider" src/
grep -r "pollingInterval" src/
```

**File yang sudah diperbaiki:**
- ✅ `src/config/chains.ts` - fallback WSS
- ✅ `src/lib/monitoring/health-check.ts` - gunakan WSS
- ✅ `src/lib/blockchain/activity-listener.ts` - sudah cek WSS
- ✅ `src/lib/blockchain/nft-event-listener.ts` - sudah cek WSS
- ✅ `src/lib/blockchain/marketplace-event-listener.ts` - sudah cek WSS

**File yang TIDAK perlu diperbaiki (hanya untuk scripts):**
- `src/scripts/*` - hanya dijalankan manual, bukan 24/7

---

## 📞 Contact Info

Jika masih ada masalah setelah semua langkah di atas:

1. Screenshot Railway logs (startup section)
2. Screenshot Railway environment variables
3. Screenshot Alchemy dashboard (requests tab dengan timestamp)
4. Kirim untuk analisis lebih lanjut
