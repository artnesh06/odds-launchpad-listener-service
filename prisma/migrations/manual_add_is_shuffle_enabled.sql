-- Migration: Add isShuffleEnabled field to launchpads table
-- Date: 2026-02-07
-- Description: Adds support for token ID shuffling feature in collections

-- Add isShuffleEnabled column with default false
ALTER TABLE "launchpads" 
ADD COLUMN IF NOT EXISTS "isShuffleEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN "launchpads"."isShuffleEnabled" IS 'Whether token ID shuffling is enabled for this collection';
