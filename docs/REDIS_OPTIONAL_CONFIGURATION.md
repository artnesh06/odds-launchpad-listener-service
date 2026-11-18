# Redis - Konfigurasi Opsional

## Status Redis di Aplikasi

Redis **TIDAK WAJIB** untuk menjalankan aplikasi. Redis hanya digunakan untuk sistem queue (Bull Queue) yang bersifat **opsional**.

## ✅ Update: Auto-Detection Redis

Aplikasi sekarang **otomatis mendeteksi** ketersediaan Redis sebelum inisialisasi:

1. **Cek Konfigurasi** - Apakah `REDIS_HOST` diset ke server eksternal (bukan localhost)?
2. **Test Connection** - Jika dikonfigurasi, coba connect ke Redis dengan timeout 2 detik
3. **Skip Jika Tidak Tersedia** - Jika Redis tidak tersedia, skip queue system tanpa error

### Perilaku Baru

**Scenario 1: Redis Tidak Dikonfigurasi (Default)**
```
📦 Checking Queue System availability...
ℹ️ Redis not configured (using default localhost)
ℹ️ Skipping queue system initialization
ℹ️ Service will use direct processing mode
```
✅ **Tidak ada error**, aplikasi langsung skip queue system

**Scenario 2: Redis Dikonfigurasi Tapi Tidak Tersedia**
```
📦 Checking Queue System availability...
🔍 Testing Redis connection...
⚠️ Redis configured but not available
⚠️ Skipping queue system initialization
⚠️ Service will use direct processing mode
```
✅ **Tidak ada error**, aplikasi skip queue system dengan warning

**Scenario 3: Redis Tersedia**
```
📦 Checking Queue System availability...
🔍 Testing Redis connection...
✅ Redis is available, initializing queue system...
✅ Queue Manager initialized
✅ Queue Workers started
```
✅ Queue system aktif dan berjalan

## Bagaimana Redis Digunakan?

### 1. Queue System (Opsional)

Redis digunakan oleh library `Bull` untuk mengelola job queue:
- Mint events queue
- NFT metadata queue
- Marketplace events queue
- Activity events queue
- Historical sync queue
- Notifications queue

### 2. Inisialisasi dengan Error Handling

Di file `src/index.ts`, queue system diinisialisasi dengan **try-catch**:

```typescript
// Initialize Queue System
console.log('\n📦 Initializing Queue System...');
try {
  await initializeQueueManager();
  console.log('✅ Queue Manager initialized');
  
  await initializeQueueWorker(websocketManager);
  queueWorkerActive = true;
  console.log('✅ Queue Workers started');
} catch (error) {
  console.warn('⚠️ Queue system initialization failed:', error);
  console.warn('⚠️ Service will continue without queue support (direct processing)');
}
```

**Artinya:** Jika Redis tidak tersedia atau tidak dikonfigurasi, aplikasi akan tetap berjalan dengan **direct processing** (tanpa queue).

## Konfigurasi Redis

### File `.env`

```bash
# Redis Configuration (OPTIONAL - for Queue System)
# Jika tidak diset atau diset ke localhost, queue system akan di-skip
REDIS_HOST="localhost"          # Default: localhost (akan di-skip)
REDIS_PORT="6379"               # Default: 6379
REDIS_PASSWORD=""               # Optional
REDIS_DB="0"                    # Default: 0
```

### Cara Mengaktifkan Redis

**Option 1: Set REDIS_HOST ke server eksternal**
```bash
REDIS_HOST="your-redis-server.com"  # Bukan localhost
REDIS_PORT="6379"
```

**Option 2: Gunakan Redis lokal yang sudah running**
```bash
# Start Redis terlebih dahulu
redis-server

# Kemudian set di .env
REDIS_HOST="localhost"  # Akan dicoba connect
```

### Jika Redis Tidak Dikonfigurasi

Jika `REDIS_HOST` tidak diset atau diset ke `localhost`/`127.0.0.1`:

1. ✅ **Aplikasi langsung skip queue system** (tidak ada error)
2. ✅ **Tidak ada connection attempt** ke Redis
3. 📝 Event processing dilakukan secara **direct/synchronous**
4. 💡 Log akan menampilkan: `"Redis not configured, skipping queue system"`

### Jika Redis Dikonfigurasi Tapi Tidak Tersedia

Jika `REDIS_HOST` diset ke server eksternal tapi Redis tidak running:

1. ✅ **Aplikasi test connection dengan timeout 2 detik**
2. ✅ **Skip queue system jika gagal** (tidak ada error berulang)
3. 📝 Event processing dilakukan secara **direct/synchronous**
4. 💡 Log akan menampilkan: `"Redis configured but not available"`

## Kapan Redis Diperlukan?

