# 🚂 Railway Deployment - Fix Polling Issue

## 🎯 Masalah
Service di Railway masih melakukan polling (`eth_getFilterChanges`) meskipun kode sudah di-update untuk menggunakan WebSocket.

## 🔍 Root Cause Analysis

Ada 3 kemungkinan penyebab:

### 1. Environment Variables Masih HTTPS ❌
Railway environment variables masih menggunakan `https://` bukan `wss://`

### 2. Service Belum Di-restart ❌
Perubahan environment variables belum di-apply karena service tidak restart

### 3. Build Cache ❌
Railway masih menggunakan build cache lama

---

## ✅ Solusi Step-by-Step

### Step 1: Verifikasi Environment Variables di Railway

1. **Buka Railway Dashboard**
   - Login ke https://railway.app
   - Pilih project NFT Launchpad
   - Pilih service yang running

2. **Cek Variables Tab**
   - Klik tab "Variables"
   - Cari 3 variables ini:
     - `MEGAETH_RPC_URL`
     - `SEPOLIA_RPC_URL`
     - `MONAD_RPC_URL`

3. **Pastikan Menggunakan WSS**
   
   **❌ SALAH (akan menyebabkan polling):**
   ```
   MEGAETH_RPC_URL=https://megaeth-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
   ```
   
   **✅ BENAR (WebSocket, no polling):**
   ```
   MEGAETH_RPC_URL=wss://megaeth-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
   ```

4. **Update Jika Perlu**
   - Klik "Edit" pada setiap variable
   - Ubah `https://` menjadi `wss://`
   - Klik "Save"

### Step 2: Clear Build Cache (Penting!)

1. **Buka Settings Tab**
   - Klik tab "Settings"
   - Scroll ke bawah ke "Danger Zone"

2. **Clear Cache**
   - Klik "Clear Build Cache"
   - Konfirmasi

### Step 3: Restart Service

**Opsi A: Restart dari Dashboard**
1. Klik tab "Settings"
2. Scroll ke "Service"
3. Klik "Restart"

**Opsi B: Redeploy (Recommended)**
1. Klik tab "Deployments"
2. Klik "Deploy" button
3. Atau push dummy commit:
   ```bash
   git commit --allow-empty -m "Railway: Force redeploy to apply WebSocket config"
   git push
   ```

### Step 4: Verifikasi Deployment

1. **Cek Deploy Logs**
   - Klik tab "Deployments"
   - Klik deployment terbaru
   - Lihat logs

2. **Cari Baris Ini (HARUS ADA):**
   ```
   🔌 Using WebSocket provider for chain 6343
   🔌 NFT Listener: Using WebSocket provider for chain 6343
   🔌 Marketplace Listener: Using WebSocket provider for chain 6343
   ```

3. **TIDAK BOLEH ADA:**
   ```
   📡 Using HTTP provider for chain 6343
   ```

### Step 5: Monitor Alchemy Dashboard

1. **Buka Alchemy Dashboard**
   - https://dashboard.alchemy.com/
   - Pilih app: MegaETH Testnet

2. **Cek Requests Tab**
   - Filter by method: `eth_getFilterChanges`
   - Lihat timestamp hits terakhir
   - **Seharusnya:** Tidak ada hits baru setelah deployment

3. **Tunggu 5-10 Menit**
   - Dashboard mungkin ada delay
   - Refresh setiap beberapa menit

---

## 🔧 Troubleshooting

### Issue: Logs Masih Menunjukkan HTTP Provider

**Kemungkinan Penyebab:**
- Environment variables belum di-save dengan benar
- Service belum restart
- Multiple instances running

**Solusi:**
```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link ke project
railway link

# Cek environment variables
railway variables

# Set ulang jika perlu
railway variables set MEGAETH_RPC_URL="wss://megaeth-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY"
railway variables set SEPOLIA_RPC_URL="wss://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY"
railway variables set MONAD_RPC_URL="wss://monad-testnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY"

# Restart
railway service restart
```

### Issue: eth_getFilterChanges Masih Ada di Alchemy

**Cek 1: Timestamp**
- Pastikan hits yang terlihat adalah hits LAMA (sebelum fix)
- Alchemy dashboard bisa delay 5-10 menit

