import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { AppointmentStatus } from "@/generated/prisma/enums";
import {
  resolveBookingProfile,
  type VerifiedClaim,
} from "@/lib/booking-verification";
import { prisma } from "@/lib/prisma";
import {
  appointmentExpiry,
  classifyAppointment,
  createQrToken,
  createReferenceNumber,
  type AppointmentTokenFailure,
  type ValidatedAppointment,
} from "@/lib/qr";

/**
 * How many times to retry the booking transaction on a unique-constraint
 * violation. Two things can collide: a random reference number (32^6
 * possibilities, so this is generous), or a concurrent booking creating the
 * same email + name profile first, which the retry resolves by taking the
 * "profile exists" path.
 */
const MAX_BOOKING_ATTEMPTS = 5;

export type CreateAppointmentInput = {
  /** As submitted; replaced by the profile's stored name when verified. */
  firstName: string;
  lastName: string;
  visitorEmail: string;
  visitorPhone: string | null;
  /** A `PurposeOption` id the caller has already confirmed is selectable. */
  purposeId: string;
  hostId: string;
  scheduledFor: Date;
  /** The verified-cookie claim, if any. See `resolveBookingProfile()`. */
  verified: VerifiedClaim | null;
  /**
   * When the visitor accepted the privacy notice. Null when staff
   * pre-register someone from the dashboard: the visitor never saw the form.
   */
  consentAcceptedAt: Date | null;
};

export type CreatedAppointment = {
  referenceNumber: string;
  qrToken: string;
  firstName: string;
  lastName: string;
  visitorEmail: string;
  purposeLabel: string | null;
  hostName: string;
  hostDepartment: string;
  scheduledFor: Date;
  expiresAt: Date;
};

/** A unique-constraint violation: a code clash or a profile-creation race. */
function isUniqueViolation(cause: unknown): boolean {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    cause.code === "P2002"
  );
}

/**
 * Books an appointment: decides which visitor profile it belongs to (creating
 * one if needed), mints its two codes and stores when it lapses.
 *
 * The profile and the appointment are written in one transaction, so a failed
 * booking never leaves a profile behind.
 *
 * Both codes are generated here rather than by the caller so every appointment
 * gets them the same way — the QR token from `crypto.randomUUID()`, the
 * reference number from the unambiguous alphabet a visitor can read aloud.
 *
 * Sending the confirmation email is deliberately *not* part of this. The row
 * must exist whether or not the mail goes out, so the caller sends afterwards
 * and reports the outcome separately.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<CreatedAppointment> {
  const expiresAt = appointmentExpiry(input.scheduledFor);

  for (let attempt = 1; attempt <= MAX_BOOKING_ATTEMPTS; attempt += 1) {
    const referenceNumber = createReferenceNumber();
    const qrToken = createQrToken();

    try {
      const appointment = await prisma.$transaction(async (tx) => {
        const link = await resolveBookingProfile(tx, {
          verified: input.verified,
          email: input.visitorEmail,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.visitorPhone,
        });

        return tx.appointment.create({
          data: {
            referenceNumber,
            qrToken,
            firstName: link.firstName,
            lastName: link.lastName,
            visitorEmail: input.visitorEmail,
            visitorPhone: input.visitorPhone,
            purposeId: input.purposeId,
            hostId: input.hostId,
            scheduledFor: input.scheduledFor,
            expiresAt,
            status: "PENDING",
            visitorProfileId: link.visitorProfileId,
            consentAcceptedAt: input.consentAcceptedAt,
          },
          include: { host: true, purpose: true },
        });
      });

      return {
        referenceNumber: appointment.referenceNumber,
        qrToken: appointment.qrToken,
        firstName: appointment.firstName,
        lastName: appointment.lastName,
        visitorEmail: appointment.visitorEmail,
        purposeLabel: appointment.purpose?.label ?? null,
        hostName: appointment.host.name,
        hostDepartment: appointment.host.department,
        scheduledFor: appointment.scheduledFor,
        expiresAt: appointment.expiresAt,
      };
    } catch (cause) {
      // Anything else is a real failure and belongs to the caller.
      if (!isUniqueViolation(cause) || attempt === MAX_BOOKING_ATTEMPTS) {
        throw cause;
      }
    }
  }

  // Unreachable: the loop either returns or throws on its last attempt.
  throw new Error("Could not create the appointment.");
}

export type RedeemResult =
  | {
      status: "checked-in";
      visitorId: string;
      visitId: string;
      appointment: ValidatedAppointment;
    }
  | { status: "failed"; reason: AppointmentTokenFailure };

/**
 * Redeems an appointment by either of its codes: moves it to CHECKED_IN and
 * creates the Visitor + Visit pair and its CHECK_IN event, exactly as the
 * walk-in flow does.
 *
 * The whole thing runs in one transaction, and `status: "PENDING"` lives in the
 * UPDATE's WHERE clause. Two people submitting the same code at once means the
 * second matches zero rows and reports ALREADY_USED, so one appointment can
 * never produce two visits — nor two timelines.
 *
 * The eligibility re-check inside the transaction goes through
 * `classifyAppointment()`, the same rule `validateAppointmentToken()` used a
 * moment earlier at the kiosk. Nothing is re-derived here.
 *
 * `checkedInBy` is the guard who did this on the visitor's behalf, and stays
 * null for the self-service kiosk — which is the whole distinction the audit
 * trail records.
 */
