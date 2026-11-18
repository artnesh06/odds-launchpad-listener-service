/**
 * WebSocket Origin Validator
 * Validates connection origins against whitelist
 */

export interface OriginValidationResult {
  isAllowed: boolean;
  origin: string;
  reason: string;
}

/**
 * Check if origin is in allowed list
 */
export function isOriginAllowed(origin: string | null | undefined, allowedOrigins: string[]): boolean {
  if (!origin || typeof origin !== 'string' || origin.trim() === '') {
    return false;
  }

  const normalizedOrigin = origin.toLowerCase().trim();

  for (const allowed of allowedOrigins) {
    const normalizedAllowed = allowed.toLowerCase().trim();

    // Exact match
    if (normalizedOrigin === normalizedAllowed) {
      return true;
    }

    // Wildcard match (e.g., https://*.example.com)
    if (normalizedAllowed.includes('*')) {
      const pattern = normalizedAllowed.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      if (regex.test(normalizedOrigin)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validate origin with detailed result
 */
export function validateOrigin(origin: string | null | undefined, allowedOrigins: string[]): OriginValidationResult {
  if (!origin || typeof origin !== 'string' || origin.trim() === '') {
    return {
      isAllowed: false,
      origin: origin || '',
      reason: 'Origin is empty or invalid',
    };
  }

  // Check if origin is well-formed URL
  try {
    new URL(origin);
  } catch {
    return {
      isAllowed: false,
      origin,
      reason: 'Origin is not a valid URL',
    };
  }

  const isAllowed = isOriginAllowed(origin, allowedOrigins);

  return {
    isAllowed,
    origin,
    reason: isAllowed ? 'Origin is whitelisted' : 'Origin is not in whitelist',
  };
}

/**
 * Extract origin from request headers
 */
export function extractOrigin(headers: Record<string, string | string[] | undefined>): string | null {
  const origin = headers.origin || headers.Origin;

  if (Array.isArray(origin)) {
    return origin[0] || null;
  }

  return origin || null;
}

/**
 * Check if origin matches pattern with wildcard
 */
function matchesWildcard(origin: string, pattern: string): boolean {
  const regexPattern = pattern.replace(/\*/g, '.*').replace(/\./g, '\\.');
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(origin);
}

/**
 * Parse origin into components
 */
export function parseOrigin(origin: string): {
  protocol: string;
  hostname: string;
  port: string | null;
} | null {
  try {
    const url = new URL(origin);
    return {
      protocol: url.protocol.replace(':', ''),
      hostname: url.hostname,
      port: url.port || null,
    };
  } catch {
    return null;
  }
}

/**
 * Check if two origins are equivalent
 */
export function areOriginsEquivalent(origin1: string, origin2: string): boolean {
  const parsed1 = parseOrigin(origin1);
  const parsed2 = parseOrigin(origin2);

  if (!parsed1 || !parsed2) {
    return false;
  }

  return (
    parsed1.protocol.toLowerCase() === parsed2.protocol.toLowerCase() &&
    parsed1.hostname.toLowerCase() === parsed2.hostname.toLowerCase() &&
    parsed1.port === parsed2.port
  );
}
