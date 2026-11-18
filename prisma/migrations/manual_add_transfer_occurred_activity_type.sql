-- Manual migration: Add TRANSFER_OCCURRED to ActivityType enum
-- This allows tracking NFT transfers (e.g., OpenSea sales) separately from mints

-- Add new value to ActivityType enum
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'TRANSFER_OCCURRED';

-- Verify the enum values
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum 
    WHERE enumlabel = 'TRANSFER_OCCURRED' 
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ActivityType')
  ) THEN
    RAISE NOTICE 'TRANSFER_OCCURRED successfully added to ActivityType enum';
  ELSE
    RAISE EXCEPTION 'Failed to add TRANSFER_OCCURRED to ActivityType enum';
  END IF;
END $$;