export async function redeemAppointment(
  token: string,
  options: { checkedInBy?: string | null } = {},
): Promise<RedeemResult> {
  const trimmed = token.trim();

  if (!trimmed) {
    return { status: "failed", reason: "NOT_FOUND" };
  }

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.findFirst({
      where: {
        OR: [{ qrToken: trimmed }, { referenceNumber: trimmed.toUpperCase() }],
      },
      include: { host: true, purpose: true },
    });

    if (!appointment) {
      return { status: "failed", reason: "NOT_FOUND" } as const;
    }

    const failure = classifyAppointment(appointment);

    if (failure) {
      return { status: "failed", reason: failure } as const;
    }

    const { count } = await tx.appointment.updateMany({
      where: { id: appointment.id, status: "PENDING" },
      data: { status: "CHECKED_IN" },
    });

    if (count === 0) {
      // Lost the race to another scanner between the read and the update.
      return { status: "failed", reason: "ALREADY_USED" } as const;
    }

    // Passed explicitly rather than left to its `now()` default so the event
    // and the visit carry the identical instant.
    const checkInTime = new Date();

    const visitor = await tx.visitor.create({
      data: {
        firstName: appointment.firstName,
        lastName: appointment.lastName,
        // The visit inherits whatever the booking was for, retired option or
        // not — a check-in records what was booked, not what is still offered.
        purposeId: appointment.purposeId,
        hostId: appointment.hostId,
        visits: {
          create: {
            checkInTime,
            checkedInBy: options.checkedInBy ?? null,
            events: {
              create: { eventType: "CHECK_IN", timestamp: checkInTime },
            },
          },
        },
      },
      include: { visits: true },
    });

    return {
      status: "checked-in",
      visitorId: visitor.id,
      visitId: visitor.visits[0].id,
      appointment: {
        referenceNumber: appointment.referenceNumber,
        firstName: appointment.firstName,
        lastName: appointment.lastName,
        purposeLabel: appointment.purpose?.label ?? null,
        hostName: appointment.host.name,
        hostDepartment: appointment.host.department,
        scheduledFor: appointment.scheduledFor.toISOString(),
        expiresAt: appointment.expiresAt.toISOString(),
      },
    } as const;
  });
}

// ---------------------------------------------------------------------------
// Staff-side management (dashboard /appointments)
//
// Merged in from clark_dev and rebuilt on the revamp's model: appointments are
// created through `createAppointment()` above (so a staff booking gets the same
// QR token, expiry and profile handling as a public one), and cancelling moves
// the row to CANCELLED rather than deleting it.
// ---------------------------------------------------------------------------

export type AppointmentListItem = {
  id: string;
  referenceNumber: string;
  firstName: string;
  lastName: string;
  visitorEmail: string;
  purposeLabel: string | null;
  hostId: string;
  hostName: string;
  hostDepartment: string;
  /** ISO strings; this crosses to the client. */
  scheduledFor: string;
  expiresAt: string;
  status: AppointmentStatus;
  /**
   * Still usable at the kiosk: PENDING and not past `expiresAt`. Everything
   * else (checked in, cancelled, lapsed) is history as far as the desk cares.
   */
  open: boolean;
  createdAt: string;
};

/**
 * The staff list of pre-registered visits. Open ones first, in the order they
 * are expected, since the question at a front desk is "who are we waiting
 * for?"; the rest follow, newest first.
 */
export async function listAppointments(): Promise<AppointmentListItem[]> {
  const now = new Date();

  const appointments = await prisma.appointment.findMany({
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
    include: { host: true, purpose: true },
  });

  const items = appointments.map((appointment) => ({
    id: appointment.id,
    referenceNumber: appointment.referenceNumber,
    firstName: appointment.firstName,
    lastName: appointment.lastName,
    visitorEmail: appointment.visitorEmail,
    purposeLabel: appointment.purpose?.label ?? null,
    hostId: appointment.hostId,
    hostName: appointment.host.name,
    hostDepartment: appointment.host.department,
    scheduledFor: appointment.scheduledFor.toISOString(),
    expiresAt: appointment.expiresAt.toISOString(),
    status: appointment.status,
    open: classifyAppointment(appointment, now) === null,
    createdAt: appointment.createdAt.toISOString(),
  }));

  return [
    ...items.filter((item) => item.open),
    ...items.filter((item) => !item.open).reverse(),
  ];
}

export type CancelResult = "cancelled" | "not-pending" | "not-found";

/**
 * Cancels an appointment that has not been redeemed.
 *
 * `status: "PENDING"` sits in the WHERE clause, so a cancel racing a check-in
 * at the kiosk loses cleanly: the row is already CHECKED_IN, nothing changes,
 * and the visitor at the door keeps the visit they just started. The row is
 * kept, as CANCELLED, so the kiosk can tell the visitor why their code no
 * longer works.
 */
export async function cancelAppointment(
  reference: string,
): Promise<CancelResult> {
  const referenceNumber = reference.trim().toUpperCase();

  const { count } = await prisma.appointment.updateMany({
    where: { referenceNumber, status: "PENDING" },
    data: { status: "CANCELLED" },
  });

  if (count > 0) return "cancelled";

  const existing = await prisma.appointment.findUnique({
    where: { referenceNumber },
    select: { id: true },
  });

  return existing ? "not-pending" : "not-found";
}
