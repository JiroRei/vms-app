import "server-only";
import { logger, reportError } from "@/lib/logger";

import { Prisma } from "@/generated/prisma/client";
import type {
  PassIssueReason,
  VisitorPassStatus,
} from "@/generated/prisma/enums";
import {
  PASS_VALID_DAYS,
  RECURRING_VISITS_THRESHOLD,
  RECURRING_WINDOW_DAYS,
} from "@/lib/booking-config";
import { sendVisitorPassEmail } from "@/lib/email";
import {
  parsePassToken,
  renderPassQrDataUrl,
  signPassToken,
  verifyPassToken,
} from "@/lib/pass-token";
import { prisma } from "@/lib/prisma";

/**
 * Visitor passes: the service layer over the portable `pass-token.ts`.
 *
 * Everything here touches the database; nothing in `pass-token.ts` does. The
 * rules (see docs/visitor-pass.md):
 *
 * - **issue** — at most one ACTIVE pass per profile (a partial unique index
 *   backs this up). An ACTIVE pass that has expired is retired first.
 * - **validate** — the mac must match the pass's *current* version, the pass
 *   must be ACTIVE and not past `expiresAt`.
 * - **renew** — every successful use sets `lastUsedAt` and pushes `expiresAt`
 *   to now + `PASS_VALID_DAYS`.
 * - **rotate** — bump `version`; every QR rendered before stops working.
 * - **revoke** — `status: REVOKED`, with who and when.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The one message every surface shows for a pass that cannot be used. */
export const PASS_FAILURE_MESSAGE =
  "This pass is no longer valid. Please ask the guard for help.";

/**
 * Why a pass was refused. Kept apart for logs and the staff view; the holder
 * sees `PASS_FAILURE_MESSAGE` for all of them, so a scan reveals nothing about
 * which passes exist.
 */
export type PassFailure = "INVALID" | "REVOKED" | "EXPIRED" | "REPLACED";

export function passSecret(): string {
  const value = process.env.PASS_SECRET;

  if (!value) {
    throw new Error(
      "PASS_SECRET is not set — see .env.example for how to generate one.",
    );
  }

  return value;
}

/** The pass's current token. Recomputed, never stored. */
export function tokenForPass(pass: { id: string; version: number }): string {
  return signPassToken({ passId: pass.id, version: pass.version, secret: passSecret() });
}

/** The pass's current QR, as a data URL. Identical every time it is rendered. */
export function passQrDataUrl(pass: { id: string; version: number }): Promise<string> {
  return renderPassQrDataUrl(tokenForPass(pass));
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + PASS_VALID_DAYS * DAY_MS);
}

function isUniqueViolation(cause: unknown): boolean {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    cause.code === "P2002"
  );
}

const PASS_WITH_PROFILE = {
  profile: {
    select: { id: true, firstName: true, lastName: true, email: true, nameKey: true },
  },
} as const;

export type PassWithProfile = Prisma.VisitorPassGetPayload<{
  include: typeof PASS_WITH_PROFILE;
}>;

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export type IssueResult =
  | { status: "issued"; pass: PassWithProfile }
  | { status: "already-active"; pass: PassWithProfile };

/**
 * Issues a pass for a profile, unless it already holds a usable one.
 *
 * An ACTIVE pass past its `expiresAt` is retired (REVOKED, attributed to
 * `actorUserId` or to nobody for the automatic path) so the new one can take
 * the profile's single ACTIVE slot. If two issuances race, the partial unique
 * index refuses the second insert and it reports the winner as
 * `already-active` — so a profile never ends up with two.
 */
export async function issuePass(
  profileId: string,
  args: { reason: PassIssueReason; actorUserId?: string | null },
  now: Date = new Date(),
): Promise<IssueResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const active = await tx.visitorPass.findFirst({
        where: { profileId, status: "ACTIVE" },
        include: PASS_WITH_PROFILE,
      });

      if (active && active.expiresAt.getTime() > now.getTime()) {
        return { status: "already-active", pass: active } as const;
      }

      if (active) {
        await tx.visitorPass.update({
          where: { id: active.id },
          data: {
            status: "REVOKED",
            revokedAt: now,
            revokedByUserId: args.actorUserId ?? null,
          },
        });
      }

      const pass = await tx.visitorPass.create({
        data: {
          profileId,
          issueReason: args.reason,
          issuedAt: now,
          expiresAt: expiryFrom(now),
        },
        include: PASS_WITH_PROFILE,
      });

      return { status: "issued", pass } as const;
    });
  } catch (cause) {
    if (!isUniqueViolation(cause)) throw cause;

    const winner = await prisma.visitorPass.findFirstOrThrow({
      where: { profileId, status: "ACTIVE" },
      include: PASS_WITH_PROFILE,
    });
    return { status: "already-active", pass: winner };
  }
}

