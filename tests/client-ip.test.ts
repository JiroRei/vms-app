/**
 * Caller identification for rate limits (KNOWN_ISSUES M-01): a client must not
 * be able to pick its own rate-limit key by sending X-Forwarded-For.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { CONNECTION_HEADER, connectionAddress, getClientIp, trustedProxyCount, UNKNOWN_CLIENT } from "@/lib/client-ip";
import { consumeRateLimit, resetRateLimits } from "@/lib/rate-limit";

const NONCE = "test-nonce";
const env = (extra: Record<string, string> = {}) => ({ VMS_CONNECTION_NONCE: NONCE, ...extra });
/** A request as server.mjs hands it to Next.js: stamped with the socket address. */
const fromSocket = (address: string, extra: Record<string, string> = {}) =>
  new Headers({ [CONNECTION_HEADER]: `${NONCE} ${address}`, ...extra });

beforeEach(resetRateLimits);

describe("TRUSTED_PROXY_COUNT = 0 (default)", () => {
  test("uses the connection address and ignores forwarding headers", () => {
    const headers = fromSocket("192.0.2.10", { "x-forwarded-for": "203.0.113.7", "x-real-ip": "203.0.113.8" });
    assert.equal(getClientIp(headers, env()), "192.0.2.10");
  });

  test("IPv4-mapped IPv6 is the same caller as plain IPv4", () => {
    assert.equal(getClientIp(fromSocket("::ffff:192.0.2.10"), env()), "192.0.2.10");
  });

  test("a forged connection stamp (wrong or missing nonce) is ignored", () => {
    assert.equal(connectionAddress(new Headers({ [CONNECTION_HEADER]: "guess 203.0.113.7" }), env()), null);
    assert.equal(connectionAddress(fromSocket("192.0.2.10"), {}), null);
    assert.equal(getClientIp(new Headers({ [CONNECTION_HEADER]: "guess 203.0.113.7", "x-forwarded-for": "203.0.113.7" }), env()), UNKNOWN_CLIENT);
  });

  test("rotating X-Forwarded-For no longer escapes the limit", () => {
    const rule = { window: 60, max: 30 };
    const results = Array.from({ length: 40 }, (_, i) => {
      const headers = fromSocket("192.0.2.10", { "x-forwarded-for": `198.51.100.${i}` });
      return consumeRateLimit(`appointment-lookup:${getClientIp(headers, env())}`, rule).allowed;
    });
    assert.equal(results.filter(Boolean).length, 30);
    assert.equal(results.filter((allowed) => !allowed).length, 10);
  });

  test("without the custom server every caller shares one key, so rotation still does not help", () => {
    const keys = new Set(Array.from({ length: 5 }, (_, i) => getClientIp(new Headers({ "x-forwarded-for": `198.51.100.${i}` }), {})));
    assert.deepEqual([...keys], [UNKNOWN_CLIENT]);
  });
});

describe("TRUSTED_PROXY_COUNT = N", () => {
  test("takes the Nth entry from the right; client-supplied entries on the left are ignored", () => {
    // Client sent "1.1.1.1"; proxy 1 appended the client's real address;
    // proxy 2 appended proxy 1's address.
    const headers = fromSocket("10.0.0.3", { "x-forwarded-for": "1.1.1.1, 203.0.113.7, 10.0.0.2" });
    assert.equal(getClientIp(headers, env({ TRUSTED_PROXY_COUNT: "2" })), "203.0.113.7");
    assert.equal(getClientIp(headers, env({ TRUSTED_PROXY_COUNT: "1" })), "10.0.0.2");
  });

  test("rotating the client-supplied part does not change the key", () => {
    const keys = new Set(Array.from({ length: 5 }, (_, i) =>
      getClientIp(fromSocket("10.0.0.2", { "x-forwarded-for": `198.51.100.${i}, 203.0.113.7` }), env({ TRUSTED_PROXY_COUNT: "1" }))));
    assert.deepEqual([...keys], ["203.0.113.7"]);
  });

  test("a chain shorter than the proxy count falls back to the connection address", () => {
    const headers = fromSocket("192.0.2.10", { "x-forwarded-for": "203.0.113.7" });
    assert.equal(getClientIp(headers, env({ TRUSTED_PROXY_COUNT: "2" })), "192.0.2.10");
  });

  test("rejects a malformed setting rather than guessing", () => {
    assert.equal(trustedProxyCount({}), 0);
    assert.equal(trustedProxyCount({ TRUSTED_PROXY_COUNT: " 1 " }), 1);
    assert.throws(() => trustedProxyCount({ TRUSTED_PROXY_COUNT: "-1" }), /TRUSTED_PROXY_COUNT/);
    assert.throws(() => trustedProxyCount({ TRUSTED_PROXY_COUNT: "two" }), /TRUSTED_PROXY_COUNT/);
  });
});
