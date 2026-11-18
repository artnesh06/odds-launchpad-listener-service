/**
 * IPFS Utility Functions with Gateway Racing & Caching
 * Optimized for fastest gateway detection with automatic cancellation
 * Cache resets every 6 hours for optimal performance
 */

// List of IPFS gateways to test (ordered by general reliability)
const IPFS_GATEWAYS = [
  'https://ipfs.filebase.io',
  'https://ipfs.orbitor.dev',
  'https://latam.orbitor.dev',
  'https://apac.orbitor.dev',
  'https://eu.orbitor.dev',
  'https://dget.top',
  'https://flk-ipfs.xyz',
  'https://ipfs.cyou',
  'https://dlunar.net',
  'https://storry.tv',
  'https://ipfs.io',
  'https://dweb.link',
  'https://gateway.pinata.cloud',
  'https://hardbin.com',
  'https://ipfs.runfission.com',
  'https://ipfs.eth.aragon.network',
  'https://4everland.io',
  'https://w3s.link',
  'https://trustless-gateway.link',
  'https://ipfs.ecolatam.com',
];

// Known IPFS gateway patterns to detect
const KNOWN_IPFS_GATEWAY_PATTERNS = [
  /https?:\/\/[^\/]*\.ipfs\.[^\/]+\/ipfs\//i,           // subdomain.ipfs.domain.com/ipfs/
  /https?:\/\/[^\/]*ipfs[^\/]*\.[^\/]+\/ipfs\//i,       // ipfs.domain.com/ipfs/ or domain.ipfs.com/ipfs/
  /https?:\/\/gateway\.pinata\.cloud\/ipfs\//i,         // gateway.pinata.cloud/ipfs/
  /https?:\/\/[^\/]*\.mypinata\.cloud\/ipfs\//i,        // custom.mypinata.cloud/ipfs/
  /https?:\/\/cloudflare-ipfs\.com\/ipfs\//i,           // cloudflare-ipfs.com/ipfs/
  /https?:\/\/[^\/]*\.4everland\.io\/ipfs\//i,          // gateway.4everland.io/ipfs/
  /https?:\/\/dweb\.link\/ipfs\//i,                     // dweb.link/ipfs/
  /https?:\/\/w3s\.link\/ipfs\//i,                      // w3s.link/ipfs/
  /https?:\/\/[^\/]*\.infura-ipfs\.io\/ipfs\//i,        // infura-ipfs.io/ipfs/
  /https?:\/\/[^\/]*\.fleek\.co\/ipfs\//i,              // fleek.co/ipfs/
];

// Cache for fastest gateway
let cachedFastestGateway: string | null = null;
let gatewayTestInProgress = false;
let gatewayTestPromise: Promise<string> | null = null;

// Test image hash (small file for quick testing)
const TEST_HASH = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

// Cache duration: 6 hours
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Extract IPFS hash from URL (with optional path)
 * @param url - URL that might contain IPFS hash
 * @returns IPFS hash with path (e.g., "QmHash/file.json") or null
 */