/** Emails the pass's current QR. Reports, never throws. */
export async function emailPass(
  pass: PassWithProfile,
  kind: "issued" | "replaced",
) {
  return sendVisitorPassEmail({
    firstName: pass.profile.firstName,
    visitorEmail: pass.profile.email,
    token: tokenForPass(pass),
    expiresAt: pass.expiresAt,
    kind,
  });
}

// ---------------------------------------------------------------------------
// Validate and use
// ---------------------------------------------------------------------------

export type PassValidation =
  | { ok: true; pass: PassWithProfile }
  | { ok: false; reason: PassFailure; message: string };

function refused(reason: PassFailure): PassValidation {
  return { ok: false, reason, message: PASS_FAILURE_MESSAGE };
}

/**
 * Resolves a scanned token to a usable pass and its profile.
 *
 * Authenticity is checked before anything about the row is revealed: a forged
 * or garbled token is INVALID whatever the id inside it points at. A genuine
 * token for an earlier version is REPLACED (the pass was rotated). Only then do
 * status and expiry matter. Read-only; `recordPassUse()` writes.
 */
export async function validatePass(
  token: string,
  now: Date = new Date(),
): Promise<PassValidation> {
  const parsed = parsePassToken(token);
  if (!parsed) return refused("INVALID");

  const pass = await prisma.visitorPass.findUnique({
    where: { id: parsed.passId },
    include: PASS_WITH_PROFILE,
  });
  if (!pass) return refused("INVALID");

  const secret = passSecret();

  if (!verifyPassToken(token, secret, pass.version).ok) {
    // A real token for an earlier version means the pass was rotated. Checked
    // only to word the log; the holder is told the same thing either way.
    for (let version = pass.version - 1; version >= 1; version -= 1) {
      if (verifyPassToken(token, secret, version).ok) return refused("REPLACED");
    }
    return refused("INVALID");
  }

  if (pass.status === "REVOKED") return refused("REVOKED");
  if (pass.expiresAt.getTime() <= now.getTime()) return refused("EXPIRED");

  return { ok: true, pass };
}

/**
 * Records a successful check-in with a pass: `lastUsedAt` now, and `expiresAt`
 * renewed to now + `PASS_VALID_DAYS`. Guarded on ACTIVE so a pass revoked
 * between the scan and this write is not revived.
 */
export async function recordPassUse(passId: string, now: Date = new Date()) {
  await prisma.visitorPass.updateMany({
    where: { id: passId, status: "ACTIVE" },
    data: { lastUsedAt: now, expiresAt: expiryFrom(now) },
  });
}

// ---------------------------------------------------------------------------
// Rotate and revoke
// ---------------------------------------------------------------------------

/**
 * Bumps the pass's version: the old QR stops working at once, and the caller
 * shows or sends the new one. Only an ACTIVE, unexpired pass rotates; null
 * otherwise.
 */
export async function rotatePass(
  passId: string,
  now: Date = new Date(),
): Promise<PassWithProfile | null> {
  const { count } = await prisma.visitorPass.updateMany({
    where: { id: passId, status: "ACTIVE", expiresAt: { gt: now } },
    data: { version: { increment: 1 } },
  });

  if (count === 0) return null;

  return prisma.visitorPass.findUniqueOrThrow({
    where: { id: passId },
    include: PASS_WITH_PROFILE,
  });
}

/** Withdraws an ACTIVE pass for good. False if it was not ACTIVE. */
export async function revokePass(
  passId: string,
  revokedByUserId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { count } = await prisma.visitorPass.updateMany({
    where: { id: passId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: now, revokedByUserId },
  });

  return count > 0;
}

// ---------------------------------------------------------------------------
// Recurring visitors: automatic issuance
// ---------------------------------------------------------------------------

/** Linked visits for a profile within `RECURRING_WINDOW_DAYS` of `now`. */
export function countRecentVisits(profileId: string, now: Date = new Date()) {
  return prisma.visit.count({
    where: {
      visitorProfileId: profileId,
      checkInTime: { gte: new Date(now.getTime() - RECURRING_WINDOW_DAYS * DAY_MS) },
    },
  });
}

/**
 * Run after every check-in linked to a profile. Once the profile has
 * `RECURRING_VISITS_THRESHOLD` linked visits within `RECURRING_WINDOW_DAYS`, it
 * is marked `recurringSince` (once) and, if it holds no usable pass, issued one
 * (RECURRING_AUTO) and emailed it.
 *
 * A pass a staff member revoked is not undone here: a profile whose most recent
 * pass was revoked by staff gets no automatic replacement — only staff can
 * issue it another.
 *
 * Never throws: it runs after the check-in has already succeeded.
 */
