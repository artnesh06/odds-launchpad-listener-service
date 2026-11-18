# Requirements Document

## Introduction

Proyek ini memiliki dua modul blockchain event listener yang sudah berfungsi namun memiliki masalah maintainability:

1. **Activity Listener** (`activity-listener.ts`) - 4744 baris kode untuk monitoring launchpad contract events (mint, burn, transfer, dll)
2. **Marketplace Listener** (`marketplace-event-listener.ts`) - ~600 baris kode untuk monitoring marketplace trading events (OpenSea, Blur, LooksRare, Magic Eden)

Kedua listener memiliki duplikasi logic untuk provider management, error tracking, dan listener setup. Sudah ada upaya refactoring awal dengan membuat struktur modular (services, utils, config), namun belum selesai diimplementasikan. 

Tujuan dari refactoring ini adalah:
- Menyelesaikan migrasi activity listener ke arsitektur yang lebih clean dan modular
- Refactor marketplace listener untuk menggunakan shared services yang sama
- Menghilangkan duplikasi kode antara kedua listeners
- Memastikan backward compatibility 100%
- Memindahkan file backup dan dokumentasi lama ke folder `backup/` di root project untuk menjaga repository tetap clean

## Glossary

- **Activity Listener**: Komponen yang mendengarkan dan memproses blockchain events dari launchpad smart contracts
- **Marketplace Listener**: Komponen yang mendengarkan dan memproses trading events dari marketplace contracts (OpenSea, Blur, dll)
- **Event Handler**: Modul yang memproses tipe event tertentu (user events, admin events, marketplace events, dll)
- **Provider Service**: Service yang mengelola koneksi RPC (WebSocket atau HTTP) ke blockchain (shared by both listeners)
- **Error Tracking Service**: Service yang mengelola error monitoring, counting, dan alerting (shared by both listeners)
- **Event Listener Registry**: Service yang mengelola setup dan registrasi event listeners (shared by both listeners)
- **Launchpad Contract**: Smart contract NFT launchpad yang di-monitor oleh activity listener
- **Marketplace Contract**: Smart contract marketplace (OpenSea Seaport, Blur, LooksRare, Magic Eden) yang di-monitor oleh marketplace listener
- **Factory Contract**: Smart contract yang men-deploy launchpad contracts baru
- **RPC Provider**: Remote Procedure Call endpoint untuk berkomunikasi dengan blockchain
- **Filter Recreation**: Proses membuat ulang event filters untuk mencegah expiration pada HTTP providers
- **Shared Services**: Services yang digunakan oleh kedua listeners (ProviderService, ErrorTrackingService, EventListenerRegistry)

## Requirements

### Requirement 1

**User Story:** Sebagai developer, saya ingin file activity listener yang lebih pendek dan modular, sehingga saya dapat dengan mudah memahami, maintain, dan extend kode tersebut.

#### Acceptance Criteria

1. WHEN refactoring selesai THEN file `activity-listener.ts` SHALL memiliki maksimal 800 baris kode
2. WHEN melihat struktur folder THEN sistem SHALL memiliki folder terpisah untuk services, utils, config, dan types
3. WHEN membaca kode THEN setiap file SHALL memiliki single responsibility yang jelas
4. WHEN menghitung duplikasi kode THEN sistem SHALL memiliki maksimal 5% kode duplikat
5. WHEN mengukur cyclomatic complexity THEN setiap method SHALL memiliki complexity maksimal 10

### Requirement 2

**User Story:** Sebagai developer, saya ingin menghilangkan 20+ listener methods yang repetitif, sehingga penambahan event baru menjadi lebih mudah dan konsisten.

#### Acceptance Criteria

1. WHEN mendaftarkan event listener THEN sistem SHALL menggunakan generic method yang dapat handle semua tipe event
2. WHEN menambahkan event baru THEN developer SHALL hanya perlu menambahkan konfigurasi tanpa menulis listener method baru
3. WHEN setup listener THEN sistem SHALL menggunakan factory pattern untuk membuat event filters
4. WHEN memproses event THEN sistem SHALL menggunakan handler yang sesuai berdasarkan event type
5. WHEN terjadi error pada satu event THEN sistem SHALL tetap memproses event lainnya tanpa crash

### Requirement 3

