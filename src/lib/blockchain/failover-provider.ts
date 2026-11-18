/**
 * FailoverJsonRpcProvider
 *
 * A JsonRpcProvider that spreads one logical connection over several RPC
 * endpoints. Every JSON-RPC request (including the ones made by Contract
 * instances bound to this provider) goes through `_send`, which:
 *
 *   - sticks to the highest-priority healthy endpoint,
 *   - fails over to the next endpoint on transport errors, HTTP 429/5xx,
 *     timeouts and provider-side errors (rate limits, range limits, ...),
 *   - puts a failing endpoint on an exponential cooldown,
 *   - periodically probes every endpoint and benches the ones that lag
 *     behind the best known head (a lagging node silently returns empty
 *     eth_getLogs results, which would make the listener miss events).
 *
 * Contract reverts and other caller errors are returned as-is (no failover).
 */

import { ethers, FetchRequest } from 'ethers';

export interface FailoverProviderOptions {
  /** Per-request timeout in ms (default 15s) */
  requestTimeoutMs?: number;
  /** How often to probe endpoint heads in ms (default 60s, 0 disables) */
  healthCheckIntervalMs?: number;
  /** Endpoints more than this many blocks behind the best head are benched (default 30) */
  maxLagBlocks?: number;
}

interface EndpointState {
  url: string;
  label: string;
  failures: number;
  cooldownUntil: number;
  lastError?: string;
  lastHead?: number;
  lastLatencyMs?: number;
  lagging: boolean;
}

const BASE_COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

/** Errors returned inside a JSON-RPC response that mean "this endpoint can't serve it right now". */
const RETRYABLE_RPC_ERROR =
  /rate|limit|too many|timeout|timed out|unavailable|overload|capacity|busy|header not found|unknown block|block range|range|exceed|internal error|upstream|gateway|try again|not supported on free|sign up|quota/i;

function redact(url: string): string {
  try {
    const u = new URL(url);
    // Hide paths/query strings that may carry API keys
    return `${u.protocol}//${u.host}${u.pathname.length > 1 ? '/…' : ''}`;
  } catch {
    return 'invalid-url';
  }
}

