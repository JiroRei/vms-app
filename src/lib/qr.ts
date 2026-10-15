import "server-only";

import QRCode from "qrcode";

import type { AppointmentStatus } from "@/generated/prisma/enums";
import {
  CHECK_IN_EARLY_MINUTES,
  dateKeyInZone,
  formatZonedDate,
  formatZonedTime,
} from "@/lib/booking-config";
import { prisma } from "@/lib/prisma";

/**
 * How long after `scheduledFor` an appointment's code keeps working.
 *
 * Generous on purpose: a visitor held up in traffic should not be turned away
 * by their own invitation, and the reference number is meant to be usable when
 * they finally arrive. The value is written onto each appointment at booking as
 * `expiresAt`, so changing this only affects appointments booked afterwards.
 */
export const APPOINTMENT_GRACE_HOURS = 4;

/** Characters a visitor can read down a phone line without ambiguity. */
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const REFERENCE_LENGTH = 6;

/**
 * The QR payload: a random uuid with no relationship to the row it unlocks.
 *
 * Deliberately not the appointment's `id` — a QR code gets photographed,
 * forwarded and printed on a desk, and a primary key that leaks that way invites
 * guessing at neighbours. This is the only thing a scanner ever sees.
 */
export function createQrToken(): string {
  return crypto.randomUUID();
}

/**
 * A short human-readable code for the fallback path. Random rather than
 * sequential: the seeded `APT-1001`–`APT-1004` fixtures counted up, which made
 * every other appointment guessable from any one of them.
 */
export function createReferenceNumber(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(REFERENCE_LENGTH));

  let code = "";
  for (const byte of bytes) {
    code += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  }

  return `APT-${code}`;
}

/** When a code booked for `scheduledFor` should stop working. */
export function appointmentExpiry(scheduledFor: Date): Date {
  return new Date(
    scheduledFor.getTime() + APPOINTMENT_GRACE_HOURS * 60 * 60 * 1000,
  );
}

export type AppointmentTokenFailure =
  | "NOT_FOUND"
  | "ALREADY_USED"
  | "EXPIRED"
  | "CANCELLED"
  | "WRONG_DAY"
  | "TOO_EARLY";

/** What a surface shows once a code checks out. */
export type ValidatedAppointment = {
  referenceNumber: string;
  /** Display with `formatFullName()`. */
  firstName: string;
  lastName: string;
  /** The chosen option's label, or null for a booking made without one. */
  purposeLabel: string | null;
  hostName: string;
  hostDepartment: string;
  /** ISO strings — this crosses to the client as JSON. */
  scheduledFor: string;
  expiresAt: string;
};

export type AppointmentTokenResult =
  | { ok: true; appointment: ValidatedAppointment }
  | { ok: false; reason: AppointmentTokenFailure; message: string };

/** The fields the rules below read. */
type ClassifiableAppointment = {
  status: AppointmentStatus;
  scheduledFor: Date;
  expiresAt: Date;
};

/**
 * Whether an appointment is still alive at all: not cancelled, not used, not
 * lapsed. The staff list uses this on its own to mean "still expected"; the
 * check-in rule below adds the time-of-day window on top.
 *
 * Order is deliberate. A cancelled or already-used appointment says so even once
 * it has also lapsed, because "you already checked in" is a more useful thing to
 * hear at a desk than "that expired".
 */
export function lifecycleFailure(
  appointment: ClassifiableAppointment,
  now: Date = new Date(),
): AppointmentTokenFailure | null {
  if (appointment.status === "CANCELLED") return "CANCELLED";
  if (appointment.status === "CHECKED_IN") return "ALREADY_USED";
  if (appointment.status === "EXPIRED") return "EXPIRED";
  if (appointment.expiresAt.getTime() <= now.getTime()) return "EXPIRED";

  return null;
}

/** When check-in opens for an appointment: `CHECK_IN_EARLY_MINUTES` before it. */
export function checkInOpensAt(scheduledFor: Date): Date {
  return new Date(scheduledFor.getTime() - CHECK_IN_EARLY_MINUTES * 60_000);
}

/**
 * The rule for whether an appointment may be redeemed right now, with no
 * database access of its own.
 *
 * Split out so `validateAppointmentToken()` and the redemption in
 * `src/lib/appointments.ts` decide by the same rule — the second has to re-check
 * inside its transaction, and that re-check must not be allowed to drift from
 * what the kiosk was told a moment earlier.
 *
 * On top of `lifecycleFailure()`: a code for a later day is refused outright
 * (WRONG_DAY), and on its own day it opens `CHECK_IN_EARLY_MINUTES` before the
 * scheduled time (TOO_EARLY). Days are the building's, in `BOOKING_TIMEZONE`.
 * Arriving late is fine until `expiresAt`, which may run past midnight.
 */
