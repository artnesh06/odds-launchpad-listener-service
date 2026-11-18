-- Manual migration to add ProcessedEvent table for event deduplication
-- This table tracks processed blockchain events to prevent duplicate processing
-- Requirements: 6.2

-- Create the processed_events table
CREATE TABLE IF NOT EXISTS "processed_events" (
    "id" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on (transactionHash, logIndex) for deduplication
CREATE UNIQUE INDEX IF NOT EXISTS "processed_events_transactionHash_logIndex_key" 
ON "processed_events"("transactionHash", "logIndex");

-- Create index on processedAt for cleanup queries
CREATE INDEX IF NOT EXISTS "processed_events_processedAt_idx" 
ON "processed_events"("processedAt");
