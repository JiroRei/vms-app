import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { makeNameKey } from "@/lib/names";
import { prisma } from "@/lib/prisma";

/**
 * Returning-visitor verification for the public booking page.
 *
 * A visitor who says they have been here before gives their email and name and
 * gets a 6-digit code emailed to them; entering it proves they own the address,
 * and only then does the page reveal (and prefill) the stored profile. The
 * proof is carried to the booking request in a short-lived signed cookie.
 *
 * A profile is an email + name pair (`nameKey`, see `makeNameKey()`): several
 * people can share one address, so every step here (the code, the check, the
 * cookie) is bound to the exact pair, never to the email alone.
 *
 * Nothing in here may let a caller learn whether a profile exists without
 * owning the address: lookups always write a row (so the rate limit is
 * identical), and every verification failure reads the same.
 */

/** Codes are good for this long after they are issued. */
export const CODE_TTL_MS = 10 * 60 * 1000;

/** Wrong guesses allowed against one code before it is dead. */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * At most this many codes per email per `RATE_LIMIT_WINDOW_MS`. Counted per
 * email, not per name, so trying name after name at one address is limited too.
 */
export const MAX_CODES_PER_WINDOW = 3;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** How long the verified cookie lasts. */
export const VERIFIED_COOKIE_MAX_AGE_S = 30 * 60;
export const VERIFIED_COOKIE_NAME = "vms_booking_verified";

/** Verification rows older than this are pruned on the next lookup. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

function secret(): string {
  const value = process.env.BOOKING_VERIFY_SECRET;

  if (!value) {
    throw new Error(
      "BOOKING_VERIFY_SECRET is not set — see .env.example for how to generate one.",
    );
  }

  return value;
}

function hmac(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Profiles and verifications are keyed by this form of the address. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Keyed with the server secret rather than a plain hash: a 6-digit code has
 * only a million values, so an unkeyed hash in a leaked table is a lookup.
 * The email and name are mixed in so one code's hash is useless for any other
 * pair.
 */
function hashCode(email: string, nameKey: string, code: string): string {
  return hmac(`code:${email}:${nameKey}:${code}`);
}

/** Who a lookup or verification is for, as typed. */
export type ProfileIdentity = {
  email: string;
  firstName: string;
  lastName: string;
};

export type IssueCodeResult =
  | { status: "rate-limited" }
  | {
      status: "issued";
      /** Set only when a profile exists — the caller sends it. */
      delivery: { code: string; firstName: string } | null;
    };

/**
 * Records a code for this email + name and returns it for delivery if that
 * pair is a profile.
 *
 * A row is written either way. For an unknown pair the code is random, never
 * sent and never redeemable (verification also requires the profile), but
 * counting it means the rate limit triggers on the same request for every
 * address — otherwise a 429 on the fourth attempt would reveal that the first
 * three were real.
 */
export async function issueVerificationCode(
  identity: ProfileIdentity,
  now: Date = new Date(),
): Promise<IssueCodeResult> {
  const email = normalizeEmail(identity.email);
  const nameKey = makeNameKey(identity.firstName, identity.lastName);

  // Opportunistic cleanup keeps the table to roughly a day of lookups.
  await prisma.visitorVerification.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - RETENTION_MS) } },
  });

  const recent = await prisma.visitorVerification.count({
    where: {
      email,
      createdAt: { gte: new Date(now.getTime() - RATE_LIMIT_WINDOW_MS) },
    },
  });

  if (recent >= MAX_CODES_PER_WINDOW) {
    return { status: "rate-limited" };
  }

  const profile = await prisma.visitorProfile.findUnique({
    where: { email_nameKey: { email, nameKey } },
    select: { firstName: true },
  });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await prisma.visitorVerification.create({
    data: {
      email,
      nameKey,
      codeHash: hashCode(email, nameKey, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      createdAt: now,
    },
  });

  return {
    status: "issued",
    delivery: profile ? { code, firstName: profile.firstName } : null,
  };
}

export type VerifiedProfile = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  nameKey: string;
  phone: string | null;
};

const PROFILE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  nameKey: true,
  phone: true,
} as const;

/**
 * Checks `code` against the most recent code issued for this email + name.
 *
 * A code is only good for the exact pair it was requested for: the right code
 * with the same email but a different name fails. Only the latest code for the
 * pair counts, so requesting a new one retires the old. Every
 * attempt — right or wrong — spends one of the code's `MAX_CODE_ATTEMPTS`, and
 * both the spend and the consume are conditional updates, so two concurrent
 * submissions cannot both succeed or exceed the cap.
 *
 * Returns null for every kind of failure (no code, wrong code or name,
 * expired, used up, no profile). The caller shows one message for all of them.
 */