export function classifyAppointment(
  appointment: ClassifiableAppointment,
  now: Date = new Date(),
): AppointmentTokenFailure | null {
  const lifecycle = lifecycleFailure(appointment, now);
  if (lifecycle) return lifecycle;

  if (dateKeyInZone(appointment.scheduledFor) > dateKeyInZone(now)) {
    return "WRONG_DAY";
  }

  if (now.getTime() < checkInOpensAt(appointment.scheduledFor).getTime()) {
    return "TOO_EARLY";
  }

  return null;
}

/**
 * The plain-language reason a code was refused, built from the appointment
 * itself so it can name the times involved. Every surface — kiosk camera,
 * kiosk keypad, guard scanner, staff one-click check-in — shows this text.
 * Times are on the building's clock.
 *
 * `checkedInAt` is the time of the visit an ALREADY_USED appointment became,
 * when known (appointments redeemed before visits were linked have none).
 */
export function describeAppointmentFailure(
  reason: AppointmentTokenFailure,
  appointment: { scheduledFor: Date; checkedInAt?: Date | null } | null,
): string {
  if (!appointment || reason === "NOT_FOUND") {
    return "We could not find that appointment. Please check the code.";
  }

  const { scheduledFor, checkedInAt } = appointment;
  const time = formatZonedTime(scheduledFor);
  const date = formatZonedDate(scheduledFor);

  switch (reason) {
    case "TOO_EARLY":
      return `Your appointment is today at ${time}. Check-in opens at ${formatZonedTime(checkInOpensAt(scheduledFor))}.`;
    case "WRONG_DAY":
      return `Your appointment is on ${date} at ${time}. Please come back then.`;
    case "CANCELLED":
      return `This appointment (${date} at ${time}) was cancelled, so this code no longer works.`;
    case "EXPIRED":
      return `This appointment was for ${date} at ${time}, and its check-in window has closed.`;
    case "ALREADY_USED":
      return checkedInAt
        ? `This code was already used to check in on ${formatZonedDate(checkedInAt)} at ${formatZonedTime(checkedInAt)}. Each code works once.`
        : "This code has already been used to check in. Each code works once.";
  }
}

/**
 * Resolves whatever a surface captured — a scanned `qrToken` or a typed
 * `referenceNumber` — into an appointment, or a reason it cannot be used.
 *
 * The single entry point for every surface: the kiosk camera, the kiosk's manual
 * fallback, and the guard's scanner all call this and nothing else. Accepting
 * both kinds of code here is what lets them share one path rather than growing a
 * scanner branch and a keypad branch that slowly disagree.
 *
 * Read-only. A lapsed appointment is reported EXPIRED from its `expiresAt`
 * rather than being flipped to the EXPIRED status on the way past, so looking
 * someone up never writes.
 */
export async function validateAppointmentToken(
  token: string,
): Promise<AppointmentTokenResult> {
  const trimmed = token.trim();

  if (!trimmed) {
    return notFound();
  }

  const appointment = await prisma.appointment.findFirst({
    // Both columns are unique, and a uuid cannot collide with the `APT-` shape,
    // so at most one row matches. Reference numbers are typed on a kiosk
    // keypad, hence the upper-casing; `qrToken` is machine-read and matched
    // exactly.
    where: {
      OR: [{ qrToken: trimmed }, { referenceNumber: trimmed.toUpperCase() }],
    },
    include: {
      host: true,
      purpose: true,
      visit: { select: { checkInTime: true } },
    },
  });

  if (!appointment) {
    return notFound();
  }

  const failure = classifyAppointment(appointment);

  if (failure) {
    return {
      ok: false,
      reason: failure,
      message: describeAppointmentFailure(failure, {
        scheduledFor: appointment.scheduledFor,
        checkedInAt: appointment.visit?.checkInTime ?? null,
      }),
    };
  }

  return {
    ok: true,
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
  };
}

function notFound(): AppointmentTokenResult {
  return {
    ok: false,
    reason: "NOT_FOUND",
    message: describeAppointmentFailure("NOT_FOUND", null),
  };
}

/** HTTP status for each failure — 404 for absent, 409 for present but unusable. */
export const APPOINTMENT_FAILURE_STATUS: Record<
  AppointmentTokenFailure,
  number
> = {
  NOT_FOUND: 404,
  ALREADY_USED: 409,
  EXPIRED: 409,
  CANCELLED: 409,
  WRONG_DAY: 409,
  TOO_EARLY: 409,
};

const QR_OPTIONS = {
  // The token is short, so the densest error correction is affordable and buys
  // tolerance for a creased printout or a smudged phone screen.
  errorCorrectionLevel: "H",
  margin: 2,
  width: 320,
} as const;

/** The QR code as a PNG, for embedding in an email as an inline attachment. */
export async function renderQrPng(token: string): Promise<Buffer> {
  return QRCode.toBuffer(token, { type: "png", ...QR_OPTIONS });
}

/** The same code as a data URL, for showing on the booking confirmation page. */
export async function renderQrDataUrl(token: string): Promise<string> {
  return QRCode.toDataURL(token, QR_OPTIONS);
}
