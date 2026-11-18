/**
 * WebSocket Data Validator
 * Validates event data structures before processing
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate mint event data
 */
export function validateMintEvent(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data) {
    return { isValid: false, errors: ['Event data is null or undefined'] };
  }

  // Required fields
  if (!data.contractAddress || typeof data.contractAddress !== 'string' || data.contractAddress.length !== 40) {
    errors.push('Invalid contractAddress: must be 40 character hex string');
  }

  if (!data.chainId || typeof data.chainId !== 'number' || data.chainId <= 0) {
    errors.push('Invalid chainId: must be positive number');
  }

  if (!data.minter || typeof data.minter !== 'string' || data.minter.length !== 40) {
    errors.push('Invalid minter: must be 40 character hex string');
  }

  if (!data.tokenId || typeof data.tokenId !== 'string' || data.tokenId.length === 0) {
    errors.push('Invalid tokenId: must be non-empty string');
  }

  if (data.quantity === undefined || typeof data.quantity !== 'number' || data.quantity <= 0) {
    errors.push('Invalid quantity: must be positive number');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate collection event data
 */
export function validateCollectionEvent(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data) {
    return { isValid: false, errors: ['Event data is null or undefined'] };
  }

  if (!data.contractAddress || typeof data.contractAddress !== 'string' || data.contractAddress.length !== 40) {
    errors.push('Invalid contractAddress: must be 40 character hex string');
  }

  if (!data.chainId || typeof data.chainId !== 'number' || data.chainId <= 0) {
    errors.push('Invalid chainId: must be positive number');
  }

  if (!data.name || typeof data.name !== 'string' || data.name.length === 0) {
    errors.push('Invalid name: must be non-empty string');
  }

  if (data.totalSupply === undefined || typeof data.totalSupply !== 'number' || data.totalSupply <= 0) {
    errors.push('Invalid totalSupply: must be positive number');
  }

  if (!data.creator || typeof data.creator !== 'string' || data.creator.length !== 40) {
    errors.push('Invalid creator: must be 40 character hex string');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate phase event data
 */
export function validatePhaseEvent(data: any): ValidationResult {
  const errors: string[] = [];

  if (!data) {
    return { isValid: false, errors: ['Event data is null or undefined'] };
  }

  if (!data.contractAddress || typeof data.contractAddress !== 'string' || data.contractAddress.length !== 40) {
    errors.push('Invalid contractAddress: must be 40 character hex string');
  }

  if (!data.phaseId || typeof data.phaseId !== 'string' || data.phaseId.length === 0) {
    errors.push('Invalid phaseId: must be non-empty string');
  }

  if (data.minted === undefined || typeof data.minted !== 'number' || data.minted < 0) {
    errors.push('Invalid minted: must be non-negative number');
  }

  if (typeof data.isActive !== 'boolean') {
    errors.push('Invalid isActive: must be boolean');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate room name format
 */
export function validateRoomName(roomName: string): ValidationResult {
  const errors: string[] = [];

  if (!roomName || typeof roomName !== 'string') {
    return { isValid: false, errors: ['Room name must be a non-empty string'] };
  }

  // Valid patterns:
  // - homepage:all
  // - homepage:chain:{chainId}
  // - launchpad:{contractAddress}
  // - wallet:{address}

  const patterns = [
    /^homepage:all$/,
    /^homepage:chain:\d+$/,
    /^launchpad:[a-fA-F0-9]{40}$/,
    /^wallet:[a-fA-F0-9]{40}$/,
  ];

  const isValid = patterns.some(pattern => pattern.test(roomName));

  if (!isValid) {
    errors.push(`Invalid room name format: ${roomName}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Generic event data validation
 */
export function isValidEventData(event: any): boolean {
  if (!event || typeof event !== 'object') {
    return false;
  }

  if (!event.type || typeof event.type !== 'string') {
    return false;
  }

  if (!event.data || typeof event.data !== 'object') {
    return false;
  }

  return true;
}

/**
 * Validate hex string format
 */
export function isValidHexString(value: string, length?: number): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const hexPattern = /^(0x)?[a-fA-F0-9]+$/;
  if (!hexPattern.test(value)) {
    return false;
  }

  if (length !== undefined) {
    const cleanValue = value.startsWith('0x') ? value.slice(2) : value;
    return cleanValue.length === length;
  }

  return true;
}

/**
 * Validate timestamp format
 */
export function isValidTimestamp(timestamp: any): boolean {
  if (!timestamp) {
    return false;
  }

  // Accept Date objects
  if (timestamp instanceof Date) {
    return !isNaN(timestamp.getTime());
  }

  // Accept ISO strings
  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    return !isNaN(date.getTime());
  }

  // Accept Unix timestamps
  if (typeof timestamp === 'number') {
    return timestamp > 0;
  }

  return false;
}