export async function verifyCode(
  identity: ProfileIdentity,
  code: string,
  now: Date = new Date(),
): Promise<VerifiedProfile | null> {
  const email = normalizeEmail(identity.email);
  const nameKey = makeNameKey(identity.firstName, identity.lastName);

  const latest = await prisma.visitorVerification.findFirst({
    where: { email, nameKey },
    orderBy: { createdAt: "desc" },
  });

  if (
    !latest ||
    latest.consumedAt ||
    latest.expiresAt.getTime() <= now.getTime() ||
    latest.attempts >= MAX_CODE_ATTEMPTS
  ) {
    return null;
  }

  const spent = await prisma.visitorVerification.updateMany({
    where: {
      id: latest.id,
      consumedAt: null,
      attempts: { lt: MAX_CODE_ATTEMPTS },
    },
    data: { attempts: { increment: 1 } },
  });

  if (
    spent.count === 0 ||
    !safeEqual(latest.codeHash, hashCode(email, nameKey, code))
  ) {
    return null;
  }

  const consumed = await prisma.visitorVerification.updateMany({
    where: { id: latest.id, consumedAt: null },
    data: { consumedAt: now },
  });

  if (consumed.count === 0) return null;

  return prisma.visitorProfile.findUnique({
    where: { email_nameKey: { email, nameKey } },
    select: PROFILE_SELECT,
  });
}

/** What the verified cookie proves: this one profile, by id and by pair. */
export type VerifiedClaim = {
  profileId: string;
  email: string;
  nameKey: string;
};

type CookiePayload = { pid: string; email: string; nk: string; exp: number };

/** `payload.signature`, both base64url. */
export function signVerifiedCookie(
  profile: Pick<VerifiedProfile, "id" | "email" | "nameKey">,
  now: Date = new Date(),
): string {
  const payload: CookiePayload = {
    pid: profile.id,
    email: profile.email,
    nk: profile.nameKey,
    exp: now.getTime() + VERIFIED_COOKIE_MAX_AGE_S * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return `${body}.${hmac(`cookie:${body}`)}`;
}

/** The cookie's claims if it is authentic and unexpired, else null. */
export function readVerifiedCookie(
  value: string | undefined,
  now: Date = new Date(),
): VerifiedClaim | null {
  if (!value) return null;

  const [body, signature] = value.split(".");
  if (!body || !signature || !safeEqual(signature, hmac(`cookie:${body}`))) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as CookiePayload;

    if (
      typeof payload.exp !== "number" ||
      payload.exp <= now.getTime() ||
      typeof payload.nk !== "string"
    ) {
      return null;
    }

    return {
      profileId: payload.pid,
      email: payload.email,
      nameKey: payload.nk,
    };
  } catch {
    return null;
  }
}

/** Shared by the verify route (set) and the booking route (clear). */
export const verifiedCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: VERIFIED_COOKIE_MAX_AGE_S,
} as const;

export type ProfileLink = {
  /** Null when the booking is deliberately left unlinked. */
  visitorProfileId: string | null;
  /** The name to book under: the profile's stored casing, when verified. */
  firstName: string;
  lastName: string;
};

/**
 * Decides which profile, if any, a new booking belongs to, keyed on the
 * email + name pair:
 *
 * - verified for this exact pair: link to that profile, use its stored name;
 * - the pair exists but the visitor has not verified it: don't link, and
 *   leave the profile alone;
 * - no profile for the pair: create one from the submitted details and link.
 *
 * A different name at the same email is simply a different pair, so it gets
 * its own profile.
 *
 * Runs on the caller's transaction client so the profile it may create and the
 * appointment are written together. If a concurrent booking creates the same
 * pair first, the create fails with P2002 and aborts the transaction; the
 * caller retries, and the retry takes the "pair exists" branch.
 */
export async function resolveBookingProfile(
  tx: Prisma.TransactionClient,
  input: {
    verified: VerifiedClaim | null;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  },
): Promise<ProfileLink> {
  const email = normalizeEmail(input.email);
  const nameKey = makeNameKey(input.firstName, input.lastName);

  const existing = await tx.visitorProfile.findUnique({
    where: { email_nameKey: { email, nameKey } },
    select: { id: true, firstName: true, lastName: true },
  });

  if (existing) {
    const verified =
      input.verified?.profileId === existing.id &&
      input.verified.email === email &&
      input.verified.nameKey === nameKey;

    return verified
      ? {
          visitorProfileId: existing.id,
          firstName: existing.firstName,
          lastName: existing.lastName,
        }
      : {
          visitorProfileId: null,
          firstName: input.firstName,
          lastName: input.lastName,
        };
  }

  const created = await tx.visitorProfile.create({
    data: {
      email,
      nameKey,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    },
    select: { id: true },
  });

  return {
    visitorProfileId: created.id,
    firstName: input.firstName,
    lastName: input.lastName,
  };
}
