import "server-only";

import { randomInt } from "node:crypto";

import { prisma } from "@/lib/prisma";

/**
 * Characters a generated reference is built from: uppercase letters and digits
 * with every misreadable pair removed — no `O`/`0`, no `I`/`1`/`L`. A visitor
 * reads one off a phone screen and types it on a tablet, and "is that a one or
 * an ell?" is a support call the alphabet can simply prevent.
 */
const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const REFERENCE_LENGTH = 6;

/** How many collisions to ride out before giving up. */
const REFERENCE_ATTEMPTS = 5;

/**
 * A random reference number, not a sequential one.
 *
 * The seeded fixtures run `APT-1001`–`APT-1004`, which anyone could walk: the
 * lookup endpoint is public by design and returns a visitor's name, purpose and
 * host. 31^6 is about 887 million, so guessing is no longer the cheap attack —
 * the rate limit on the lookup route handles what is left.
 */
function generateReference(): string {
  let suffix = "";

  for (let i = 0; i < REFERENCE_LENGTH; i += 1) {
    suffix += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }

  return `APT-${suffix}`;
}

/**
 * Prisma's "unique constraint failed". Matched on the code rather than on an
 * imported error class so this does not depend on where the generated client
 * happens to export that class from.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export type AppointmentDetails = {
  referenceNumber: string;
  visitorName: string;
  purpose: string;
  hostName: string;
  hostDepartment: string;
};

export type LookupResult =
  | { status: "found"; appointment: AppointmentDetails }
  | { status: "not-found" }
  | { status: "already-used" };

/** Reference numbers are typed on a kiosk, so match them case-insensitively. */
function normalizeReference(reference: string): string {
  return reference.trim().toUpperCase();
}

export async function lookupAppointment(
  reference: string,
): Promise<LookupResult> {
  const referenceNumber = normalizeReference(reference);

  const appointment = await prisma.appointment.findUnique({
    where: { referenceNumber },
    include: { host: true },
  });

  if (!appointment) {
    return { status: "not-found" };
  }

  if (appointment.used) {
    return { status: "already-used" };
  }

  return {
    status: "found",
    appointment: {
      referenceNumber: appointment.referenceNumber,
      visitorName: appointment.visitorName,
      purpose: appointment.purpose,
      hostName: appointment.host.name,
      hostDepartment: appointment.host.department,
    },
  };
}

export type RedeemResult =
  | { status: "checked-in"; visitorId: string; visitId: string }
  | { status: "not-found" }
  | { status: "already-used" };

/**
 * Redeems an appointment: marks it used and creates the Visitor + Visit pair,
 * exactly as the walk-in flow does.
 *
 * The whole thing runs in one transaction, and the `used: false` guard lives in
 * the UPDATE's WHERE clause. Two people submitting the same reference number at
 * once means the second matches zero rows and rolls back, so one appointment
 * can never produce two visits.
 */
export async function redeemAppointment(
  reference: string,
): Promise<RedeemResult> {
  const referenceNumber = normalizeReference(reference);

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({
      where: { referenceNumber },
    });

    if (!appointment) {
      return { status: "not-found" } as const;
    }

    const { count } = await tx.appointment.updateMany({
      where: { referenceNumber, used: false },
      data: { used: true },
    });

    if (count === 0) {
      return { status: "already-used" } as const;
    }

    const visitor = await tx.visitor.create({
      data: {
        name: appointment.visitorName,
        purpose: appointment.purpose,
        hostId: appointment.hostId,
        visits: { create: {} },
      },
      include: { visits: true },
    });

    return {
      status: "checked-in",
      visitorId: visitor.id,
      visitId: visitor.visits[0].id,
    } as const;
  });
}

// ---------------------------------------------------------------------------
// Staff-side management
//
// Until these existed, an appointment could only be created by editing
// `prisma/seed.ts` and re-running the seed — the kiosk could redeem references
// that nothing in the running application could produce.
// ---------------------------------------------------------------------------

export type AppointmentListItem = {
  id: string;
  referenceNumber: string;
  visitorName: string;
  purpose: string;
  hostId: string;
  hostName: string;
  hostDepartment: string;
  /** ISO string, or null when no time was agreed. Crosses to the client. */
  scheduledFor: string | null;
  used: boolean;
  createdAt: string;
};

