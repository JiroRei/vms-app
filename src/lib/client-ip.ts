/**
 * The caller's IP address, for rate limiting. The one place that decides it:
 * every limiter, the login action, the kiosk heartbeat and Better Auth's own
 * limiter (through `x-vms-client-ip`, set in `src/app/api/auth/[...all]`) use
 * this, so they cannot disagree about who a caller is.
 *
 * `X-Forwarded-For` is only as trustworthy as the proxies that wrote it. A
 * client can send any value it likes, so reading the first entry (as this app
 * did; KNOWN_ISSUES M-01) let a script rotate the header and never be limited.
 *
 * `TRUSTED_PROXY_COUNT` says how many reverse proxies this deployment runs
 * behind:
 *
 * - `0` (the default): forwarding headers are ignored entirely and the TCP
 *   connection's address is used.
 * - `N`: each trusted proxy appends the address it received the request from,
 *   so the client is the Nth entry counted from the right. Anything to the left
 *   of that was supplied by the client and is ignored.
 *
 * The connection address comes from `server.mjs`, which stamps every request
 * with it before Next.js sees the request (Next.js does not expose the socket
 * to route handlers). The stamp carries a per-process nonce, so a client
 * cannot forge it, and a server started some other way (plain `next start`)
 * falls back to one shared "unknown" key: coarser limits, never bypassable
 * ones.
 */
import "server-only";

/** Set by `server.mjs` on every request; never trust a value without the nonce. */
export const CONNECTION_HEADER = "x-vms-connection";
/** Set on requests handed to Better Auth, whose limiter reads it. */
export const CLIENT_IP_HEADER = "x-vms-client-ip";

export const UNKNOWN_CLIENT = "unknown";

let warnedNoConnection = false;

export function trustedProxyCount(env: Record<string, string | undefined> = process.env): number {
  const raw = env.TRUSTED_PROXY_COUNT?.trim();
  if (!raw) return 0;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 0 || count > 10) {
    throw new Error(`TRUSTED_PROXY_COUNT must be a whole number from 0 to 10 (got "${raw}").`);
  }
  return count;
}

/** The socket address `server.mjs` recorded, or null if it is missing or forged. */
export function connectionAddress(headers: Headers, env: Record<string, string | undefined> = process.env): string | null {
  const nonce = env.VMS_CONNECTION_NONCE;
  const value = headers.get(CONNECTION_HEADER);
  if (!nonce || !value) return null;
  const space = value.indexOf(" ");
  if (space < 0 || value.slice(0, space) !== nonce) return null;
  return normalizeAddress(value.slice(space + 1)) || null;
}

/** "::ffff:192.0.2.1" and "192.0.2.1" are the same caller. */
function normalizeAddress(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("::ffff:") && trimmed.includes(".") ? trimmed.slice(7) : trimmed;
}

export function getClientIp(headers: Headers, env: Record<string, string | undefined> = process.env): string {
  const hops = trustedProxyCount(env);
  const connection = connectionAddress(headers, env);

  if (hops > 0) {
    const chain = (headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    // Fewer entries than trusted proxies means the request did not come
    // through all of them, so nothing in the header can be trusted.
    if (chain.length >= hops) return normalizeAddress(chain[chain.length - hops]);
  }

  if (connection) return connection;

  if (!warnedNoConnection && env.NODE_ENV === "production") {
    warnedNoConnection = true;
    console.warn(JSON.stringify({ level: "warn", message: "Client address unavailable: start the app with `node server.mjs` (or set TRUSTED_PROXY_COUNT behind a proxy). Rate limits fall back to one shared key.", time: new Date().toISOString() }));
  }
  return UNKNOWN_CLIENT;
}
