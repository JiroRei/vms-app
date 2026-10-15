/**
 * The pure pass-token module. No database and no app imports, so this runs on
 * its own — `npm run test:pass-token` — and travels with `pass-token.ts`.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isPassToken,
  parsePassToken,
  PASS_TOKEN_PREFIX,
  renderPassQrDataUrl,
  signPassToken,
  verifyPassToken,
} from "../src/lib/pass-token";

const SECRET = "test-secret-0123456789-abcdefghijklmnop"; // dummy, ≥ 32 chars
const OTHER_SECRET = "another-secret-0123456789-abcdefghijklm";
const PASS_ID = "cmabc123def456ghi789jkl0";

function token(version = 1, secret = SECRET, passId = PASS_ID) {
  return signPassToken({ passId, version, secret });
}

/** Replaces one character of `value` at `index` with a different one. */
function flip(value: string, index: number): string {
  const replacement = value[index] === "A" ? "B" : "A";
  return value.slice(0, index) + replacement + value.slice(index + 1);
}

describe("round trip", () => {
  test("a signed token verifies and yields its pass id", () => {
    const t = token(3);
    assert.deepEqual(verifyPassToken(t, SECRET, 3), { ok: true, passId: PASS_ID });
  });

  test("format is vp1.<passId>.<43-char base64url mac>", () => {
    const [prefix, passId, mac] = token().split(".");
    assert.equal(prefix, PASS_TOKEN_PREFIX);
    assert.equal(passId, PASS_ID);
    assert.match(mac, /^[A-Za-z0-9_-]{43}$/);
  });

  test("signing is deterministic, so the QR can be re-rendered identically", async () => {
    assert.equal(token(2), token(2));
    assert.equal(await renderPassQrDataUrl(token(2)), await renderPassQrDataUrl(token(2)));
  });

  test("parse returns the id and mac without checking them", () => {
    const t = token();
    assert.deepEqual(parsePassToken(t), { passId: PASS_ID, mac: t.split(".")[2] });
  });

  test("surrounding whitespace from a scanner is tolerated", () => {
    assert.equal(verifyPassToken(`  ${token()}\n`, SECRET, 1).ok, true);
  });
});

describe("rejections", () => {
  test("tampered pass id", () => {
    const [prefix, passId, mac] = token().split(".");
    const forged = `${prefix}.${flip(passId, 0)}.${mac}`;
    assert.deepEqual(verifyPassToken(forged, SECRET, 1), { ok: false, reason: "BAD_MAC" });
  });

  test("tampered mac", () => {
    const [prefix, passId, mac] = token().split(".");
    for (const index of [0, 21, 42]) {
      const forged = `${prefix}.${passId}.${flip(mac, index)}`;
      assert.deepEqual(verifyPassToken(forged, SECRET, 1), { ok: false, reason: "BAD_MAC" });
    }
  });

  test("wrong secret", () => {
    assert.deepEqual(verifyPassToken(token(1, OTHER_SECRET), SECRET, 1), {
      ok: false,
      reason: "BAD_MAC",
    });
  });

  test("wrong version — a rotated pass's old token", () => {
    const old = token(1);
    assert.deepEqual(verifyPassToken(old, SECRET, 2), { ok: false, reason: "BAD_MAC" });
    assert.notEqual(old, token(2));
  });

  test("nonsense versions never verify", () => {
    for (const version of [0, -1, 1.5, Number.NaN]) {
      assert.equal(verifyPassToken(token(1), SECRET, version).ok, false);
    }
  });

  test("malformed or empty input", () => {
    const [, passId, mac] = token().split(".");
    const cases = [
      "",
      "   ",
      "vp1",
      "vp1.",
      "vp1..",
      `vp2.${passId}.${mac}`,
      `VP1.${passId}.${mac}`,
      `vp1.${passId}`,
      `vp1.${passId}.${mac}.extra`,
      `vp1.${passId}.${mac.slice(0, 42)}`,
      `vp1.${passId}.${mac}=`,
      `vp1.short.${mac}`,
      `vp1.${passId}.${mac.replace(/./, "+")}`,
      `vp1.${"x".repeat(300)}.${mac}`,
      "APT-ABC123",
      "3f0c1e2a-1111-4222-8333-944455556666",
    ];

    for (const value of cases) {
      assert.equal(parsePassToken(value), null, `parse should reject ${JSON.stringify(value)}`);
      assert.deepEqual(
        verifyPassToken(value, SECRET, 1),
        { ok: false, reason: "MALFORMED" },
        `verify should reject ${JSON.stringify(value)}`,
      );
    }
  });

  test("non-string input is malformed, not a crash", () => {
    for (const value of [null, undefined, 42, {}] as unknown as string[]) {
      assert.equal(parsePassToken(value), null);
      assert.equal(verifyPassToken(value, SECRET, 1).ok, false);
    }
  });
});

describe("guards", () => {
  test("a short secret is refused when signing and verifying", () => {
    assert.throws(() => signPassToken({ passId: PASS_ID, version: 1, secret: "short" }));
    assert.throws(() => verifyPassToken(token(), "short", 1));
  });

  test("bad ids and versions are refused when signing", () => {
    assert.throws(() => signPassToken({ passId: "has.dot.in.it", version: 1, secret: SECRET }));
    assert.throws(() => signPassToken({ passId: "tiny", version: 1, secret: SECRET }));
    assert.throws(() => signPassToken({ passId: PASS_ID, version: 0, secret: SECRET }));
  });

  test("isPassToken tells a pass from an appointment code", () => {
    assert.equal(isPassToken(token()), true);
    assert.equal(isPassToken("APT-ABC123"), false);
    assert.equal(isPassToken("3f0c1e2a-1111-4222-8333-944455556666"), false);
  });
});
