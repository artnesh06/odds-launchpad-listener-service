# Changelog: Redis Auto-Detection Fix

## Masalah Sebelumnya

Ketika Redis tidak dikonfigurasi atau tidak tersedia, aplikasi tetap mencoba menginisialisasi queue system dan menghasilkan error berulang:

```
❌ [mint-events] Queue error: AggregateError [ECONNREFUSED]
❌ [nft-metadata] Queue error: AggregateError [ECONNREFUSED]
❌ [activity-events] Queue error: AggregateError [ECONNREFUSED]
❌ [marketplace-events] Queue error: AggregateError [ECONNREFUSED]
```

Error ini terjadi karena:
1. Queue system berhasil diinisialisasi (tidak throw error saat startup)
2. Tapi kemudian setiap queue mencoba connect ke Redis
3. Connection gagal dan menghasilkan error event berulang

## Solusi

### 1. Redis Checker Module (`src/lib/queue/redis-checker.ts`)

Menambahkan module baru untuk mengecek ketersediaan Redis:

**Function `isRedisConfigured()`:**
- Cek apakah `REDIS_HOST` diset ke server eksternal
- Return `false` jika tidak diset atau diset ke localhost/127.0.0.1
- Ini mencegah connection attempt yang tidak perlu

**Function `isRedisAvailable()`:**
- Test connection ke Redis dengan timeout 2 detik
- Coba ping Redis server
- Return `true` jika Redis tersedia, `false` jika tidak
- Tidak ada retry atau error berulang

### 2. Update Startup Logic (`src/index.ts`)

Mengubah inisialisasi queue system dengan pengecekan bertahap:

**Sebelum:**
```typescript
try {
  await initializeQueueManager();
  await initializeQueueWorker();
} catch (error) {
  console.warn('Queue system initialization failed');
}
```

**Sesudah:**
```typescript
const redisConfigured = isRedisConfigured();
if (!redisConfigured) {
  console.log('Redis not configured, skipping queue system');
} else {
  const redisAvailable = await isRedisAvailable();
  if (!redisAvailable) {
    console.warn('Redis configured but not available');
  } else {
    await initializeQueueManager();
    await initializeQueueWorker();
  }
}
```

### 3. Export Functions (`src/lib/queue/index.ts`)

Menambahkan export untuk Redis checker functions:
```typescript
export { isRedisAvailable, isRedisConfigured } from './redis-checker';
```

## Hasil

### Scenario 1: Redis Tidak Dikonfigurasi (Default)

**Log Output:**
```
📦 Checking Queue System availability...
ℹ️ Redis not configured (using default localhost)
ℹ️ Skipping queue system initialization
ℹ️ Service will use direct processing mode
```

**Behavior:**
- ✅ Tidak ada connection attempt ke Redis
- ✅ Tidak ada error ECONNREFUSED
- ✅ Queue system di-skip sepenuhnya
- ✅ Aplikasi menggunakan direct processing

### Scenario 2: Redis Dikonfigurasi Tapi Tidak Tersedia

**Log Output:**
```
📦 Checking Queue System availability...
🔍 Testing Redis connection...
⚠️ Redis configured but not available
⚠️ Skipping queue system initialization
⚠️ Service will use direct processing mode
```

**Behavior:**
- ✅ Test connection dengan timeout 2 detik
- ✅ Skip queue system jika gagal
- ✅ Tidak ada error berulang
- ✅ Aplikasi menggunakan direct processing

### Scenario 3: Redis Tersedia

**Log Output:**
```
📦 Checking Queue System availability...
🔍 Testing Redis connection...
✅ Redis is available, initializing queue system...
✅ Queue Manager initialized
✅ Queue Workers started
```

**Behavior:**
- ✅ Queue system aktif
- ✅ Event processing menggunakan queue
- ✅ Semua fitur queue tersedia

## Breaking Changes

**Tidak ada breaking changes.** Perubahan ini backward compatible:

- Jika Redis sudah dikonfigurasi dan tersedia, behavior tetap sama
- Jika Redis tidak dikonfigurasi, sekarang lebih clean (tidak ada error)
- API dan interface tidak berubah

## Migration Guide

Tidak perlu migration. Update code dan restart aplikasi:

```bash
# Pull latest code
git pull

# Install dependencies (jika ada perubahan)
npm install

# Restart aplikasi
npm start
```

## Testing

### Test 1: Tanpa Redis (Default)

```bash
# Jangan set REDIS_HOST atau set ke localhost
# REDIS_HOST="localhost"

npm start
```

**Expected:** Aplikasi start tanpa error, log menampilkan "Redis not configured"

### Test 2: Redis Dikonfigurasi Tapi Tidak Running

```bash
# Set REDIS_HOST ke server eksternal yang tidak ada
REDIS_HOST="redis.example.com"

npm start
```

**Expected:** Aplikasi start tanpa error, log menampilkan "Redis configured but not available"

### Test 3: Redis Tersedia

```bash
# Start Redis
redis-server

# Set REDIS_HOST
REDIS_HOST="localhost"

npm start
```

**Expected:** Aplikasi start dengan queue system aktif

## Files Changed

1. **src/lib/queue/redis-checker.ts** (NEW)
   - Menambahkan `isRedisConfigured()`
   - Menambahkan `isRedisAvailable()`

2. **src/index.ts** (MODIFIED)
   - Update import untuk include Redis checker
   - Update queue initialization logic dengan pengecekan bertahap

3. **src/lib/queue/index.ts** (MODIFIED)
   - Export Redis checker functions

4. **docs/REDIS_OPTIONAL_CONFIGURATION.md** (UPDATED)
   - Update dokumentasi dengan behavior baru
   - Tambahkan troubleshooting untuk error ECONNREFUSED

## Benefits

1. ✅ **Tidak ada error spam** - Tidak ada error ECONNREFUSED berulang
2. ✅ **Startup lebih cepat** - Skip queue init jika Redis tidak tersedia
3. ✅ **Log lebih clean** - Informasi yang jelas tentang status Redis
4. ✅ **Developer friendly** - Tidak perlu setup Redis untuk development
5. ✅ **Production ready** - Auto-detect Redis di production environment

## Recommendations

### Development Environment
```bash
# .env.development
# Tidak perlu set REDIS_HOST atau comment out
# REDIS_HOST="localhost"
```

### Production Environment (Tanpa Redis)
```bash
# .env.production
# Tidak perlu set REDIS_HOST
# Aplikasi akan menggunakan direct processing
```

### Production Environment (Dengan Redis)
```bash
# .env.production
REDIS_HOST="your-redis-server.com"
REDIS_PORT="6379"
REDIS_PASSWORD="your-password"
```