**User Story:** Sebagai developer, saya ingin menyelesaikan implementasi `activity-listener-simplified.ts`, sehingga sistem dapat menggunakan arsitektur baru yang sudah didesain.

#### Acceptance Criteria

1. WHEN file simplified dibuka THEN file tersebut SHALL tidak memiliki compilation errors
2. WHEN menjalankan listener THEN semua method yang dipanggil SHALL sudah terimplementasi
3. WHEN listener berjalan THEN sistem SHALL menggunakan ProviderService, ErrorTrackingService, dan EventListenerRegistry
4. WHEN event terjadi THEN sistem SHALL menggunakan event handlers yang sudah ada (UserEventHandler, AdminEventHandler, dll)
5. WHEN listener di-stop THEN sistem SHALL membersihkan semua resources dengan benar

### Requirement 4

**User Story:** Sebagai developer, saya ingin memindahkan semua validation logic ke utility module, sehingga validation dapat digunakan kembali di berbagai tempat.

#### Acceptance Criteria

1. WHEN melakukan validasi THEN sistem SHALL menggunakan functions dari `utils/validation-helpers.ts`
2. WHEN validasi address THEN sistem SHALL menggunakan `isValidAddress()` function
3. WHEN validasi transaction hash THEN sistem SHALL menggunakan `isValidTxHash()` function
4. WHEN validasi event data THEN sistem SHALL menggunakan `validateEventData()` function
5. WHEN validation gagal THEN sistem SHALL throw error dengan message yang descriptive

### Requirement 5

**User Story:** Sebagai developer, saya ingin memindahkan semua provider management ke ProviderService, sehingga logic koneksi RPC terpisah dari business logic.

#### Acceptance Criteria

1. WHEN membuat provider THEN sistem SHALL menggunakan ProviderService untuk inisialisasi
2. WHEN provider adalah WebSocket THEN ProviderService SHALL membuat WebSocketProvider
3. WHEN provider adalah HTTP THEN ProviderService SHALL membuat JsonRpcProvider dengan polling interval yang sesuai
4. WHEN terjadi RPC error THEN ProviderService SHALL handle error tanpa crash
5. WHEN testing koneksi THEN ProviderService SHALL menyediakan method `testConnection()`

### Requirement 6

**User Story:** Sebagai developer, saya ingin memindahkan semua error tracking ke ErrorTrackingService, sehingga error monitoring terpusat dan konsisten.

#### Acceptance Criteria

1. WHEN terjadi error THEN sistem SHALL menggunakan ErrorTrackingService untuk tracking
2. WHEN error counter mencapai threshold THEN ErrorTrackingService SHALL mengirim admin alert
3. WHEN logging error THEN sistem SHALL menyertakan severity level (low, medium, high, critical)
4. WHEN error di-track THEN sistem SHALL menyimpan context lengkap (chainId, txHash, blockNumber, eventType)
5. WHEN alert dikirim THEN error counter SHALL di-reset

### Requirement 7

**User Story:** Sebagai developer, saya ingin menggunakan EventListenerRegistry untuk setup listeners, sehingga tidak ada duplikasi kode setup.

#### Acceptance Criteria

1. WHEN setup listener untuk multiple contracts THEN sistem SHALL menggunakan `setupLaunchpadEventListeners()` method
2. WHEN setup listener THEN sistem SHALL menerapkan rate limiting dengan delay yang sesuai
3. WHEN setup listener THEN sistem SHALL handle errors tanpa menghentikan setup untuk contract lainnya
4. WHEN listener di-register THEN sistem SHALL hanya memproses events dari block saat ini dan selanjutnya
5. WHEN terjadi error pada event handler THEN sistem SHALL log error dan continue processing

### Requirement 8

**User Story:** Sebagai developer, saya ingin memastikan backward compatibility, sehingga refactoring tidak merusak fungsionalitas yang sudah ada.

#### Acceptance Criteria

1. WHEN listener dijalankan THEN semua 24 event types SHALL tetap berfungsi seperti sebelumnya
2. WHEN event diterima THEN data SHALL disimpan ke database dengan format yang sama
3. WHEN terjadi error THEN error handling SHALL bekerja seperti sebelumnya
4. WHEN filter expired THEN sistem SHALL recreate filters seperti sebelumnya
5. WHEN listener di-stop THEN cleanup SHALL berjalan dengan benar

### Requirement 9