**Cek 2: Multiple Services**
- Pastikan tidak ada service lain yang menggunakan API key yang sama
- Cek apakah ada local development yang masih running

**Cek 3: Railway Logs**
- Pastikan logs menunjukkan WebSocket
- Jika masih HTTP, berarti env vars belum apply

### Issue: WebSocket Connection Failed

**Gejala:**
```
❌ Failed to start activity listener for chain 6343
Error: WebSocket connection failed
```

**Penyebab:**
- Railway firewall/network issue
- Alchemy API key invalid
- Rate limit tercapai

**Solusi:**
1. Cek API key valid di Alchemy dashboard
2. Cek quota tidak habis
3. Coba restart service
4. Jika masih gagal, temporary gunakan HTTPS dengan polling interval tinggi:
   ```
   MEGAETH_RPC_URL=https://megaeth-testnet.g.alchemy.com/v2/YOUR_KEY
   ```
   Dan update kode untuk increase polling interval ke 60 detik

---

## 📊 Expected Results

### Before Fix
```
Railway Logs:
📡 Using HTTP provider for chain 6343 (polling interval: 10s, 15 launchpads)

Alchemy Dashboard:
- 450-900 eth_getFilterChanges per minute
- 150-300 CU/s consumption
- Frequent rate limit errors
```

### After Fix
```
Railway Logs:
🔌 Using WebSocket provider for chain 6343
✅ Activity listener started for chain 6343

Alchemy Dashboard:
- 0 eth_getFilterChanges
- ~10-20 CU/s consumption (only eth_subscribe)
- No rate limit errors
- 95% reduction in API usage
```

---

## 🧪 Testing

### Test 1: Verify Environment Variables

**Di Railway:**
```bash
# Tambahkan temporary script di package.json
"scripts": {
  "verify-env": "node verify-env.js"
}

# Jalankan via Railway CLI
railway run npm run verify-env
```

**Expected Output:**
```
✅ All RPC URLs are correctly configured!
   Using WebSocket connections - no polling.
```

### Test 2: Monitor Real-time Logs

```bash
# Stream logs dari Railway
railway logs

# Cari output ini:
🔌 Using WebSocket provider for chain 6343
```

### Test 3: Test Event Processing

1. Mint NFT di salah satu launchpad
2. Cek Railway logs untuk event
3. Cek database untuk activity record

```sql
SELECT * FROM "Activity" 
WHERE "chainId" = 6343 
AND "timestamp" > NOW() - INTERVAL '10 minutes'
ORDER BY "timestamp" DESC;
```

---

## 📝 Checklist

Sebelum menganggap masalah selesai, pastikan:

- [ ] Environment variables di Railway menggunakan `wss://`
- [ ] Build cache sudah di-clear
- [ ] Service sudah di-restart/redeploy
- [ ] Railway logs menunjukkan "Using WebSocket provider"
- [ ] Tidak ada "Using HTTP provider" di logs
- [ ] Alchemy dashboard tidak ada `eth_getFilterChanges` baru
- [ ] Events masih tercatat di database dengan benar
- [ ] Sudah tunggu 10 menit untuk Alchemy dashboard update

---

## 🆘 Masih Bermasalah?

Jika setelah semua langkah di atas masih ada `eth_getFilterChanges`:

1. **Screenshot Railway Logs** (bagian startup)
2. **Screenshot Railway Variables** (blur API key)
3. **Screenshot Alchemy Dashboard** (requests tab dengan timestamp)
4. **Export Railway Logs** (last 100 lines)

Kirim untuk analisis lebih lanjut.

---

## 📞 Railway CLI Commands Reference

```bash
# Install
npm i -g @railway/cli

# Login
railway login

# Link project
railway link

# View logs
railway logs

# View variables
railway variables

# Set variable
railway variables set KEY="value"

# Restart service
railway service restart

# Deploy
railway up

# Run command
railway run <command>

# Shell access
railway shell
```

---

## ✅ Success Indicators

Anda tahu fix berhasil ketika:

1. ✅ Railway logs: "Using WebSocket provider"
2. ✅ Alchemy dashboard: 0 new `eth_getFilterChanges`
3. ✅ API usage turun ~95%
4. ✅ No rate limit errors
5. ✅ Events masih tercatat real-time
6. ✅ Service stable, no crashes

**Selamat! Polling issue sudah resolved! 🎉**