export function extractIpfsHash(url: string): string | null {
  // Check if it's an IPFS gateway URL
  const ipfsMatch = url.match(/\/ipfs\/([a-zA-Z0-9]+(?:\/[^?#]*)?)/);
  if (ipfsMatch && ipfsMatch[1]) {
    return ipfsMatch[1];
  }
  
  // If it's ipfs:// protocol
  if (url.startsWith('ipfs://')) {
    return url.replace('ipfs://', '');
  }
  
  return null;
}

/**
 * Check if URL is an IPFS gateway URL
 * @param url - URL to check
 * @returns true if it's an IPFS gateway URL
 */
export function isIpfsGatewayUrl(url: string): boolean {
  return KNOWN_IPFS_GATEWAY_PATTERNS.some(pattern => pattern.test(url));
}

/**
 * Test a single gateway speed with AbortController
 * @param gateway - Gateway URL to test
 * @param testHash - IPFS hash to test with
 * @param timeout - Timeout in ms
 * @param controller - AbortController for cancellation
 * @returns Response time in ms or throws error
 */
async function testGatewaySpeed(
  gateway: string,
  testHash: string = TEST_HASH,
  timeout: number = 5000,
  controller: AbortController
): Promise<{ gateway: string; responseTime: number }> {
  const startTime = performance.now();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${gateway}/ipfs/${testHash}`, {
      method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const responseTime = performance.now() - startTime;
      return { gateway, responseTime };
    }

    throw new Error(`Gateway returned ${response.status}`);
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Race multiple gateways and cancel losers
 * @param gateways - List of gateways to race
 * @param testHash - IPFS hash to test with
 * @returns Fastest gateway URL
 */
async function raceGateways(
  gateways: string[],
  testHash: string = TEST_HASH
): Promise<string> {
  console.log(`🏁 Racing ${gateways.length} IPFS gateways...`);

  // Create AbortController for each gateway
  const controllers = gateways.map(() => new AbortController());

  // Start all tests simultaneously
  const racePromises = gateways.map((gateway, index) =>
    testGatewaySpeed(gateway, testHash, 5000, controllers[index]).catch(() => {
      // Return null for failed gateways
      return null;
    })
  );

  // Race all promises - first successful one wins
  const winner = await Promise.race(
    racePromises.map(async (promise, index) => {
      const result = await promise;
      if (result) {
        // Cancel all other requests
        controllers.forEach((controller, i) => {
          if (i !== index) {
            controller.abort();
          }
        });
        return result;
      }
      return null;
    })
  );

  if (winner) {
    console.log(`✅ Winner: ${winner.gateway} (${winner.responseTime.toFixed(0)}ms)`);
    return winner.gateway;
  }

  // If race didn't produce winner, wait for any successful result
  const results = await Promise.allSettled(racePromises);
  const successful = results
    .filter(
      (r): r is PromiseFulfilledResult<{ gateway: string; responseTime: number }> =>
        r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value)
    .sort((a, b) => a.responseTime - b.responseTime);

  if (successful.length > 0) {
    const fastest = successful[0];
    console.log(`✅ Fastest gateway: ${fastest.gateway} (${fastest.responseTime.toFixed(0)}ms)`);
    return fastest.gateway;
  }

  // Fallback to first gateway if all failed
  console.warn('⚠️ All gateways failed, using fallback');
  return gateways[0];
}

/**
 * Find fastest IPFS gateway using progressive racing strategy
 * @param gateways - List of gateways to test
 * @returns Fastest gateway URL
 */
async function findFastestGateway(gateways: string[] = IPFS_GATEWAYS): Promise<string> {
  // Strategy: Race first 8 gateways, if all fail, try remaining
  const firstBatch = gateways.slice(0, 8);

  try {
    const winner = await raceGateways(firstBatch);
    return winner;
  } catch (error) {
    console.warn('⚠️ First batch failed, trying remaining gateways...');
    // Try remaining gateways
    const remainingBatch = gateways.slice(8);
    if (remainingBatch.length > 0) {
      return await raceGateways(remainingBatch);
    }
    // Ultimate fallback
    return gateways[0];
  }
}

/**
 * Get fastest gateway (cached or find new one)
 * @returns Promise<string> - Fastest gateway URL
 */
export async function getFastestGateway(): Promise<string> {
  // Return cached gateway if available
  if (cachedFastestGateway) {
    return cachedFastestGateway;
  }

  // If test is already in progress, wait for it
  if (gatewayTestInProgress && gatewayTestPromise) {
    return gatewayTestPromise;
  }

  // Start new test
  gatewayTestInProgress = true;
  gatewayTestPromise = findFastestGateway()
    .then((gateway) => {
      cachedFastestGateway = gateway;
      gatewayTestInProgress = false;

      // Store in memory cache with timestamp
      if (typeof global !== 'undefined') {
        (global as any).__ipfs_gateway_cache = {
          gateway,
          timestamp: Date.now(),
        };
      }

      return gateway;
    })
    .catch((error) => {
      console.error('Gateway test failed:', error);
      gatewayTestInProgress = false;
      // Fallback to first gateway
      cachedFastestGateway = IPFS_GATEWAYS[0];
      return IPFS_GATEWAYS[0];
    });

  return gatewayTestPromise;
}

/**
 * Initialize gateway from cache (call this on app start)
 */
export function initializeGatewayCache(): void {
  try {
    if (typeof global !== 'undefined') {
      const cache = (global as any).__ipfs_gateway_cache;
      if (cache && cache.gateway && cache.timestamp) {
        const age = Date.now() - cache.timestamp;
        if (age < CACHE_DURATION) {
          cachedFastestGateway = cache.gateway;
          const ageMinutes = Math.floor(age / 1000 / 60);
          console.log(`📦 Using cached IPFS gateway: ${cache.gateway} (age: ${ageMinutes}min)`);
        } else {
          console.log('⏰ Gateway cache expired (6h), will test on next request');
          delete (global as any).__ipfs_gateway_cache;
        }
      }
    }
  } catch (e) {
    // Ignore cache errors
  }
}

/**
 * Force re-test gateways (useful if current gateway becomes slow)
 */
export async function retestGateways(): Promise<string> {
  console.log('🔄 Forcing gateway re-test...');
  cachedFastestGateway = null;
  gatewayTestInProgress = false;
  gatewayTestPromise = null;

  if (typeof global !== 'undefined') {
    delete (global as any).__ipfs_gateway_cache;
  }

  return await getFastestGateway();
}

/**
 * Convert IPFS URI to HTTP URL
 * @param ipfsUri - IPFS URI (ipfs://Qm... or Qm... or gateway URL)
 * @param gateway - IPFS gateway URL (optional)
 * @returns HTTP URL
 */
export function ipfsToHttp(ipfsUri: string | null | undefined, gateway?: string): string | null {
  if (!ipfsUri) return null;

  // If already HTTP URL, check if it's an IPFS gateway URL
  if (ipfsUri.startsWith('http://') || ipfsUri.startsWith('https://')) {
    // Check if it's an IPFS gateway URL
    if (isIpfsGatewayUrl(ipfsUri)) {
      // Extract hash and use fastest gateway
      const hash = extractIpfsHash(ipfsUri);
      if (hash) {
        const selectedGateway = gateway || cachedFastestGateway || IPFS_GATEWAYS[0];
        return `${selectedGateway}/ipfs/${hash}`;
      }
    }
    // Not an IPFS URL, return as-is
    return ipfsUri;
  }

  // Remove ipfs:// prefix if present
  const hash = ipfsUri.replace('ipfs://', '');

  // Use provided gateway or cached gateway or fallback
  const selectedGateway = gateway || cachedFastestGateway || IPFS_GATEWAYS[0];

  // Return gateway URL
  return `${selectedGateway}/ipfs/${hash}`;
}

/**
 * Convert IPFS URI to HTTP URL with automatic fastest gateway
 * Includes auto-retry with gateway re-racing if cached gateway fails
 * @param ipfsUri - IPFS URI (ipfs://Qm... or Qm... or gateway URL)
 * @param skipRetry - Skip retry logic (internal use)
 * @returns Promise<string | null> - HTTP URL
 */
export async function ipfsToHttpOptimized(
  ipfsUri: string | null | undefined,
  skipRetry: boolean = false
): Promise<string | null> {
  if (!ipfsUri) return null;

  // Get fastest gateway first
  const gateway = await getFastestGateway();

  // If already HTTP URL, check if it's an IPFS gateway URL
  if (ipfsUri.startsWith('http://') || ipfsUri.startsWith('https://')) {
    // Check if it's an IPFS gateway URL
    if (isIpfsGatewayUrl(ipfsUri)) {
      // Extract hash and use fastest gateway
      const hash = extractIpfsHash(ipfsUri);
      if (hash) {
        const optimizedUrl = `${gateway}/ipfs/${hash}`;
        
        // Verify gateway is working (if not in retry mode)
        if (!skipRetry) {
          try {
            const response = await fetch(optimizedUrl, { 
              method: 'HEAD',
              signal: AbortSignal.timeout(5000)
            });
            
            if (!response.ok) {
              console.warn(`⚠️ Cached gateway failed (${response.status}), re-racing...`);
              // Force re-test and retry
              await retestGateways();
              return ipfsToHttpOptimized(ipfsUri, true); // Retry with new gateway
            }
          } catch (error) {
            console.warn(`⚠️ Cached gateway error, re-racing...`, error);
            // Force re-test and retry
            await retestGateways();
            return ipfsToHttpOptimized(ipfsUri, true); // Retry with new gateway
          }
        }
        
        console.log(`🔄 IPFS Gateway Replaced:`);
        console.log(`   From: ${ipfsUri}`);
        console.log(`   To:   ${optimizedUrl}`);
        return optimizedUrl;
      }
    }
    // Not an IPFS URL, return as-is
    return ipfsUri;
  }

  // Remove ipfs:// prefix if present
  const hash = ipfsUri.replace('ipfs://', '');
  const optimizedUrl = `${gateway}/ipfs/${hash}`;

  // Verify gateway is working (if not in retry mode)
  if (!skipRetry) {
    try {
      const response = await fetch(optimizedUrl, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        console.warn(`⚠️ Cached gateway failed (${response.status}), re-racing...`);
        // Force re-test and retry
        await retestGateways();
        return ipfsToHttpOptimized(ipfsUri, true); // Retry with new gateway
      }
    } catch (error) {
      console.warn(`⚠️ Cached gateway error, re-racing...`, error);
      // Force re-test and retry
      await retestGateways();
      return ipfsToHttpOptimized(ipfsUri, true); // Retry with new gateway
    }
  }

  // Return gateway URL
  return optimizedUrl;
}

/**
 * Check if string is valid IPFS hash
 * @param str - String to check
 * @returns true if valid IPFS hash
 */
export function isValidIpfsHash(str: string): boolean {
  if (!str) return false;

  // Remove ipfs:// prefix if present
  const hash = str.replace('ipfs://', '');

  // Check if starts with Qm (CIDv0) or b (CIDv1)
  return hash.startsWith('Qm') || hash.startsWith('b');
}

/**
 * Get multiple IPFS gateways for fallback
 * @returns Array of gateway URLs
 */
export function getIpfsGateways(): string[] {
  return [...IPFS_GATEWAYS];
}

/**
 * Convert IPFS URI to HTTP URL with fallback gateways
 * @param ipfsUri - IPFS URI
 * @returns Array of HTTP URLs (primary + fallbacks)
 */
export function ipfsToHttpWithFallbacks(ipfsUri: string | null | undefined): string[] {
  if (!ipfsUri) return [];

  const gateways = getIpfsGateways();
  return gateways.map(gateway => ipfsToHttp(ipfsUri, gateway)).filter(Boolean) as string[];
}

/**
 * Fetch image with automatic fallback to other gateways
 * Includes auto-retry with gateway re-racing if cached gateway fails
 * @param ipfsUri - IPFS URI
 * @param onProgress - Optional callback for progress updates
 * @returns Promise<string> - Working HTTP URL
 */
export async function fetchIpfsImageWithFallback(
  ipfsUri: string | null | undefined,
  onProgress?: (gateway: string, attempt: number) => void
): Promise<string | null> {
  if (!ipfsUri) return null;

  // If already HTTP URL, verify it works
  if (ipfsUri.startsWith('http://') || ipfsUri.startsWith('https://')) {
    try {
      const response = await fetch(ipfsUri, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        return ipfsUri;
      }
    } catch (e) {
      console.warn(`⚠️ Provided URL failed, trying IPFS gateways...`);
      // Extract hash and try gateways
      const hash = extractIpfsHash(ipfsUri);
      if (!hash) return ipfsUri; // Can't extract hash, return original
      // Continue with gateway fallback using extracted hash
      ipfsUri = `ipfs://${hash}`;
    }
  }

  const hash = ipfsUri.replace('ipfs://', '');

  // Try fastest gateway first
  onProgress?.('cached-fastest', 1);
  const fastestGateway = await getFastestGateway();
  const primaryUrl = `${fastestGateway}/ipfs/${hash}`;

  try {
    const response = await fetch(primaryUrl, { 
      method: 'HEAD',
      signal: AbortSignal.timeout(5000)
    });
    if (response.ok) {
      console.log(`✅ Primary gateway success: ${fastestGateway}`);
      return primaryUrl;
    }
  } catch (e) {
    console.warn(`⚠️ Primary gateway failed: ${fastestGateway}, trying fallbacks...`);
  }

  // Fallback to other gateways
  const gateways = IPFS_GATEWAYS.filter(g => g !== fastestGateway);
  for (let i = 0; i < gateways.length; i++) {
    const gateway = gateways[i];
    const url = `${gateway}/ipfs/${hash}`;

    onProgress?.(gateway, i + 2);

    try {
      const response = await fetch(url, { 
        method: 'HEAD',
        signal: AbortSignal.timeout(5000)
      });
      if (response.ok) {
        console.log(`✅ Fallback successful: ${gateway}`);
        
        // Update cached gateway to this working one
        cachedFastestGateway = gateway;
        if (typeof global !== 'undefined') {
          (global as any).__ipfs_gateway_cache = {
            gateway,
            timestamp: Date.now(),
          };
        }
        
        return url;
      }
    } catch (e) {
      // Continue to next gateway
    }
  }

  // If all failed, force re-race and try one more time
  console.warn(`⚠️ All gateways failed, forcing re-race...`);
  await retestGateways();
  
  const newGateway = await getFastestGateway();
  const finalUrl = `${newGateway}/ipfs/${hash}`;
  
  console.log(`🔄 Trying newly raced gateway: ${newGateway}`);
  
  // Return final URL (let caller handle if it fails)
  return finalUrl;
}

/**
 * Fetch IPFS content with smart retry logic
 * Automatically re-races gateways if cached gateway fails
 * @param ipfsUri - IPFS URI
 * @param options - Fetch options
 * @returns Promise<Response> - Fetch response
 */
export async function fetchIpfsWithSmartRetry(
  ipfsUri: string | null | undefined,
  options?: RequestInit
): Promise<Response | null> {
  if (!ipfsUri) return null;

  // Convert to HTTP URL with fastest gateway
  let url = await ipfsToHttpOptimized(ipfsUri);
  if (!url) return null;

  try {
    // Try with fastest gateway
    const response = await fetch(url, {
      ...options,
      signal: options?.signal || AbortSignal.timeout(10000),
    });

    if (response.ok) {
      return response;
    }

    console.warn(`⚠️ Gateway returned ${response.status}, trying fallback...`);
  } catch (error) {
    console.warn(`⚠️ Gateway fetch error:`, error);
  }

  // If failed, try with fallback
  const workingUrl = await fetchIpfsImageWithFallback(ipfsUri);
  if (!workingUrl) return null;

  // Retry with working URL
  try {
    const response = await fetch(workingUrl, {
      ...options,
      signal: options?.signal || AbortSignal.timeout(10000),
    });
    return response;
  } catch (error) {
    console.error(`❌ All IPFS fetch attempts failed:`, error);
    return null;
  }
}

// ============================================================================
// BACKWARD COMPATIBILITY FUNCTIONS
// Keep existing function names for backward compatibility
// ============================================================================

/**
 * Convert IPFS URL to HTTP gateway URL
 * @deprecated Use ipfsToHttp instead
 */
export function convertIpfsToHttp(url: string | null | undefined): string | null {
  return ipfsToHttp(url);
}

/**
 * Convert IPFS URL to HTTP gateway URL (non-null version)
 * @deprecated Use ipfsToHttp instead
 */
export function convertIpfsToHttpStrict(url: string): string {
  return ipfsToHttp(url) || url;
}

/**
 * Convert IPFS URL to alternative gateway (Cloudflare)
 * @deprecated Use ipfsToHttp with specific gateway instead
 */
export function convertIpfsToCloudflare(url: string): string {
  const hash = extractIpfsHash(url);
  if (!hash) return url;
  return `https://cloudflare-ipfs.com/ipfs/${hash}`;
}

/**
 * Convert IPFS URL to ipfs.io gateway
 * @deprecated Use ipfsToHttp with specific gateway instead
 */
export function convertIpfsToIpfsIo(url: string): string {
  const hash = extractIpfsHash(url);
  if (!hash) return url;
  return `https://ipfs.io/ipfs/${hash}`;
}

/**
 * Get the Pinata gateway URL
 * @deprecated Use getFastestGateway instead
 */
export function getPinataGateway(): string {
  return 'https://gateway.pinata.cloud/ipfs/';
}

/**
 * Get the Cloudflare gateway URL
 * @deprecated Use getFastestGateway instead
 */
export function getCloudflareGateway(): string {
  return 'https://cloudflare-ipfs.com/ipfs/';
}

/**
 * Get the ipfs.io gateway URL
 * @deprecated Use getFastestGateway instead
 */
export function getIpfsIoGateway(): string {
  return 'https://ipfs.io/ipfs/';
}

/**
 * Fetch a JSON document from an ipfs:// URI (or IPFS gateway / plain HTTP URL)
 * with gateway fallback.
 *
 * The "fastest gateway" race picks whichever gateway answers a probe first,
 * but some of those refuse real content (403/429). This tries, in order:
 * the raced gateway, the project's own Pinata gateway (PINATA_GATEWAY_URL),
 * then a list of reliable public gateways, and returns the first valid JSON.
 */
const FALLBACK_JSON_GATEWAYS = [
  'https://eu.orbitor.dev',
  'https://ipfs.orbitor.dev',
  'https://gateway.pinata.cloud',
  'https://w3s.link',
  'https://nftstorage.link',
  'https://ipfs.filebase.io',
  'https://ipfs.io',
  'https://dweb.link',
];

export async function fetchIpfsJson<T = any>(uri: string, timeoutMs: number = 8000): Promise<T | null> {
  if (!uri) return null;

  const candidates: string[] = [];
  const hash = uri.startsWith('ipfs://')
    ? uri.slice('ipfs://'.length).replace(/^ipfs\//, '')
    : isIpfsGatewayUrl(uri)
      ? extractIpfsHash(uri)
      : null;

  if (hash) {
    try {
      const fastest = await ipfsToHttpOptimized(`ipfs://${hash}`, true);
      if (fastest) candidates.push(fastest);
    } catch {
      // ignore, fall back below
    }
    const own = process.env.PINATA_GATEWAY_URL;
    if (own) {
      const base = own.startsWith('http') ? own : `https://${own}`;
      candidates.push(`${base.replace(/\/+$/, '').replace(/\/ipfs$/, '')}/ipfs/${hash}`);
    }
    for (const g of FALLBACK_JSON_GATEWAYS) candidates.push(`${g}/ipfs/${hash}`);
  } else {
    candidates.push(uri);
  }

  let lastError = '';
  for (const url of Array.from(new Set(candidates))) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastError = `HTTP ${res.status} from ${new URL(url).host}`;
        continue;
      }
      const text = await res.text();
      return JSON.parse(text) as T;
    } catch (error) {
      lastError = `${new URL(url).host}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  console.warn(`⚠️ fetchIpfsJson: all gateways failed for ${uri} (${lastError})`);
  return null;
}
