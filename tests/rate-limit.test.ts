/**
 * The rate limiter and the date formatters — the two pure modules, so these
 * need no database.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import {
  EMPTY_VALUE,
  formatDateTime,
  formatDuration,
  formatTime,
} from "@/lib/dates";
import {
  clientIp,
  consumeRateLimit,
  resetRateLimits,
} from "@/lib/rate-limit";

beforeEach(resetRateLimits);

describe("rate limiting", () => {
  test("allows exactly `max` requests, then refuses", () => {
    const rule = { window: 60, max: 3 };

    for (let i = 0; i < 3; i += 1) {
      assert.equal(
        consumeRateLimit("key", rule).allowed,
        true,
        `request ${i + 1} of 3 should be allowed`,
      );
    }

    const refused = consumeRateLimit("key", rule);
    assert.equal(refused.allowed, false);
    assert.ok(
      refused.retryAfter > 0 && refused.retryAfter <= 60,
      "a refusal has to say how long to wait",
    );
  });

  test("keys do not share a budget", () => {
    const rule = { window: 60, max: 1 };

    assert.equal(consumeRateLimit("kiosk-a", rule).allowed, true);
    assert.equal(
      consumeRateLimit("kiosk-b", rule).allowed,
      true,
      "one busy terminal must not lock out another",
    );
    assert.equal(consumeRateLimit("kiosk-a", rule).allowed, false);
  });

  test("a refused request does not extend the window", () => {
    const rule = { window: 60, max: 1 };

    consumeRateLimit("key", rule);
    const first = consumeRateLimit("key", rule).retryAfter;
    const second = consumeRateLimit("key", rule).retryAfter;

    assert.ok(
      second <= first,
      "hammering the door must not push the reopening further away",
    );
  });

  test("the window reopens once it has elapsed", () => {
    // A zero-length window closes immediately, which is the same code path a
    // real window takes when it expires — without making the test wait.
    const rule = { window: 0, max: 1 };

    assert.equal(consumeRateLimit("key", rule).allowed, true);
    assert.equal(consumeRateLimit("key", rule).allowed, true);
  });
});

describe("identifying the caller", () => {
  test("takes the first hop of x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 198.51.100.1",
    });

    assert.equal(clientIp(headers), "203.0.113.7");
  });

  test("falls back to x-real-ip, then to a shared key", () => {
    assert.equal(clientIp(new Headers({ "x-real-ip": "203.0.113.9" })), "203.0.113.9");
    assert.equal(clientIp(new Headers()), "unknown");
  });
});

describe("formatting", () => {
  test("missing and unparseable values render as a dash, never Invalid Date", () => {
    assert.equal(formatTime(null), EMPTY_VALUE);
    assert.equal(formatTime(undefined), EMPTY_VALUE);
    assert.equal(formatDateTime("not a date"), EMPTY_VALUE);
    assert.equal(formatDuration(null, null), EMPTY_VALUE);
  });

  test("a duration reads in hours and minutes", () => {
    const from = "2026-09-22T09:00:00.000Z";
    const to = "2026-09-22T11:15:00.000Z";

    assert.equal(formatDuration(from, to), "2h 15m");
  });

  test("a sub-hour duration omits the hours", () => {
    const from = "2026-09-22T09:00:00.000Z";
    const to = "2026-09-22T09:20:00.000Z";

    assert.match(formatDuration(from, to), /^20m$/);
  });
});
