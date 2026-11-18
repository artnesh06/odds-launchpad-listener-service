-- =====================================================
-- Config Change Notification Triggers
-- =====================================================
-- These triggers notify the application when factories
-- or launchpads are added/updated/deleted, so Ponder
-- config can be automatically regenerated.
-- =====================================================

-- =====================================================
-- 1. Factory Config Change Notification
-- =====================================================

-- Drop existing function if exists
DROP FUNCTION IF EXISTS notify_factory_config_change() CASCADE;

-- Create function to notify factory config changes
CREATE OR REPLACE FUNCTION notify_factory_config_change()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
BEGIN
  -- Build notification payload
  IF TG_OP = 'DELETE' THEN
    payload = json_build_object(
      'operation', TG_OP,
      'chain_id', OLD.chain_id,
      'address', OLD.contract_address,
      'is_active', OLD.is_active,
      'timestamp', NOW()
    );
  ELSE
    payload = json_build_object(
      'operation', TG_OP,
      'chain_id', NEW.chain_id,
      'address', NEW.contract_address,
      'is_active', NEW.is_active,
      'timestamp', NOW()
    );
  END IF;

  -- Send notification
  PERFORM pg_notify('factory_config_changed', payload::text);
  
  -- Log the change
  RAISE NOTICE 'Factory config changed: %', payload;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for factory changes
DROP TRIGGER IF EXISTS factory_config_change_trigger ON launchpad_factories;

CREATE TRIGGER factory_config_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON launchpad_factories
FOR EACH ROW
EXECUTE FUNCTION notify_factory_config_change();

COMMENT ON TRIGGER factory_config_change_trigger ON launchpad_factories IS 
'Notifies application when factory config changes, triggering auto-regeneration of ponder.config.ts';

-- =====================================================
-- 2. Launchpad Config Change Notification
-- =====================================================

-- Drop existing function if exists
DROP FUNCTION IF EXISTS notify_launchpad_config_change() CASCADE;

-- Create function to notify launchpad config changes
CREATE OR REPLACE FUNCTION notify_launchpad_config_change()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
  should_notify BOOLEAN := FALSE;
BEGIN
  -- Determine if we should notify
  IF TG_OP = 'INSERT' THEN
    should_notify = TRUE;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only notify if status changed or contract address changed
    should_notify = (OLD.status != NEW.status) OR (OLD.contract_address != NEW.contract_address);
  ELSIF TG_OP = 'DELETE' THEN
    should_notify = TRUE;
  END IF;

  -- Send notification if needed
  IF should_notify THEN
    IF TG_OP = 'DELETE' THEN
      payload = json_build_object(
        'operation', TG_OP,
        'chain_id', OLD.chain_id,
        'address', OLD.contract_address,
        'status', OLD.status,
        'timestamp', NOW()
      );
    ELSE
      payload = json_build_object(
        'operation', TG_OP,
        'chain_id', NEW.chain_id,
        'address', NEW.contract_address,
        'status', NEW.status,
        'timestamp', NOW()
      );
    END IF;

    -- Send notification
    PERFORM pg_notify('launchpad_config_changed', payload::text);
    
    -- Log the change
    RAISE NOTICE 'Launchpad config changed: %', payload;
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for launchpad changes
DROP TRIGGER IF EXISTS launchpad_config_change_trigger ON launchpads;

CREATE TRIGGER launchpad_config_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON launchpads
FOR EACH ROW
EXECUTE FUNCTION notify_launchpad_config_change();

COMMENT ON TRIGGER launchpad_config_change_trigger ON launchpads IS 
'Notifies application when launchpad config changes (new launchpad, status change), triggering auto-regeneration of ponder.config.ts';

-- =====================================================
-- 3. Chain Config Change Notification (Optional)
-- =====================================================

-- Drop existing function if exists
DROP FUNCTION IF EXISTS notify_chain_config_change() CASCADE;

-- Create function to notify chain config changes
CREATE OR REPLACE FUNCTION notify_chain_config_change()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
BEGIN
  -- Build notification payload
  IF TG_OP = 'DELETE' THEN
    payload = json_build_object(
      'operation', TG_OP,
      'chain_id', OLD.chain_id,
      'name', OLD.name,
      'timestamp', NOW()
    );
  ELSE
    payload = json_build_object(
      'operation', TG_OP,
      'chain_id', NEW.chain_id,
      'name', NEW.name,
      'rpc_url', NEW.rpc_url,
      'timestamp', NOW()
    );
  END IF;

  -- Send notification
  PERFORM pg_notify('chain_config_changed', payload::text);
  
  -- Log the change
  RAISE NOTICE 'Chain config changed: %', payload;
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for chain changes
DROP TRIGGER IF EXISTS chain_config_change_trigger ON chains;

CREATE TRIGGER chain_config_change_trigger
AFTER INSERT OR UPDATE OR DELETE ON chains
FOR EACH ROW
EXECUTE FUNCTION notify_chain_config_change();

COMMENT ON TRIGGER chain_config_change_trigger ON chains IS 
'Notifies application when chain config changes, triggering auto-regeneration of ponder.config.ts';

-- =====================================================
-- Verification Queries
-- =====================================================

-- Check if triggers are created
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name IN (
  'factory_config_change_trigger',
  'launchpad_config_change_trigger',
  'chain_config_change_trigger'
)
ORDER BY event_object_table, trigger_name;

-- Check if functions are created
SELECT 
  routine_name,
  routine_type,
  data_type
FROM information_schema.routines
WHERE routine_name IN (
  'notify_factory_config_change',
  'notify_launchpad_config_change',
  'notify_chain_config_change'
)
ORDER BY routine_name;

-- =====================================================
-- Test Notifications (Optional)
-- =====================================================

-- To test notifications, run in a separate session:
-- LISTEN factory_config_changed;
-- LISTEN launchpad_config_changed;
-- LISTEN chain_config_changed;

-- Then in this session, make a change:
-- UPDATE launchpad_factories SET is_active = is_active WHERE id = (SELECT id FROM launchpad_factories LIMIT 1);

-- You should see a notification in the listening session

-- =====================================================
-- Cleanup (if needed)
-- =====================================================

-- To remove all triggers and functions:
-- DROP TRIGGER IF EXISTS factory_config_change_trigger ON launchpad_factories;
-- DROP TRIGGER IF EXISTS launchpad_config_change_trigger ON launchpads;
-- DROP TRIGGER IF EXISTS chain_config_change_trigger ON chains;
-- DROP FUNCTION IF EXISTS notify_factory_config_change() CASCADE;
-- DROP FUNCTION IF EXISTS notify_launchpad_config_change() CASCADE;
-- DROP FUNCTION IF EXISTS notify_chain_config_change() CASCADE;