Redis **DIPERLUKAN** jika Anda ingin:

1. **High Volume Processing** - Menangani ribuan mint events secara concurrent
2. **Job Retry Mechanism** - Automatic retry untuk failed jobs
3. **Job Scheduling** - Delayed jobs dan scheduled tasks
4. **Distributed Processing** - Multiple worker instances
5. **Job Monitoring** - Dashboard untuk melihat queue status

## Kapan Redis TIDAK Diperlukan?

Redis **TIDAK DIPERLUKAN** jika:

1. ✅ Volume mint events rendah-sedang (< 100 per menit)
2. ✅ Single server deployment
3. ✅ Direct processing sudah cukup cepat
4. ✅ Tidak perlu job retry mechanism
5. ✅ Development/testing environment

## Mode Operasi

### Mode 1: Dengan Redis (Queue-based)

```
Event → Queue → Worker → Database
         ↓
      Retry jika gagal
      Job monitoring
      Rate limiting
```

**Keuntungan:**
- Scalable untuk high volume
- Automatic retry
- Job monitoring
- Backpressure handling

### Mode 2: Tanpa Redis (Direct Processing)

```
Event → Direct Processing → Database
```

**Keuntungan:**
- Lebih sederhana
- Tidak perlu Redis server
- Latency lebih rendah untuk low volume
- Cocok untuk development

## Cara Mengecek Status Redis

### 1. Melalui Health Check Endpoint

```bash
curl http://localhost:3000/health
```

Response akan menampilkan status queue:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600,
  "memory": {
    "heapUsed": 50,
    "heapTotal": 100
  },
  "database": {
    "status": "connected"
  },
  "queue": {
    "initialized": true,
    "stats": {
      "mint-events": {
        "waiting": 0,
        "active": 2,
        "completed": 150
      }
    }
  }
}
```

Jika Redis tidak aktif:
```json
{
  "queue": null
}
```

### 2. Melalui Log Aplikasi

Saat startup, cek log:

**Dengan Redis:**
```
📦 Initializing Queue System...
✅ Queue Manager initialized
✅ Queue Workers started
```

**Tanpa Redis:**
```
📦 Initializing Queue System...
⚠️ Queue system initialization failed: Error: connect ECONNREFUSED 127.0.0.1:6379
⚠️ Service will continue without queue support (direct processing)
```

## Instalasi Redis (Opsional)

### Windows

```bash
# Menggunakan Chocolatey
choco install redis-64

# Atau download dari:
# https://github.com/microsoftarchive/redis/releases
```

### Linux/Mac

```bash
# Ubuntu/Debian
sudo apt-get install redis-server

# Mac
brew install redis

# Start Redis
redis-server
```

### Docker

```bash
docker run -d -p 6379:6379 redis:alpine
```

## Kesimpulan

✅ **Redis TIDAK WAJIB** - Aplikasi berjalan normal tanpa Redis

⚠️ **Redis OPSIONAL** - Hanya diperlukan untuk queue system

💡 **Rekomendasi:**
- **Development:** Tidak perlu Redis
- **Production (Low Volume):** Tidak perlu Redis
- **Production (High Volume):** Gunakan Redis untuk scalability

## Testing Tanpa Redis

Untuk memastikan aplikasi berjalan tanpa Redis:

1. **Jangan set environment variable Redis** atau set ke server yang tidak ada
2. **Start aplikasi:**
   ```bash
   npm start
   ```
3. **Cek log** - Harus muncul warning tapi aplikasi tetap jalan
4. **Test mint event** - Harus tetap berfungsi dengan direct processing

## Troubleshooting

### ❌ Error: "Queue error: ECONNREFUSED"

**Penyebab:** Queue system mencoba connect ke Redis yang tidak tersedia

**Solusi (SUDAH DIPERBAIKI):**
- ✅ Aplikasi sekarang auto-detect Redis sebelum inisialisasi
- ✅ Tidak akan ada error ECONNREFUSED lagi jika Redis tidak dikonfigurasi
- ✅ Update ke versi terbaru untuk mendapatkan fix ini

### Error: "Queue system initialization failed"

**Penyebab:** Redis tidak tersedia

**Solusi:** 
- ✅ Ini normal jika Redis tidak dikonfigurasi
- ✅ Aplikasi akan tetap berjalan dengan direct processing
- ✅ Tidak perlu action jika tidak butuh queue

### Ingin menggunakan Redis tapi error

**Cek:**
1. Redis server berjalan: `redis-cli ping` (harus return "PONG")
2. Environment variable sudah benar
3. Port 6379 tidak diblok firewall
4. Redis password (jika ada) sudah benar
5. `REDIS_HOST` diset ke server yang benar (bukan localhost jika Redis di server lain)
