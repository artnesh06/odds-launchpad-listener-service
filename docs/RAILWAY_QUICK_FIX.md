# 🚂 Railway Quick Fix - Stop Polling

## ⚡ 3 Langkah Cepat

### 1️⃣ Update Environment Variables

**Buka Railway Dashboard:**
1. Login ke https://railway.app
2. Pilih project → Service
3. Klik tab **"Variables"**

**Edit 3 variables ini:**

| Variable | ❌ Salah (Polling) | ✅ Benar (WebSocket) |
|----------|-------------------|---------------------|
| `MEGAETH_RPC_URL` | `https://megaeth-testnet...` | `wss://megaeth-testnet...` |
| `SEPOLIA_RPC_URL` | `https://eth-sepolia...` | `wss://eth-sepolia...` |
| `MONAD_RPC_URL` | `https://monad-testnet...` | `wss://monad-testnet...` |

**Cara Edit:**
- Klik "Edit" di setiap variable
- Ubah `https://` menjadi `wss://`
- Klik "Save"

### 2️⃣ Push Kode Terbaru

```bash
git add .
git commit -m "Fix: Use WebSocket to eliminate polling"
git push
```

Railway akan otomatis:
- ✅ Build dengan kode terbaru
- ✅ Jalankan `npm run verify-env` (cek env vars)
- ✅ Deploy jika verification pass

### 3️⃣ Cek Logs

**Di Railway Dashboard:**
1. Tab **"Deployments"** → Klik deployment terbaru
2. Lihat **"Build Logs"** - cari:
   ```
   ✅ All RPC URLs are correctly configured!
   ```

3. Lihat **"Deploy Logs"** - cari:
   ```
   🔌 Using WebSocket provider for chain 6343
   ```

**Jika masih melihat:**
```
📡 Using HTTP provider for chain 6343
```
Berarti env vars belum di-update dengan benar!

---

## 🔍 Troubleshooting

### ❌ Build Gagal: "ISSUES FOUND!"

**Artinya:** Environment variables masih HTTPS

**Fix:**
1. Kembali ke tab "Variables"
2. Pastikan semua RPC URL dimulai dengan `wss://`
3. Save dan redeploy

### ❌ Logs Masih "Using HTTP provider"

**Kemungkinan:**
- Env vars belum di-save
- Service belum restart

**Fix:**
1. Tab "Settings" → Klik "Restart"
2. Atau clear cache: Settings → Danger Zone → Clear Build Cache
3. Redeploy

### ✅ Berhasil!

**Indikator:**
- Build logs: `✅ All RPC URLs are correctly configured!`
- Deploy logs: `🔌 Using WebSocket provider for chain 6343`
- Alchemy dashboard: Tidak ada `eth_getFilterChanges` baru

---

## 📊 Hasil yang Diharapkan

### Before
```
Alchemy Dashboard:
- 450-900 eth_getFilterChanges per minute
- 150-300 CU/s consumption
- Rate limit errors
```

### After
```
Alchemy Dashboard:
- 0 eth_getFilterChanges
- ~10-20 CU/s consumption
- No errors
- 95% reduction! 🎉
```

---

## 🎯 Checklist

- [ ] Environment variables di Railway menggunakan `wss://`
- [ ] Kode terbaru sudah di-push
- [ ] Build logs: "All RPC URLs are correctly configured"
- [ ] Deploy logs: "Using WebSocket provider"
- [ ] Alchemy dashboard: Tidak ada `eth_getFilterChanges` baru (tunggu 5-10 menit)

**Done! 🎉**
