-- Manual migration: Add unique constraint to mints table
-- Prevents duplicate mint records for same launchpad + tokenId

-- Add unique constraint on launchpadId + tokenId
CREATE UNIQUE INDEX IF NOT EXISTS "mints_launchpadId_tokenId_key" 
ON public.mints ("launchpadId", "tokenId");

-- Verify the constraint was created
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'mints_launchpadId_tokenId_key'
  ) THEN
    RAISE NOTICE 'Unique constraint mints_launchpadId_tokenId_key successfully created';
  ELSE
    RAISE EXCEPTION 'Failed to create unique constraint mints_launchpadId_tokenId_key';
  END IF;
END $$;
