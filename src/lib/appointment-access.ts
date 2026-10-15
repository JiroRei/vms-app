import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import {
  belongsToClaim,
  getAppointmentById,
  getAppointmentByReference,
  type AppointmentDetail,
} from "@/lib/appointments";
import {
  readVerifiedCookie,
  VERIFIED_COOKIE_NAME,
  type VerifiedClaim,
} from "@/lib/booking-verification";

/**
 * Who may see and change an appointment from the public manage page.
 *
 * Two ways in, and nothing is revealed without one of them:
 *
 * 1. A **manage link** from a confirmation or update email. Its token names one
 *    appointment and is good for view, reschedule and cancel on that one only.
 *    It is an HMAC over the appointment id *and its current `qrToken`*, so:
 *      - it cannot be forged or pointed at another appointment;
 *      - Regenerate QR kills it along with the old code (the new email carries
 *        a new link), which matters because the page shows the QR;
 *      - it stops working once the appointment's current `expiresAt` passes —
 *        checked against the row, so a reschedule extends it with the visit.
 * 2. The returning-visitor **verified cookie** (emailed 6-digit code), which
 *    covers every appointment belonging to that email + name pair.
 */

/** Signs with the booking-verification secret, under its own prefix. */
function hmac(value: string): string {
  const secret = process.env.BOOKING_VERIFY_SECRET;

  if (!secret) {
    throw new Error(
      "BOOKING_VERIFY_SECRET is not set — see .env.example for how to generate one.",
    );
  }

  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function signature(body: string, qrToken: string): string {
  return hmac(`manage:${body}:${qrToken}`);
}

/** `body.signature`; the body is the appointment id, base64url-encoded. */
export function signManageToken(
  appointment: Pick<AppointmentDetail, "id" | "qrToken">,
): string {
  const body = Buffer.from(appointment.id).toString("base64url");
  return `${body}.${signature(body, appointment.qrToken)}`;
}

/**
 * The appointment a manage token grants access to, or null for anything
 * malformed, forged, signed over a replaced QR code, or past expiry. One
 * outcome for every failure, so a caller cannot tell them apart.
 */
export async function resolveManageToken(
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<AppointmentDetail | null> {
  if (!token || token.length > 512) return null;

  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;

  const id = Buffer.from(body, "base64url").toString("utf8");
  if (!/^[a-z0-9]{10,40}$/i.test(id)) return null;

  const appointment = await getAppointmentById(id);
  if (!appointment) return null;

  if (!safeEqual(sig, signature(body, appointment.qrToken))) return null;
  if (appointment.expiresAt.getTime() <= now.getTime()) return null;

  return appointment;
}

/** The absolute manage link for an email. */
export function manageUrl(
  baseUrl: string,
  appointment: Pick<AppointmentDetail, "id" | "qrToken">,
): string {
  const url = new URL("/appointment-booking/manage", baseUrl);
  url.searchParams.set("token", signManageToken(appointment));
  return url.toString();
}

/**
 * Where links in emails point. `BETTER_AUTH_URL` is already documented as the
 * origin the app is served from; the request's own origin is the fallback for a
 * dev box without it.
 */
export function appBaseUrl(request: Request): string {
  return process.env.BETTER_AUTH_URL || new URL(request.url).origin;
}

/** The verified-cookie claim on this request, if any. */
export async function readVisitorClaim(
  now: Date = new Date(),
): Promise<VerifiedClaim | null> {
  const cookieStore = await cookies();
  return readVerifiedCookie(cookieStore.get(VERIFIED_COOKIE_NAME)?.value, now);
}

/**
 * The appointment a public request may act on: the one its manage token names,
 * or, without a token, the referenced one if it belongs to the verified
 * visitor. Null otherwise — including for a token that names a *different*
 * appointment than `reference`, so a link for one booking never reaches
 * another.
 */
export async function authorizeVisitorAppointment(args: {
  reference: string;
  token: string | null;
}): Promise<AppointmentDetail | null> {
  const reference = args.reference.trim().toUpperCase();

  if (args.token) {
    const appointment = await resolveManageToken(args.token);
    return appointment?.referenceNumber === reference ? appointment : null;
  }

  const claim = await readVisitorClaim();
  if (!claim) return null;

  const appointment = await getAppointmentByReference(reference);

  return appointment && belongsToClaim(appointment, claim) ? appointment : null;
}
