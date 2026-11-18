/**
 * Validation helper functions for blockchain events
 */

/**
 * Validate if a string is a valid Ethereum transaction hash
 */
export function isValidTxHash(txHash: string): boolean {
  if (typeof txHash !== 'string') {
    return false;
  }
  return /^0x[a-fA-F0-9]{64}$/.test(txHash);
}

/**
 * Validate if a string is a valid Ethereum address
 */
export function isValidAddress(address: string): boolean {
  if (typeof address !== 'string') {
    return false;
  }
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate event data by checking required fields and data types
 */
export function validateEventData(event: any, requiredFields: string[]): void {
  if (!event) {
    throw new Error('Event data is null or undefined');
  }

  // Check for required fields
  for (const field of requiredFields) {
    if (event[field] === undefined || event[field] === null) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validate transaction hash if present
  if (event.txHash && !isValidTxHash(event.txHash)) {
    throw new Error(`Invalid transaction hash: ${event.txHash}`);
  }

  // Validate block number if present
  if (event.blockNumber !== undefined && event.blockNumber !== null) {
    if (typeof event.blockNumber !== 'number' || event.blockNumber < 0) {
      throw new Error(`Invalid block number: ${event.blockNumber}`);
    }
  }

  // Validate Ethereum addresses if present
  const addressFields = [
    'launchpadAddress', 'owner', 'creator', 'to', 'from', 
    'recipient', 'account', 'sender', 'previousOwner', 
    'newOwner', 'oldTreasury', 'newTreasury'
  ];
  
  for (const field of addressFields) {
    if (event[field] && !isValidAddress(event[field])) {
      throw new Error(`Invalid Ethereum address for field ${field}: ${event[field]}`);
    }
  }
}

/**
 * Delay helper for rate limiting
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