export type CreateAppointmentInput = {
  visitorName: string;
  purpose: string;
  hostId: string;
  /** Null when no time is set; the reference works at the kiosk regardless. */
  scheduledFor: Date | null;
};

export type CreateResult =
  | { status: "created"; appointment: AppointmentListItem }
  | { status: "unknown-host" };

function toListItem(appointment: {
  id: string;
  referenceNumber: string;
  visitorName: string;
  purpose: string;
  hostId: string;
  scheduledFor: Date | null;
  used: boolean;
  createdAt: Date;
  host: { name: string; department: string };
}): AppointmentListItem {
  return {
    id: appointment.id,
    referenceNumber: appointment.referenceNumber,
    visitorName: appointment.visitorName,
    purpose: appointment.purpose,
    hostId: appointment.hostId,
    hostName: appointment.host.name,
    hostDepartment: appointment.host.department,
    scheduledFor: appointment.scheduledFor?.toISOString() ?? null,
    used: appointment.used,
    createdAt: appointment.createdAt.toISOString(),
  };
}

/**
 * Pre-registers a visitor and hands back the reference they will type in.
 *
 * The host is checked first so an unknown one is a 400 the form can point at
 * rather than a foreign-key 500. The reference is generated rather than chosen:
 * on the astronomically unlikely collision the unique index rejects the insert
 * and this tries again, so two appointments can never share a reference.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<CreateResult> {
  const host = await prisma.host.findUnique({
    where: { id: input.hostId },
    select: { id: true },
  });

  if (!host) {
    return { status: "unknown-host" };
  }

  for (let attempt = 0; attempt < REFERENCE_ATTEMPTS; attempt += 1) {
    try {
      const created = await prisma.appointment.create({
        data: {
          referenceNumber: generateReference(),
          visitorName: input.visitorName,
          purpose: input.purpose,
          hostId: input.hostId,
          scheduledFor: input.scheduledFor,
        },
        include: { host: true },
      });

      return { status: "created", appointment: toListItem(created) };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Reference already taken — round again with a new one.
    }
  }

  throw new Error(
    `Could not generate a free reference number in ${REFERENCE_ATTEMPTS} attempts.`,
  );
}

/**
 * The staff list of pre-registered visits.
 *
 * Unredeemed appointments come first and in the order they are expected, since
 * the question this answers at a front desk is "who are we waiting for?".
 * Redeemed ones are off by default: once someone has checked in they are a
 * visit, and the visit log is where their day is recorded.
 */
export async function listAppointments(options: {
  includeUsed: boolean;
}): Promise<AppointmentListItem[]> {
  const appointments = await prisma.appointment.findMany({
    where: options.includeUsed ? {} : { used: false },
    orderBy: [
      { used: "asc" },
      // Nulls last: an appointment with no agreed time is not "earliest", it is
      // unscheduled, and it belongs after everything that has a time.
      { scheduledFor: { sort: "asc", nulls: "last" } },
      { createdAt: "desc" },
    ],
    include: { host: true },
  });

  return appointments.map(toListItem);
}

export type CancelResult = "cancelled" | "already-used" | "not-found";

/**
 * Cancels an appointment that has not been redeemed.
 *
 * `used: false` sits in the WHERE clause rather than in a prior read, so a
 * cancel racing a check-in at the kiosk loses cleanly: the row is already
 * marked used, nothing is deleted, and the visitor standing at the door keeps
 * the visit they just started.
 *
 * A redeemed appointment is deliberately not deletable — it produced a `Visit`,
 * and removing the reference would leave that visit unexplained.
 */
export async function cancelAppointment(
  reference: string,
): Promise<CancelResult> {
  const referenceNumber = normalizeReference(reference);

  const { count } = await prisma.appointment.deleteMany({
    where: { referenceNumber, used: false },
  });

  if (count > 0) {
    return "cancelled";
  }

  const existing = await prisma.appointment.findUnique({
    where: { referenceNumber },
    select: { id: true },
  });

  return existing ? "already-used" : "not-found";
}
