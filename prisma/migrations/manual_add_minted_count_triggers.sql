-- Migration: Add triggers to auto-sync mintedCount
-- This ensures mintedCount is always accurate at database level
-- Prevents race conditions and double-counting

-- ============================================================================
-- Function: Auto-increment mintedCount when Mint is inserted
-- ============================================================================
CREATE OR REPLACE FUNCTION update_minted_count_on_mint_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Increment mintedCount for the launchpad
  UPDATE "launchpads"
  SET 
    "mintedCount" = "mintedCount" + 1,
    "lastMintAt" = COALESCE(NEW."createdAt", NOW()),
    "updatedAt" = NOW()
  WHERE id = NEW."launchpadId";
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for mint insert
DROP TRIGGER IF EXISTS mint_insert_trigger ON "mints";
CREATE TRIGGER mint_insert_trigger
AFTER INSERT ON "mints"
FOR EACH ROW
EXECUTE FUNCTION update_minted_count_on_mint_insert();

-- ============================================================================
-- Function: Auto-decrement mintedCount when Mint is deleted (for burns)
-- ============================================================================
CREATE OR REPLACE FUNCTION update_minted_count_on_mint_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Decrement mintedCount for the launchpad
  -- Ensure it doesn't go below 0
  UPDATE "launchpads"
  SET 
    "mintedCount" = GREATEST("mintedCount" - 1, 0),
    "updatedAt" = NOW()
  WHERE id = OLD."launchpadId";
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for mint delete
DROP TRIGGER IF EXISTS mint_delete_trigger ON "mints";
CREATE TRIGGER mint_delete_trigger
AFTER DELETE ON "mints"
FOR EACH ROW
EXECUTE FUNCTION update_minted_count_on_mint_delete();

-- ============================================================================
-- Function: Prevent manual updates to mintedCount (optional safety)
-- ============================================================================
CREATE OR REPLACE FUNCTION prevent_manual_minted_count_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow updates if mintedCount is not being changed
  IF OLD."mintedCount" IS DISTINCT FROM NEW."mintedCount" THEN
    -- Check if this is a reconciliation update (when actual count differs significantly)
    -- Allow if the difference suggests it's a fix, not a manual increment
    DECLARE
      actual_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO actual_count
      FROM "mints"
      WHERE "launchpadId" = NEW.id;
      
      -- Allow if new value matches actual count (reconciliation)
      IF NEW."mintedCount" = actual_count THEN
        RETURN NEW;
      END IF;
      
      -- Log warning but allow (don't block, just warn)
      RAISE WARNING 'Manual mintedCount update detected for launchpad %. Old: %, New: %, Actual: %', 
        NEW.id, OLD."mintedCount", NEW."mintedCount", actual_count;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to warn on manual updates (optional - can be disabled if causes issues)
DROP TRIGGER IF EXISTS prevent_manual_minted_count_update_trigger ON "launchpads";
CREATE TRIGGER prevent_manual_minted_count_update_trigger
BEFORE UPDATE ON "launchpads"
FOR EACH ROW
WHEN (OLD."mintedCount" IS DISTINCT FROM NEW."mintedCount")
EXECUTE FUNCTION prevent_manual_minted_count_update();

-- ============================================================================
-- Verification: Check current state and fix discrepancies
-- ============================================================================
DO $$
DECLARE
  launchpad_record RECORD;
  actual_count INTEGER;
  fixed_count INTEGER := 0;
BEGIN
  RAISE NOTICE 'Starting mintedCount verification and fix...';
  
  FOR launchpad_record IN 
    SELECT id, "contractAddress", "mintedCount"
    FROM "launchpads"
  LOOP
    -- Get actual mint count
    SELECT COUNT(*) INTO actual_count
    FROM "mints"
    WHERE "launchpadId" = launchpad_record.id;
    
    -- Fix if mismatch
    IF launchpad_record."mintedCount" != actual_count THEN
      UPDATE "launchpads"
      SET "mintedCount" = actual_count
      WHERE id = launchpad_record.id;
      
      fixed_count := fixed_count + 1;
      RAISE NOTICE 'Fixed launchpad %: % -> %', 
        launchpad_record."contractAddress", 
        launchpad_record."mintedCount", 
        actual_count;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Verification complete. Fixed % launchpads.', fixed_count;
END $$;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON FUNCTION update_minted_count_on_mint_insert() IS 
  'Auto-increments mintedCount when a new Mint record is created. Prevents race conditions and ensures accuracy.';

COMMENT ON FUNCTION update_minted_count_on_mint_delete() IS 
  'Auto-decrements mintedCount when a Mint record is deleted (e.g., for burns). Ensures count never goes below 0.';

COMMENT ON FUNCTION prevent_manual_minted_count_update() IS 
  'Warns when mintedCount is manually updated. Allows reconciliation updates but logs warnings for manual changes.';
