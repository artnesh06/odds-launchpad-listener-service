# Integrasi Table Mints dengan Event Mint NFT

## Ringkasan Perubahan

Telah ditambahkan insert ke table `mints` ketika ada event mint NFT terdeteksi oleh blockchain listener.

## Perubahan yang Dilakukan

### File: `src/lib/blockchain/activity-listener.ts`

**Fungsi:** `processMintEventInternal()`

**Perubahan:**
- Menambahkan insert ke table `mints` dalam transaction database yang sama dengan insert `activity` dan update `mintedCount`
- Data yang disimpan ke table `mints`:
  - `launchpadId`: ID launchpad dari database
  - `minter`: Address yang melakukan mint (event.to)
  - `tokenId`: Token ID yang di-mint
  - `quantity`: Jumlah NFT yang di-mint (default: 1)
  - `price`: Harga mint dari transaction value
  - `txHash`: Transaction hash
  - `blockNumber`: Block number
  - `createdAt`: Timestamp

## Alur Proses Mint

Ketika ada event `Transfer` dari address zero (mint) terdeteksi:

1. **Validasi Event** - Cek apakah event sudah diproses sebelumnya
2. **Sync Launchpad** - Pastikan launchpad terdaftar di database
3. **Get Transaction Details** - Ambil detail transaksi untuk mendapatkan price
4. **Database Transaction** (Atomic):
   - Insert ke table `activities` dengan type `MINT_OCCURRED`
   - **Insert ke table `mints`** ← BARU DITAMBAHKAN
   - Update `mintedCount` dan `lastMintAt` di table `launchpads`
5. **Save NFT Data** - Simpan metadata NFT ke table `nfts`
6. **Emit WebSocket Event** - Broadcast event ke client real-time

## Keuntungan

1. **Data Lengkap**: Semua mint event sekarang tercatat di table `mints`
2. **Atomic Transaction**: Insert mint record dilakukan dalam transaction yang sama dengan activity dan update launchpad
3. **Duplicate Prevention**: Menggunakan unique constraint pada `txHash` untuk mencegah duplikasi
4. **Error Handling**: Retry mechanism untuk menangani race condition dan database errors

## Schema Table Mints

```prisma
model Mint {
  id          String   @id @default(cuid())
  launchpadId String
  phaseId     String?
  minter      String
  tokenId     Int?
  quantity    Int      @default(1)
  price       String
  txHash      String   @unique
  blockNumber Int?
  gasUsed     String?
  createdAt   DateTime @default(now())

  launchpad Launchpad       @relation(fields: [launchpadId], references: [id], onDelete: Cascade)
  phase     LaunchpadPhase? @relation(fields: [phaseId], references: [id])

  @@map("mints")
}
```

## Testing

Untuk memverifikasi bahwa mint events tercatat dengan benar:

```sql
-- Cek jumlah mint records
SELECT COUNT(*) FROM mints;

-- Cek mint records terbaru
SELECT * FROM mints ORDER BY "createdAt" DESC LIMIT 10;

-- Cek mint records untuk launchpad tertentu
SELECT m.*, l.name, l.symbol 
FROM mints m
JOIN launchpads l ON m."launchpadId" = l.id
WHERE l."contractAddress" = 'YOUR_CONTRACT_ADDRESS'
ORDER BY m."createdAt" DESC;
```

## Catatan

- Field `phaseId` saat ini NULL karena belum ada mapping ke phase yang aktif saat mint
- Field `gasUsed` saat ini NULL, bisa ditambahkan di future update jika diperlukan
- Unique constraint pada `txHash` memastikan tidak ada duplikasi mint record
