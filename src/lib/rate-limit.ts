/**
 * A small fixed-window rate limiter for the endpoints that take unauthenticated
 * input: the kiosk check-in routes and the login action.
 *
 * Better Auth rate-limits its own HTTP endpoints, but only those, and only when
 * they are reached over HTTP — a server action that calls `auth.api.*` directly
 * skips that pipeline. Everything else here has no limiter at all. This covers
 * both.
 *
 * Scope, stated plainly so it isn't mistaken for more than it is:
 *
 *   - **In memory, per process.** Counters are not shared between instances and
 *     do not survive a restart or a dev-server reload. For a single-site VMS on
 *     one node that is the whole population; behind a load balancer it becomes
 *     approximate, and the limits would need to move to Postgres or Redis.
 *   - **Not a defence against a determined attacker on the LAN**, who can
 *     spoof `x-forwarded-for`. It is there to stop a script from walking the
 *     appointment reference space or grinding passwords at machine speed.
 */
import "server-only";

export type RateLimitRule = {
  /** Window length in seconds. */
  window: number;
  /** How many requests one key may make inside the window. */
  max: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the current window closes. Suitable for `Retry-After`. */
  retryAfter: number;
};

type Bucket = {
  count: number;
  /** Epoch ms at which this window ends and the count resets. */
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

/**
 * Drop windows that have already closed.
 *
 * Every distinct key allocates an entry, and the key includes a caller-supplied
 * IP, so without this a stream of forged addresses would grow the map without
 * bound. Sweeping on a size threshold keeps the common path — a handful of
 * kiosks and staff — free of per-request bookkeeping.
 */
function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

const PRUNE_THRESHOLD = 1000;

/**
 * Counts one request against `key` and says whether it may proceed.
 *
 * Fixed window rather than sliding: it is a few lines, and the failure mode —
 * up to 2x the limit across a window boundary — does not matter at these
 * thresholds, which are set to stop automation rather than to meter a quota.
 */
export function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
): RateLimitResult {
  const now = Date.now();

  if (buckets.size > PRUNE_THRESHOLD) {
    pruneExpired(now);
  }

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.window * 1000 });
    return { allowed: true, retryAfter: rule.window };
  }

  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  if (existing.count >= rule.max) {
    return { allowed: false, retryAfter };
  }

  existing.count += 1;
  return { allowed: true, retryAfter };
}

/**
 * Best-effort caller identity for a rate-limit key.
 *
 * `x-forwarded-for` is the first entry of the proxy chain; it is trivially
 * forged by anything talking to the server directly, which is why the limits
 * that use it are sized as a brake on automation rather than as an access
 * control. Requests with no forwarding header at all — a kiosk on the LAN
 * hitting the server directly — collapse onto one shared key, so per-IP limits
 * must stay generous enough for the busiest single terminal.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");

  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Clears every window. Exists so a test can start from a known state. */
export function resetRateLimits(): void {
  buckets.clear();
}