/** Normalises a list of RPC URLs: trims, drops empties/duplicates, converts ws(s) to http(s). */
export function normalizeRpcUrls(urls: string[]): string[] {
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw.trim().replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

export class FailoverJsonRpcProvider extends ethers.JsonRpcProvider {
  private readonly endpoints: EndpointState[];
  private readonly requestTimeoutMs: number;
  private readonly maxLagBlocks: number;
  private healthTimer?: NodeJS.Timeout;
  private activeIndex = 0;
  private readonly chainIdNum: number;

  constructor(urls: string[], chainId: number, options: FailoverProviderOptions = {}) {
    const list = normalizeRpcUrls(urls);
    if (list.length === 0) {
      throw new Error(`No valid HTTP(S) RPC URL configured for chain ${chainId}`);
    }
    const network = ethers.Network.from(chainId);
    super(list[0], network, { staticNetwork: network, batchMaxCount: 20 });

    this.chainIdNum = chainId;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.maxLagBlocks = options.maxLagBlocks ?? 30;
    this.endpoints = list.map((url, i) => ({
      url,
      label: `#${i + 1} ${redact(url)}`,
      failures: 0,
      cooldownUntil: 0,
      lagging: false,
    }));

    const interval = options.healthCheckIntervalMs ?? 60_000;
    if (interval > 0 && this.endpoints.length > 1) {
      this.healthTimer = setInterval(() => {
        this.probeEndpoints().catch(() => undefined);
      }, interval);
      this.healthTimer.unref?.();
      // First probe shortly after start
      setTimeout(() => this.probeEndpoints().catch(() => undefined), 3_000).unref?.();
    }

    console.log(`🔀 Chain ${chainId}: RPC failover over ${this.endpoints.length} endpoint(s): ${this.endpoints.map(e => e.label).join(', ')}`);
  }

  /** Endpoint order to try for the next request: healthy ones by priority, then the rest. */
  private candidateOrder(): number[] {
    const now = Date.now();
    const healthy: number[] = [];
    const benched: number[] = [];
    this.endpoints.forEach((e, i) => {
      if (e.cooldownUntil <= now && !e.lagging) healthy.push(i);
      else benched.push(i);
    });
    // Sticky: keep using the active endpoint while it is healthy
    healthy.sort((a, b) => (a === this.activeIndex ? -1 : b === this.activeIndex ? 1 : a - b));
    // Benched endpoints are a last resort, soonest-available first
    benched.sort((a, b) => this.endpoints[a].cooldownUntil - this.endpoints[b].cooldownUntil);
    return [...healthy, ...benched];
  }

  private markFailure(index: number, reason: string): void {
    const e = this.endpoints[index];
    e.failures++;
    e.lastError = reason.slice(0, 200);
    const cooldown = Math.min(BASE_COOLDOWN_MS * 2 ** Math.min(e.failures - 1, 10), MAX_COOLDOWN_MS);
    e.cooldownUntil = Date.now() + cooldown;
    console.warn(`⚠️ Chain ${this.chainIdNum}: RPC ${e.label} failed (${e.lastError}); cooling down ${Math.round(cooldown / 1000)}s`);
  }

  private markSuccess(index: number, latencyMs: number): void {
    const e = this.endpoints[index];
    if (e.failures > 0) {
      console.log(`✅ Chain ${this.chainIdNum}: RPC ${e.label} recovered`);
    }
    e.failures = 0;
    e.cooldownUntil = 0;
    e.lastLatencyMs = latencyMs;
    if (this.activeIndex !== index) {
      console.log(`🔀 Chain ${this.chainIdNum}: now using RPC ${e.label}`);
      this.activeIndex = index;
    }
  }

  private async postTo(url: string, payload: unknown, timeoutMs: number): Promise<any> {
    const request = new FetchRequest(url);
    request.method = 'POST';
    request.body = JSON.stringify(payload);
    request.setHeader('content-type', 'application/json');
    request.timeout = timeoutMs;
    request.retryFunc = async () => false; // we do our own failover instead of ethers' 429 retry loop
    const response = await request.send();
    if (!response.ok()) {
      throw new Error(`HTTP ${response.statusCode}`);
    }
    return response.bodyJson;
  }

  /** Returns the first retryable JSON-RPC error message in a response, if any. */
  private retryableError(results: any[]): string | null {
    for (const r of results) {
      const err = r?.error;
      if (!err) continue;
      const msg = `${err.code ?? ''} ${err.message ?? ''}`;
      if (/revert/i.test(msg)) continue;
      if (RETRYABLE_RPC_ERROR.test(msg) || err.code === -32005 || err.code === -32603 || err.code === 429) {
        return msg.trim();
      }
    }
    return null;
  }

  async _send(payload: ethers.JsonRpcPayload | Array<ethers.JsonRpcPayload>): Promise<Array<ethers.JsonRpcResult>> {
    let lastError: unknown = null;

    for (const index of this.candidateOrder()) {
      const endpoint = this.endpoints[index];
      const started = Date.now();
      try {
        const body = await this.postTo(endpoint.url, payload, this.requestTimeoutMs);
        const results: any[] = Array.isArray(body) ? body : [body];
        if (results.length === 0 || results.some(r => r === null || typeof r !== 'object')) {
          throw new Error('malformed JSON-RPC response');
        }
        const retryable = this.retryableError(results);
        if (retryable) {
          throw new Error(retryable);
        }
        this.markSuccess(index, Date.now() - started);
        return results as ethers.JsonRpcResult[];
      } catch (error) {
        lastError = error;
        this.markFailure(index, error instanceof Error ? error.message : String(error));
      }
    }

    throw new Error(
      `All ${this.endpoints.length} RPC endpoint(s) failed for chain ${this.chainIdNum}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  /** Probes every endpoint's head and benches the ones that lag behind. */
  async probeEndpoints(): Promise<void> {
    const heads = await Promise.all(
      this.endpoints.map(async (e) => {
        const started = Date.now();
        try {
          const body = await this.postTo(e.url, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }, 8_000);
          const head = body?.result ? parseInt(body.result, 16) : NaN;
          if (!Number.isFinite(head)) throw new Error(body?.error?.message || 'no result');
          e.lastHead = head;
          e.lastLatencyMs = Date.now() - started;
          return head;
        } catch (error) {
          e.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 200);
          return null;
        }
      })
    );

    const best = Math.max(...heads.filter((h): h is number => h !== null));
    if (!Number.isFinite(best)) return;

    this.endpoints.forEach((e, i) => {
      const head = heads[i];
      const wasLagging = e.lagging;
      e.lagging = head !== null && best - head > this.maxLagBlocks;
      if (e.lagging && !wasLagging) {
        console.warn(`⚠️ Chain ${this.chainIdNum}: RPC ${e.label} is ${best - (head as number)} blocks behind, benched`);
      } else if (!e.lagging && wasLagging) {
        console.log(`✅ Chain ${this.chainIdNum}: RPC ${e.label} caught up`);
      }
      // A probe success clears an old cooldown so a recovered endpoint gets traffic again
      if (head !== null && e.cooldownUntil > Date.now() && e.failures > 0) {
        e.cooldownUntil = 0;
        e.failures = 0;
      }
    });
  }

  getEndpointStatus(): Array<{ endpoint: string; active: boolean; healthy: boolean; lagging: boolean; failures: number; lastHead?: number; lastLatencyMs?: number; lastError?: string }> {
    const now = Date.now();
    return this.endpoints.map((e, i) => ({
      endpoint: e.label,
      active: i === this.activeIndex,
      healthy: e.cooldownUntil <= now && !e.lagging,
      lagging: e.lagging,
      failures: e.failures,
      lastHead: e.lastHead,
      lastLatencyMs: e.lastLatencyMs,
      lastError: e.lastError,
    }));
  }

  destroy(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = undefined;
    }
    super.destroy();
  }
}
