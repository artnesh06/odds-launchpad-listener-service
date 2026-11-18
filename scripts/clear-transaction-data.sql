-- ============================================
-- CLEAR TRANSACTION & ACTIVITY DATA
-- Menghapus semua data transaksi, activity, dan logs
-- TIDAK menghapus: chains, launchpad_factories, nft_contracts
-- ============================================

-- Disable triggers temporarily for faster deletion
SET session_replication_role = 'replica';

-- ============================================
-- 1. HAPUS DATA MARKETPLACE (jika ada)
-- ============================================
TRUNCATE TABLE marketplace_offers CASCADE;
TRUNCATE TABLE marketplace_sales CASCADE;
TRUNCATE TABLE marketplace_listings CASCADE;
TRUNCATE TABLE nft_floor_prices CASCADE;

-- ============================================
-- 2. HAPUS DATA NFT (jika ada)
-- ============================================
TRUNCATE TABLE nft_rarity CASCADE;
TRUNCATE TABLE nft_collection_analytics CASCADE;
TRUNCATE TABLE nft_transfers CASCADE;
TRUNCATE TABLE nft_ownership CASCADE;
TRUNCATE TABLE nft_attributes CASCADE;
TRUNCATE TABLE nfts CASCADE;

-- ============================================
-- 3. HAPUS DATA MINTING & LAUNCHPAD
-- ============================================
TRUNCATE TABLE mints CASCADE;
TRUNCATE TABLE launchpad_analytics CASCADE;
TRUNCATE TABLE launchpad_metadata CASCADE;
TRUNCATE TABLE launchpad_whitelists CASCADE;
TRUNCATE TABLE launchpad_phases CASCADE;
TRUNCATE TABLE launchpads CASCADE;

-- ============================================
-- 4. HAPUS ACTIVITY & LOGS
-- ============================================
TRUNCATE TABLE activities CASCADE;
TRUNCATE TABLE error_logs CASCADE;
TRUNCATE TABLE admin_activity_logs CASCADE;
TRUNCATE TABLE processed_events CASCADE;
-- Note: failed_events table tidak ada di database

-- ============================================
-- 5. HAPUS DATA BANNER & PROMO (opsional)
-- ============================================
TRUNCATE TABLE banners CASCADE;
TRUNCATE TABLE promo_requests CASCADE;

-- ============================================
-- 6. HAPUS BULK OPERATIONS (opsional)
-- ============================================
TRUNCATE TABLE bulk_operations CASCADE;

-- ============================================
-- 7. RESET COUNTER DI FACTORY (opsional)
-- Reset totalLaunchpads counter dan lastProcessedBlock
-- ============================================
UPDATE launchpad_factories 
SET 
  "totalLaunchpads" = 0,
  "lastProcessedBlock" = NULL,
  "lastProcessedBlockAt" = NULL;

-- Re-enable triggers
SET session_replication_role = 'origin';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Uncomment untuk verifikasi data yang tersisa:

-- SELECT COUNT(*) as launchpads_count FROM launchpads;
-- SELECT COUNT(*) as mints_count FROM mints;
-- SELECT COUNT(*) as activities_count FROM activities;
-- SELECT COUNT(*) as error_logs_count FROM error_logs;
-- SELECT COUNT(*) as nfts_count FROM nfts;

-- Data yang TIDAK dihapus (harus tetap ada):
-- SELECT COUNT(*) as chains_count FROM chains;
-- SELECT COUNT(*) as factories_count FROM launchpad_factories;
-- SELECT COUNT(*) as nft_contracts_count FROM nft_contracts;
