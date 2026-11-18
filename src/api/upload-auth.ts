/**
 * Authorization for IPFS uploads.
 *
 * Uploads come straight from the creator's browser (launchpad UI), so they
 * cannot carry the admin key. Instead the launchpad asks the wallet to sign a
 * short message (see launchpad src/lib/creator-auth-message.ts) and sends:
 *
 *   x-creator-address, x-creator-issued-at, x-creator-signature
 *
 * The message format below MUST stay identical to the launchpad's.
 * Admin callers may use the admin key instead.
 */

import type { IncomingMessage } from 'http';
import { ethers } from 'ethers';
import { validateAdminAuth } from './admin';

const MAX_AGE_MS = 10 * 60 * 1000;
const FUTURE_SKEW_MS = 60 * 1000;
const IPFS_UPLOAD_TARGET = 'ipfs';

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT_PER_WALLET = parseInt(process.env.UPLOAD_LIMIT_PER_WALLET || '30', 10);
const LIMIT_PER_IP = parseInt(process.env.UPLOAD_LIMIT_PER_IP || '60', 10);
const hits = new Map<string, number[]>();

function buildCreatorAuthMessage(params: { action: string; target: string; signer: string; issuedAt: string }): string {
  return [
    'Odds Launchpad - authorize creator action',
    `Action: ${params.action}`,
    `Target: ${params.target.toLowerCase()}`,
    `Signer: ${params.signer.toLowerCase()}`,
    `Issued At: ${params.issuedAt}`,
  ].join('\n');
}

function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

/** Returns the lower-cased signer address, or null if the signature is missing/invalid/expired. */
export function verifyUploadSignature(req: IncomingMessage): string | null {
  const address = header(req, 'x-creator-address');
  const issuedAt = header(req, 'x-creator-issued-at');
  const signature = header(req, 'x-creator-signature');
  if (!address || !issuedAt || !signature || !ethers.isAddress(address)) return null;

  const issuedMs = Date.parse(issuedAt);
  const now = Date.now();
  if (!Number.isFinite(issuedMs) || issuedMs < now - MAX_AGE_MS || issuedMs > now + FUTURE_SKEW_MS) return null;

  try {
    const message = buildCreatorAuthMessage({ action: 'ipfs:upload', target: IPFS_UPLOAD_TARGET, signer: address, issuedAt });
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === address.toLowerCase() ? recovered.toLowerCase() : null;
  } catch {
    return null;
  }
}

function overLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => t > now - WINDOW_MS);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) {
    hits.forEach((v, k) => {
      if (!v.length || v[v.length - 1] <= now - WINDOW_MS) hits.delete(k);
    });
  }
  return list.length > limit;
}

function clientIp(req: IncomingMessage): string {
  const fwd = header(req, 'x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return header(req, 'x-real-ip') || req.socket.remoteAddress || 'unknown';
}

/** null = allowed; otherwise the error to return. */
export function authorizeUploader(req: IncomingMessage): { status: number; error: string } | null {
  if (validateAdminAuth(req).valid) return null;

  const signer = verifyUploadSignature(req);
  if (!signer) {
    return { status: 401, error: 'Unauthorized: connect a wallet and sign the upload authorization' };
  }
  if (overLimit(`w:${signer}`, LIMIT_PER_WALLET) || overLimit(`ip:${clientIp(req)}`, LIMIT_PER_IP)) {
    return { status: 429, error: 'Too many uploads, try again later' };
  }
  return null;
}