export async function evaluateRecurringVisitor(
  profileId: string | null,
  now: Date = new Date(),
): Promise<{ issued: boolean }> {
  if (!profileId) return { issued: false };

  try {
    const recent = await countRecentVisits(profileId, now);
    if (recent < RECURRING_VISITS_THRESHOLD) return { issued: false };

    await prisma.visitorProfile.updateMany({
      where: { id: profileId, recurringSince: null },
      data: { recurringSince: now },
    });

    const latest = await prisma.visitorPass.findFirst({
      where: { profileId },
      orderBy: { issuedAt: "desc" },
      select: { status: true, expiresAt: true, revokedByUserId: true },
    });

    if (latest?.status === "REVOKED" && latest.revokedByUserId) {
      return { issued: false };
    }
    if (latest?.status === "ACTIVE" && latest.expiresAt.getTime() > now.getTime()) {
      return { issued: false };
    }

    const result = await issuePass(profileId, { reason: "RECURRING_AUTO" }, now);
    if (result.status !== "issued") return { issued: false };

    logger.info(
      `[pass] issued RECURRING_AUTO pass ${result.pass.id} to profile ${profileId} (${recent} visits in ${RECURRING_WINDOW_DAYS} days)`,
    );
    await emailPass(result.pass, "issued");
    return { issued: true };
  } catch (error) {
    await reportError(error, { operation: "recurringVisitor", profileId });
    return { issued: false };
  }
}

// ---------------------------------------------------------------------------
// Reads for the staff list, the manage page and express check-in
// ---------------------------------------------------------------------------

/** The profile's ACTIVE pass, expired or not; null if it has none. */
export function getActivePass(profileId: string) {
  return prisma.visitorPass.findFirst({
    where: { profileId, status: "ACTIVE" },
    include: PASS_WITH_PROFILE,
  });
}

export type PassSummary = {
  id: string;
  /** EXPIRED is derived from `expiresAt`; the row itself stays ACTIVE. */
  state: VisitorPassStatus | "EXPIRED";
  issueReason: PassIssueReason;
  version: number;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type StaffProfileRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  visitCount: number;
  recurringSince: string | null;
  /** The most recent pass, whatever its state. */
  pass: PassSummary | null;
};

/** How many rows the staff list shows; search narrows past that. */
export const STAFF_PROFILE_LIMIT = 100;

/**
 * Visitor profiles for /dashboard/visitors: search by name or email, most
 * recently active first.
 */
export async function listProfilesForStaff(
  search: string,
  now: Date = new Date(),
): Promise<StaffProfileRow[]> {
  const q = search.trim();
  const mode = "insensitive" as const;

  const profiles = await prisma.visitorProfile.findMany({
    where: q
      ? {
          OR: [
            { firstName: { contains: q, mode } },
            { lastName: { contains: q, mode } },
            { email: { contains: q, mode } },
          ],
        }
      : undefined,
    orderBy: [{ recurringSince: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: STAFF_PROFILE_LIMIT,
    include: {
      _count: { select: { visits: true } },
      passes: { orderBy: { issuedAt: "desc" }, take: 1 },
    },
  });

  return profiles.map((profile) => {
    const pass = profile.passes[0];

    return {
      id: profile.id,
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      visitCount: profile._count.visits,
      recurringSince: profile.recurringSince?.toISOString() ?? null,
      pass: pass
        ? {
            id: pass.id,
            state:
              pass.status === "ACTIVE" && pass.expiresAt.getTime() <= now.getTime()
                ? "EXPIRED"
                : pass.status,
            issueReason: pass.issueReason,
            version: pass.version,
            issuedAt: pass.issuedAt.toISOString(),
            expiresAt: pass.expiresAt.toISOString(),
            lastUsedAt: pass.lastUsedAt?.toISOString() ?? null,
            revokedAt: pass.revokedAt?.toISOString() ?? null,
          }
        : null,
    };
  });
}

/** A host + purpose pair the holder has visited before, for "Same as last time". */
export type RecentVisitChoice = {
  hostId: string;
  hostName: string;
  hostDepartment: string;
  purposeId: string;
  purposeLabel: string;
};

/**
 * The profile's most recent distinct host + purpose combinations that can
 * still be chosen (host active, purpose not retired), newest first.
 */
export async function recentVisitChoices(
  profileId: string,
  limit = 3,
): Promise<RecentVisitChoice[]> {
  const visits = await prisma.visit.findMany({
    where: { visitorProfileId: profileId },
    orderBy: { checkInTime: "desc" },
    take: 30,
    select: {
      visitor: {
        select: {
          host: { select: { id: true, name: true, department: true, active: true } },
          purpose: { select: { id: true, label: true, isActive: true } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const choices: RecentVisitChoice[] = [];

  for (const { visitor } of visits) {
    const { host, purpose } = visitor;
    if (!host?.active || !purpose?.isActive) continue;

    const key = `${host.id}|${purpose.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    choices.push({
      hostId: host.id,
      hostName: host.name,
      hostDepartment: host.department,
      purposeId: purpose.id,
      purposeLabel: purpose.label,
    });

    if (choices.length === limit) break;
  }

  return choices;
}
