-- ============================================
-- CLEAR TRANSACTION DATA FOR SPECIFIC COLLECTION
-- Collection: 0x6a784347f22f64cccbc8c3ffa2420924d6b7b486
-- ============================================

BEGIN;

-- Set collection address (normalized to lowercase)
-- Collection address: 0x6a784347f22f64cccbc8c3ffa2420924d6b7b486

-- ============================================
-- 1. HAPUS DATA MARKETPLACE UNTUK COLLECTION INI
-- ============================================

-- Hapus offers untuk collection ini (marketplace tables use contractAddress directly)
DELETE FROM marketplace_offers
WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486';

-- Hapus sales untuk collection ini
DELETE FROM marketplace_sales
WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486';

-- Hapus listings untuk collection ini
DELETE FROM marketplace_listings
WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486';

-- Hapus floor prices untuk collection ini
DELETE FROM nft_floor_prices
WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486';

-- ============================================
-- 2. HAPUS DATA NFT UNTUK COLLECTION INI
-- ============================================

-- Hapus rarity data (NFT table uses contractAddress not collectionAddress)
DELETE FROM nft_rarity
WHERE "nftId" IN (
  SELECT id FROM nfts 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Hapus collection analytics
DELETE FROM nft_collection_analytics
WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486';

-- Hapus transfers
DELETE FROM nft_transfers
WHERE "nftId" IN (
  SELECT id FROM nfts 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Hapus ownership
DELETE FROM nft_ownership
WHERE "nftId" IN (
  SELECT id FROM nfts 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Hapus attributes
DELETE FROM nft_attributes
WHERE "nftId" IN (
  SELECT id FROM nfts 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Hapus NFTs
DELETE FROM nfts
WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486';

-- ============================================
-- 3. HAPUS DATA MINTING & LAUNCHPAD
-- ============================================

-- Hapus mints untuk launchpad ini
DELETE FROM mints
WHERE "launchpadId" IN (
  SELECT id FROM launchpads 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Hapus analytics
DELETE FROM launchpad_analytics
WHERE "launchpadId" IN (
  SELECT id FROM launchpads 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Hapus metadata
DELETE FROM launchpad_metadata
WHERE "launchpadId" IN (
  SELECT id FROM launchpads 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Hapus whitelists
DELETE FROM launchpad_whitelists
WHERE "launchpadId" IN (
  SELECT id FROM launchpads 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Hapus phases
DELETE FROM launchpad_phases
WHERE "launchpadId" IN (
  SELECT id FROM launchpads 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Hapus launchpad
DELETE FROM launchpads
WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486';

-- ============================================
-- 4. HAPUS ACTIVITY & LOGS UNTUK COLLECTION INI
-- ============================================

-- Hapus activities terkait launchpad ini (Activity uses launchpadId not contractAddress)
DELETE FROM activities
WHERE "launchpadId" IN (
  SELECT id FROM launchpads 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Hapus error logs terkait collection ini
DELETE FROM error_logs
WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486';

-- Note: processed_events tidak punya contractAddress field, skip deletion

-- ============================================
-- 5. UPDATE FACTORY COUNTER (DECREMENT)
-- ============================================

-- Kurangi totalLaunchpads di factory jika ada launchpad yang dihapus
UPDATE launchpad_factories 
SET "totalLaunchpads" = GREATEST(0, "totalLaunchpads" - 1)
WHERE id IN (
  SELECT "factoryId" FROM launchpads 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- Commit jika semua berhasil
COMMIT;

-- ============================================
-- VERIFICATION
-- ============================================
SELECT 
  'launchpads for collection' as description, 
  COUNT(*) as count 
FROM launchpads 
WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
UNION ALL
SELECT 
  'nfts for collection', 
  COUNT(*) 
FROM nfts 
WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
UNION ALL
SELECT 
  'activities for collection', 
  COUNT(*) 
FROM activities 
WHERE "launchpadId" IN (
  SELECT id FROM launchpads 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
)
UNION ALL
SELECT 
  'mints for collection', 
  COUNT(*) 
FROM mints 
WHERE "launchpadId" IN (
  SELECT id FROM launchpads 
  WHERE LOWER("contractAddress") = '0x6a784347f22f64cccbc8c3ffa2420924d6b7b486'
);

-- ============================================
-- NOTES
-- ============================================
-- Semua count di atas harus 0 setelah script dijalankan
-- Jika ada yang tidak 0, berarti ada data yang belum terhapus
