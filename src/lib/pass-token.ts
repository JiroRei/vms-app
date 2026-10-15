/**
 * Pass tokens: a signed, re-derivable credential for one pass record.
 *
 * PORTABLE MODULE. It imports only `node:crypto` and the `qrcode` package —
 * nothing from Prisma, Next.js or this app — so another project can copy this
 * file unchanged. Everything that touches a database lives in the caller (here,
 * `src/lib/visitor-pass.ts`). See docs/visitor-pass.md.
 *
 * Format:   vp1.<passId>.<mac>
 *   mac  =  base64url( HMAC-SHA256( secret, "vp1." + passId + "." + version ) )
 *
 * The token is never stored. Given the pass id, its current version and the
 * secret, the same token is recomputed byte for byte, so the QR can be
 * re-rendered at any time. Bumping the version changes the mac, which kills
 * every token issued for an earlier version.
 *
 * The version is deliberately *not* in the token: a holder cannot ask for an
 * old version to be checked. The verifier looks the version up by pass id and
 * passes it to `verifyPassToken()`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import QRCode from "qrcode";

/** Every token starts with this. Also how a scanner tells a pass from other QR content. */
export const PASS_TOKEN_PREFIX = "vp1";

/** Pass ids this module accepts: cuid/uuid-like, URL- and QR-safe. */
const PASS_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** A SHA-256 mac is 32 bytes, which is 43 base64url characters without padding. */
const MAC_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Secrets shorter than this are refused rather than silently used. */
const MIN_SECRET_LENGTH = 32;

/** The longest string worth parsing; anything bigger is not a token. */
const MAX_TOKEN_LENGTH = 200;

export type PassTokenInput = {
  passId: string;
  /** A positive integer, bumped to invalidate earlier tokens. */
  version: number;
  secret: string;
};

export type ParsedPassToken = { passId: string; mac: string };

export type PassTokenVerification =
  | { ok: true; passId: string }
  | { ok: false; reason: "MALFORMED" | "BAD_MAC" };

function assertSecret(secret: string): void {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `Pass secret must be a string of at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
}

function assertVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Pass version must be a positive integer.");
  }
}

function computeMac(passId: string, version: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${PASS_TOKEN_PREFIX}.${passId}.${version}`)
    .digest("base64url");
}

/** True if `value` looks like it was meant to be a pass (prefix only — not a validity check). */
export function isPassToken(value: string): boolean {
  return typeof value === "string" && value.trim().startsWith(`${PASS_TOKEN_PREFIX}.`);
}

/** The token for a pass id at a version. Deterministic: same inputs, same token. */
export function signPassToken({ passId, version, secret }: PassTokenInput): string {
  assertSecret(secret);
  assertVersion(version);

  if (!PASS_ID_PATTERN.test(passId)) {
    throw new Error("Pass id must be 8–64 characters of [A-Za-z0-9_-].");
  }

  return `${PASS_TOKEN_PREFIX}.${passId}.${computeMac(passId, version, secret)}`;
}

/**
 * Splits a token into its pass id and mac, checking only the shape. Says
 * nothing about authenticity — use `verifyPassToken()` for that. Null for
 * anything that is not exactly `vp1.<passId>.<mac>`.
 */
export function parsePassToken(token: string): ParsedPassToken | null {
  if (typeof token !== "string") return null;

  const trimmed = token.trim();
  if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) return null;

  const parts = trimmed.split(".");
  if (parts.length !== 3) return null;

  const [prefix, passId, mac] = parts;
  if (prefix !== PASS_TOKEN_PREFIX) return null;
  if (!PASS_ID_PATTERN.test(passId) || !MAC_PATTERN.test(mac)) return null;

  return { passId, mac };
}

/**
 * Checks a token's mac for the given version, in constant time.
 *
 * The caller supplies `version` — the pass's *current* version from its own
 * records, looked up by the id `parsePassToken()` returned. A token minted for
 * any other version (a rotated pass) fails here as BAD_MAC, exactly like a
 * forged one.
 */
export function verifyPassToken(
  token: string,
  secret: string,
  version: number,
): PassTokenVerification {
  assertSecret(secret);

  const parsed = parsePassToken(token);
  if (!parsed) return { ok: false, reason: "MALFORMED" };

  if (!Number.isSafeInteger(version) || version < 1) {
    return { ok: false, reason: "BAD_MAC" };
  }

  const expected = Buffer.from(computeMac(parsed.passId, version, secret));
  const actual = Buffer.from(parsed.mac);

  // Lengths are equal by construction (MAC_PATTERN), so timingSafeEqual cannot
  // throw; the explicit check keeps that true if the pattern ever changes.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "BAD_MAC" };
  }

  return { ok: true, passId: parsed.passId };
}

const QR_OPTIONS = {
  // Short payload, so the densest error correction is affordable: tolerant of
  // a cracked phone screen or a creased printout.
  errorCorrectionLevel: "H",
  margin: 2,
  width: 320,
} as const;

/** The token as a QR code PNG, e.g. for an inline email attachment. */
export function renderPassQrPng(token: string): Promise<Buffer> {
  return QRCode.toBuffer(token, { type: "png", ...QR_OPTIONS });
}

/** The token as a QR code `data:image/png` URL, e.g. for an `<img>` or a download link. */
export function renderPassQrDataUrl(token: string): Promise<string> {
  return QRCode.toDataURL(token, QR_OPTIONS);
}
