import "server-only";

import QRCode from "qrcode";

import type { AppointmentStatus } from "@/generated/prisma/enums";
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
  | "CANCELLED";

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
  | { ok: false; reason: AppointmentTokenFailure };

/**
 * The rule for whether an appointment may still be redeemed, with no database
 * access of its own.
 *
 * Split out so `validateAppointmentToken()` and the redemption in
 * `src/lib/appointments.ts` decide by the same rule — the second has to re-check
 * inside its transaction, and that re-check must not be allowed to drift from
 * what the kiosk was told a moment earlier.
 *
 * Order is deliberate. A cancelled or already-used appointment says so even once
 * it has also lapsed, because "you already checked in" is a more useful thing to
 * hear at a desk than "that expired".
 */
export function classifyAppointment(
  appointment: { status: AppointmentStatus; expiresAt: Date },
  now: Date = new Date(),
): AppointmentTokenFailure | null {
  if (appointment.status === "CANCELLED") return "CANCELLED";
  if (appointment.status === "CHECKED_IN") return "ALREADY_USED";
  if (appointment.status === "EXPIRED") return "EXPIRED";
  if (appointment.expiresAt.getTime() <= now.getTime()) return "EXPIRED";

  return null;
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
    return { ok: false, reason: "NOT_FOUND" };
  }

  const appointment = await prisma.appointment.findFirst({
    // Both columns are unique, and a uuid cannot collide with the `APT-` shape,
    // so at most one row matches. Reference numbers are typed on a kiosk
    // keypad, hence the upper-casing; `qrToken` is machine-read and matched
    // exactly.
    where: {
      OR: [{ qrToken: trimmed }, { referenceNumber: trimmed.toUpperCase() }],
    },
    include: { host: true, purpose: true },
  });

  if (!appointment) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  const failure = classifyAppointment(appointment);

  if (failure) {
    return { ok: false, reason: failure };
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

/** Wording for each failure, so every surface turns a reason down the same way. */
export const APPOINTMENT_FAILURE_MESSAGE: Record<
  AppointmentTokenFailure,
  string
> = {
  NOT_FOUND: "We could not find that appointment. Please check the code.",
  ALREADY_USED: "This appointment has already been checked in.",
  EXPIRED: "This appointment has expired. Please ask reception for help.",
  CANCELLED: "This appointment was cancelled.",
};

/** HTTP status for each failure — 404 for absent, 409 for present but unusable. */
export const APPOINTMENT_FAILURE_STATUS: Record<
  AppointmentTokenFailure,
  number
> = {
  NOT_FOUND: 404,
  ALREADY_USED: 409,
  EXPIRED: 409,
  CANCELLED: 409,
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
