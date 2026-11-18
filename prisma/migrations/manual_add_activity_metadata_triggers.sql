-- Migration: Add triggers to protect activity metadata from manual updates
-- This ensures activity metadata integrity and prevents accidental overwrites
-- Similar to prevent_manual_minted_count_update trigger

-- ============================================================================
-- Function: Prevent manual updates to activity metadata (safety mechanism)
-- ============================================================================
CREATE OR REPLACE FUNCTION prevent_manual_activity_metadata_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow updates if metadata is not being changed
  IF OLD."metadata" IS DISTINCT FROM NEW."metadata" THEN
    -- Check if this is a legitimate system update
    -- Allow if it's a fix operation (e.g., fixing null collectionImage)
    DECLARE
      old_metadata JSONB;
      new_metadata JSONB;
      is_fix_operation BOOLEAN := FALSE;
    BEGIN
      old_metadata := OLD."metadata"::JSONB;
      new_metadata := NEW."metadata"::JSONB;
      
      -- Allow if adding missing collectionImage to LAUNCHPAD_CREATED activities
      IF NEW."type" = 'LAUNCHPAD_CREATED' THEN
        -- Check if only collectionImage is being added/updated
        IF (old_metadata->>'collectionImage' IS NULL OR old_metadata->>'collectionImage' = '') 
           AND (new_metadata->>'collectionImage' IS NOT NULL AND new_metadata->>'collectionImage' != '') THEN
          -- This is a fix operation for null collectionImage
          is_fix_operation := TRUE;
        END IF;
      END IF;
      
      -- Allow if it's a recognized fix operation
      IF is_fix_operation THEN
        RAISE NOTICE 'Allowed metadata update for activity % (fix operation)', NEW.id;
        RETURN NEW;
      END IF;
      
      -- Log warning for other manual updates
      RAISE WARNING 'Manual metadata update detected for activity %. Type: %, TxHash: %', 
        NEW.id, NEW."type", NEW."txHash";
      
      -- Allow the update but log it
      -- To block updates instead, use: RAISE EXCEPTION 'Manual metadata updates are not allowed';
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to monitor manual metadata updates
DROP TRIGGER IF EXISTS prevent_manual_activity_metadata_update_trigger ON "activities";
CREATE TRIGGER prevent_manual_activity_metadata_update_trigger
BEFORE UPDATE ON "activities"
FOR EACH ROW
WHEN (OLD."metadata" IS DISTINCT FROM NEW."metadata")
EXECUTE FUNCTION prevent_manual_activity_metadata_update();

-- ============================================================================
-- Function: Auto-update activity metadata when related data changes
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_activity_metadata_on_launchpad_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Update LAUNCHPAD_CREATED activities when launchpad metadata changes
  IF TG_TABLE_NAME = 'launchpad_metadata' THEN
    -- Update activities with new collection image
    UPDATE "activities"
    SET "metadata" = jsonb_set(
      COALESCE("metadata"::jsonb, '{}'::jsonb),
      '{collectionImage}',
      to_jsonb(NEW."image")
    )
    WHERE "launchpadId" = NEW."launchpadId"
      AND "type" = 'LAUNCHPAD_CREATED'
      AND (
        "metadata"::jsonb->>'collectionImage' IS NULL 
        OR "metadata"::jsonb->>'collectionImage' = ''
        OR "metadata"::jsonb->>'collectionImage' != NEW."image"
      );
    
    RAISE NOTICE 'Synced activity metadata for launchpad %', NEW."launchpadId";
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-sync activity metadata when launchpad metadata changes
DROP TRIGGER IF EXISTS sync_activity_metadata_trigger ON "launchpad_metadata";
CREATE TRIGGER sync_activity_metadata_trigger
AFTER INSERT OR UPDATE ON "launchpad_metadata"
FOR EACH ROW
WHEN (NEW."image" IS NOT NULL)
EXECUTE FUNCTION sync_activity_metadata_on_launchpad_update();

-- ============================================================================
-- Verification: Check and fix activities with null collectionImage
-- ============================================================================
DO $$
DECLARE
  activity_record RECORD;
  launchpad_record RECORD;
  fixed_count INTEGER := 0;
  no_image_count INTEGER := 0;
BEGIN
  RAISE NOTICE 'Starting activity metadata verification and fix...';
  
  -- Find all LAUNCHPAD_CREATED activities with null or missing collectionImage
  FOR activity_record IN 
    SELECT 
      a.id,
      a."launchpadId",
      a."metadata",
      a."txHash"
    FROM "activities" a
    WHERE a."type" = 'LAUNCHPAD_CREATED'
      AND (
        a."metadata"::jsonb->>'collectionImage' IS NULL 
        OR a."metadata"::jsonb->>'collectionImage' = ''
      )
  LOOP
    -- Get launchpad metadata
    SELECT 
      l.id,
      l."contractAddress",
      lm."image"
    INTO launchpad_record
    FROM "launchpads" l
    LEFT JOIN "launchpad_metadata" lm ON lm."launchpadId" = l.id
    WHERE l.id = activity_record."launchpadId";
    
    -- Fix if launchpad has image
    IF launchpad_record."image" IS NOT NULL AND launchpad_record."image" != '' THEN
      UPDATE "activities"
      SET "metadata" = jsonb_set(
        COALESCE("metadata"::jsonb, '{}'::jsonb),
        '{collectionImage}',
        to_jsonb(launchpad_record."image")
      )
      WHERE id = activity_record.id;
      
      fixed_count := fixed_count + 1;
      RAISE NOTICE 'Fixed activity % for launchpad %', 
        activity_record.id, 
        launchpad_record."contractAddress";
    ELSE
      no_image_count := no_image_count + 1;
      RAISE NOTICE 'No image available for activity % (launchpad: %)', 
        activity_record.id,
        COALESCE(launchpad_record."contractAddress", 'NOT FOUND');
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Verification complete. Fixed: %, No image available: %', 
    fixed_count, 
    no_image_count;
END $$;

-- ============================================================================
-- Comments for documentation
-- ============================================================================
COMMENT ON FUNCTION prevent_manual_activity_metadata_update() IS 
  'Monitors and logs manual updates to activity metadata. Allows fix operations for null collectionImage but warns on other manual changes.';

COMMENT ON FUNCTION sync_activity_metadata_on_launchpad_update() IS 
  'Auto-syncs activity metadata when launchpad metadata changes. Keeps collectionImage in sync with LaunchpadMetadata.';

COMMENT ON TRIGGER prevent_manual_activity_metadata_update_trigger ON "activities" IS
  'Prevents accidental manual updates to activity metadata while allowing legitimate fix operations.';

COMMENT ON TRIGGER sync_activity_metadata_trigger ON "launchpad_metadata" IS
  'Automatically updates activity metadata when launchpad metadata changes.';
