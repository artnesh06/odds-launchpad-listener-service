/**
 * Custom generators for property-based testing
 */
import * as fc from 'fast-check';
import { io, Socket as ClientSocket } from 'socket.io-client';

/**
 * Generate hex string of specific length
 */
export function hexString(length: number): fc.Arbitrary<string> {
  const hexChars = '0123456789abcdef';
  return fc
    .array(fc.constantFrom(...hexChars.split('')), { minLength: length, maxLength: length })
    .map(arr => arr.join(''));
}

/**
 * Generate Ethereum address (40 hex characters WITHOUT 0x prefix)
 * This matches the validator expectation
 */
export function ethereumAddress(): fc.Arbitrary<string> {
  return hexString(40);
}

/**
 * Alias for ethereumAddress for use in property tests
 */
export function ethereumAddressArb(): fc.Arbitrary<string> {
  return ethereumAddress();
}

/**
 * Generate Ethereum address WITH 0x prefix (42 chars total)
 */
export function ethereumAddressWithPrefix(): fc.Arbitrary<string> {
  return hexString(40).map(h => `0x${h}`);
}

/**
 * Generate transaction hash (64 hex characters WITHOUT 0x prefix)
 * This matches the validator expectation
 */
export function transactionHash(): fc.Arbitrary<string> {
  return hexString(64);
}

/**
 * Alias for transactionHash for use in property tests
 */
export function transactionHashArb(): fc.Arbitrary<string> {
  return transactionHash();
}

/**
 * Generate transaction hash WITH 0x prefix (66 chars total)
 */
export function transactionHashWithPrefix(): fc.Arbitrary<string> {
  return hexString(64).map(h => `0x${h}`);
}

/**
 * Generate chain ID
 */
export function chainId(): fc.Arbitrary<number> {
  return fc.integer({ min: 1, max: 999999 });
}

/**
 * Generate token ID
 */
export function tokenId(): fc.Arbitrary<string> {
  return fc.integer({ min: 1, max: 100000 }).map(String);
}

/**
 * Create a test socket.io client with proper origin headers
 */
export function createTestClient(port: number, options: any = {}): ClientSocket {
  return io(`http://localhost:${port}`, {
    transports: ['websocket'],
    extraHeaders: {
      origin: 'http://localhost:3000'
    },
    ...options
  });
}
