-- Manual migration to add error_logs table
-- This is safe to run and will not delete any existing data

-- Create error_logs table
CREATE TABLE IF NOT EXISTS "error_logs" (
  "id" TEXT NOT NULL,
  "errorType" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "stack" TEXT,
  "component" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "chainId" INTEGER,
  "contractAddress" TEXT,
  "tokenId" TEXT,
  "txHash" TEXT,
  "blockNumber" INTEGER,
  "metadata" JSONB,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "error_logs_errorType_severity_idx" 
  ON "error_logs"("errorType", "severity");

CREATE INDEX IF NOT EXISTS "error_logs_component_operation_idx" 
  ON "error_logs"("component", "operation");

CREATE INDEX IF NOT EXISTS "error_logs_createdAt_idx" 
  ON "error_logs"("createdAt");

-- Verify table was created
SELECT 'error_logs table created successfully' AS status;
