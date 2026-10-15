/**
 * The rules shared by the two kiosk routes that take an appointment code,
 * `POST /api/appointments/validate` and `POST /api/appointments/check-in`.
 *
 * Both answer "does this code work?", so both carry the same limits: an
 * attacker kept away from one would simply use the other.
 */
import "server-only";

import { requireStaffApi } from "@/lib/api-auth";
import type { AppointmentHolder } from "@/lib/qr";
import type { StaffSession } from "@/lib/session";

/** `crypto.randomUUID()`, the QR token's shape (see `createQrToken`). */
const QR_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LAST_NAME_REQUIRED = "Please enter the last name used on the booking.";

export type KioskClaim =
  /** A guard on the dashboard: signed in, reference numbers alone are enough. */
  | { assisted: true; session: StaffSession; holder: undefined }
  /**
   * The self-service kiosk: anonymous, a reference number needs the last name.
   * `holder` is undefined only for a visitor-pass check-in, where the pass
   * itself vouches for the holder.
   */
  | { assisted: false; session: null; holder: AppointmentHolder | undefined };

/**
 * Who is asking. `assisted: true` must come with a staff session (401
 * otherwise). Anyone else is the kiosk, and typing a reference number there
 * requires the booking's last name too; a scanned QR token does not.
 *
 * Returns the 400 to send instead when the kiosk left the last name out.
 */
export async function readKioskClaim(
  body: Record<string, unknown>,
  token: string,
  { viaPass = false }: { viaPass?: boolean } = {},
): Promise<KioskClaim | Response> {
  if (body.assisted === true) {
    return { assisted: true, session: await requireStaffApi(), holder: undefined };
  }
  if (viaPass) return { assisted: false, session: null, holder: undefined };
  const lastName = typeof body.lastName === "string" ? body.lastName.slice(0, 200) : "";
  if (!QR_TOKEN_PATTERN.test(token.trim()) && !lastName.trim()) {
    return Response.json({ error: LAST_NAME_REQUIRED, fieldErrors: { lastName: LAST_NAME_REQUIRED } }, { status: 400 });
  }
  return { assisted: false, session: null, holder: { lastName } };
}

export { consumeKioskCodeLimits } from "@/lib/kiosk-limits";