**User Story:** Sebagai developer, saya ingin file backup lama dipindahkan ke folder backup di root project, sehingga repository tetap clean tapi history tetap tersimpan untuk referensi.

#### Acceptance Criteria

1. WHEN refactoring selesai THEN folder `backup/` SHALL dibuat di root project jika belum ada
2. WHEN refactoring selesai THEN file `activity-listener.ts.backup` SHALL dipindahkan ke `backup/activity-listener.ts.backup`
3. WHEN refactoring selesai THEN file `activity-listener-simplified.ts` SHALL menjadi `activity-listener.ts` yang baru
4. WHEN refactoring selesai THEN file `marketplace-event-listener.ts` lama (jika ada backup) SHALL dipindahkan ke folder backup
5. WHEN refactoring selesai THEN semua file dokumentasi refactoring lama (REFACTORING_*.md, CLEAN_CODE_*.md) SHALL dipindahkan ke `backup/docs/`
6. WHEN melihat folder blockchain THEN tidak ada file `.backup` atau temporary files
7. WHEN membaca README THEN dokumentasi SHALL menjelaskan arsitektur baru dengan jelas

### Requirement 10

**User Story:** Sebagai developer, saya ingin memiliki tests untuk memastikan refactoring tidak merusak fungsionalitas, sehingga saya dapat refactor dengan confidence.

#### Acceptance Criteria

1. WHEN menjalankan tests THEN semua existing tests SHALL tetap pass
2. WHEN testing ProviderService THEN tests SHALL memverifikasi WebSocket dan HTTP provider creation
3. WHEN testing ErrorTrackingService THEN tests SHALL memverifikasi error counting dan alerting
4. WHEN testing EventListenerRegistry THEN tests SHALL memverifikasi listener setup
5. WHEN testing validation helpers THEN tests SHALL memverifikasi semua validation functions

### Requirement 11

**User Story:** Sebagai developer, saya ingin marketplace event listener juga menggunakan arsitektur modular yang sama, sehingga semua listeners konsisten dan mudah di-maintain.

#### Acceptance Criteria

1. WHEN marketplace listener dijalankan THEN sistem SHALL menggunakan ProviderService untuk provider management
2. WHEN marketplace listener dijalankan THEN sistem SHALL menggunakan ErrorTrackingService untuk error tracking
3. WHEN marketplace listener dijalankan THEN sistem SHALL menggunakan EventListenerRegistry untuk listener setup
4. WHEN marketplace event terjadi THEN sistem SHALL menggunakan MarketplaceEventHandler yang sudah ada
5. WHEN marketplace listener di-stop THEN cleanup SHALL berjalan dengan benar

### Requirement 12

**User Story:** Sebagai developer, saya ingin marketplace listener support semua marketplace yang sudah dikonfigurasi, sehingga sistem dapat monitor trading activity dari berbagai platform.

#### Acceptance Criteria

1. WHEN marketplace listener dijalankan THEN sistem SHALL support OpenSea Seaport events (OrderFulfilled, OrderCancelled)
2. WHEN marketplace listener dijalankan THEN sistem SHALL support Blur events (OrdersMatched, OrderCancelled)
3. WHEN marketplace listener dijalankan THEN sistem SHALL support LooksRare events (TakerAsk, TakerBid)
4. WHEN marketplace listener dijalankan THEN sistem SHALL support Magic Eden events (BuyListingERC721, SellOfferERC721)
5. WHEN marketplace event diterima THEN data SHALL disimpan ke database dengan format yang benar

### Requirement 13

**User Story:** Sebagai developer, saya ingin marketplace listener dapat di-configure untuk hanya listen ke marketplace tertentu, sehingga sistem lebih efisien dan tidak monitor marketplace yang tidak digunakan.

#### Acceptance Criteria

1. WHEN membuat marketplace listener THEN developer SHALL dapat specify marketplace mana yang di-monitor
2. WHEN marketplace tidak di-specify THEN listener SHALL tidak setup event listeners untuk marketplace tersebut
3. WHEN marketplace listener dijalankan THEN sistem SHALL hanya initialize contracts untuk marketplace yang di-configure
4. WHEN melihat listener status THEN sistem SHALL menampilkan marketplace mana saja yang aktif
5. WHEN menambah marketplace baru THEN developer SHALL hanya perlu update configuration tanpa mengubah kode listener
