-- Manual migration to add isFeatured field to launchpads table
-- This migration adds the isFeatured boolean field with a default value of false
-- and creates an index on the field for efficient querying

-- Add isFeatured column to launchpads table
ALTER TABLE "launchpads" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;

-- Create index on isFeatured for efficient querying of featured launchpads
CREATE INDEX IF NOT EXISTS "launchpads_isFeatured_idx" ON "launchpads"("isFeatured");

-- Add comment to document the purpose of this field
COMMENT ON COLUMN "launchpads"."isFeatured" IS 'Featured launchpads receive real-time WebSocket monitoring for mint events';
