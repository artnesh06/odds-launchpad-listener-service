-- ============================================
-- VERIFICATION QUERY
-- Cek jumlah data di setiap tabel
-- ============================================

SELECT 
  'launchpads' as table_name, 
  COUNT(*) as count,
  CASE WHEN COUNT(*) = 0 THEN '✓ CLEARED' ELSE '✗ HAS DATA' END as status
FROM launchpads

UNION ALL

SELECT 'mints', COUNT(*), 
  CASE WHEN COUNT(*) = 0 THEN '✓ CLEARED' ELSE '✗ HAS DATA' END
FROM mints

UNION ALL

SELECT 'activities', COUNT(*), 
  CASE WHEN COUNT(*) = 0 THEN '✓ CLEARED' ELSE '✗ HAS DATA' END
FROM activities

UNION ALL

SELECT 'error_logs', COUNT(*), 
  CASE WHEN COUNT(*) = 0 THEN '✓ CLEARED' ELSE '✗ HAS DATA' END
FROM error_logs

UNION ALL

SELECT 'admin_activity_logs', COUNT(*), 
  CASE WHEN COUNT(*) = 0 THEN '✓ CLEARED' ELSE '✗ HAS DATA' END
FROM admin_activity_logs

UNION ALL

SELECT 'processed_events', COUNT(*), 
  CASE WHEN COUNT(*) = 0 THEN '✓ CLEARED' ELSE '✗ HAS DATA' END
FROM processed_events

UNION ALL

SELECT 'nfts', COUNT(*), 
  CASE WHEN COUNT(*) = 0 THEN '✓ CLEARED' ELSE '✗ HAS DATA' END
FROM nfts

UNION ALL

SELECT 'marketplace_sales', COUNT(*), 
  CASE WHEN COUNT(*) = 0 THEN '✓ CLEARED' ELSE '✗ HAS DATA' END
FROM marketplace_sales

UNION ALL

SELECT '--- SHOULD NOT BE EMPTY ---', 0, '---' 

UNION ALL

SELECT 'chains (SHOULD HAVE DATA)', COUNT(*), 
  CASE WHEN COUNT(*) > 0 THEN '✓ OK' ELSE '✗ EMPTY!' END
FROM chains

UNION ALL

SELECT 'launchpad_factories (SHOULD HAVE DATA)', COUNT(*), 
  CASE WHEN COUNT(*) > 0 THEN '✓ OK' ELSE '✗ EMPTY!' END
FROM launchpad_factories

ORDER BY table_name;
