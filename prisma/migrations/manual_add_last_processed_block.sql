-- Add lastProcessedBlock and lastProcessedBlockAt to LaunchpadFactory table
-- This allows the service to resume factory event polling from the last processed block after restart

ALTER TABLE "launchpad_factories" 
ADD COLUMN IF NOT EXISTS "lastProcessedBlock" INTEGER,
ADD COLUMN IF NOT EXISTS "lastProcessedBlockAt" TIMESTAMP(3);

-- Add comment for documentation
COMMENT ON COLUMN "launchpad_factories"."lastProcessedBlock" IS 'Last block number processed for ContractDeployed events';
COMMENT ON COLUMN "launchpad_factories"."lastProcessedBlockAt" IS 'Timestamp when last block was processed';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS "launchpad_factories_lastProcessedBlock_idx" ON "launchpad_factories"("lastProcessedBlock");
