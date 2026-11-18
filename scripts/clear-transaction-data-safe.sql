-- ============================================
-- CLEAR TRANSACTION & ACTIVITY DATA (SAFE VERSION)
-- Menggunakan DELETE untuk lebih aman
-- Hanya menghapus tabel yang ada di database
-- ============================================

BEGIN;

-- ============================================
-- 1. HAPUS DATA MARKETPLACE
-- ============================================
DELETE FROM marketplace_offers;
DELETE FROM marketplace_sales;
DELETE FROM marketplace_listings;
DELETE FROM nft_floor_prices;

-- ============================================
-- 2. HAPUS DATA NFT
-- ============================================
DELETE FROM nft_rarity;
DELETE FROM nft_collection_analytics;
DELETE FROM nft_transfers;
DELETE FROM nft_ownership;
DELETE FROM nft_attributes;
DELETE FROM nfts;

-- ============================================
-- 3. HAPUS DATA MINTING & LAUNCHPAD
-- ============================================
DELETE FROM mints;
DELETE FROM launchpad_analytics;
DELETE FROM launchpad_metadata;
DELETE FROM launchpad_whitelists;
DELETE FROM launchpad_phases;
DELETE FROM launchpads;

-- ============================================
-- 4. HAPUS ACTIVITY & LOGS
-- ============================================
DELETE FROM activities;
DELETE FROM error_logs;
DELETE FROM admin_activity_logs;
DELETE FROM processed_events;
-- Note: failed_events table tidak ada di database

-- ============================================
-- 5. HAPUS DATA BANNER & PROMO
-- ============================================
DELETE FROM banners;
DELETE FROM promo_requests;

-- ============================================
-- 6. HAPUS BULK OPERATIONS
-- ============================================
DELETE FROM bulk_operations;

-- ============================================
-- 7. RESET COUNTER DI FACTORY
-- ============================================
UPDATE launchpad_factories 
SET 
  "totalLaunchpads" = 0,
  "lastProcessedBlock" = NULL,
  "lastProcessedBlockAt" = NULL;

-- Commit jika semua berhasil
COMMIT;

-- ============================================
-- VERIFICATION
-- ============================================
SELECT 
  'launchpads' as table_name, COUNT(*) as count FROM launchpads
UNION ALL
SELECT 'mints', COUNT(*) FROM mints
UNION ALL
SELECT 'activities', COUNT(*) FROM activities
UNION ALL
SELECT 'error_logs', COUNT(*) FROM error_logs
UNION ALL
SELECT 'nfts', COUNT(*) FROM nfts
UNION ALL
SELECT 'chains (should NOT be 0)', COUNT(*) FROM chains
UNION ALL
SELECT 'factories (should NOT be 0)', COUNT(*) FROM launchpad_factories;
