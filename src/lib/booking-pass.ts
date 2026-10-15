import "server-only";

import type { VerifiedClaim, VerifiedProfile } from "@/lib/booking-verification";
import { prisma } from "@/lib/prisma";
import { validatePass } from "@/lib/visitor-pass";

export const BOOKING_PASS_COOKIE_NAME = "vms_booking_pass";
export const BOOKING_PASS_COOKIE_PATH = "/api/appointments";
export const bookingPassCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: BOOKING_PASS_COOKIE_PATH,
  maxAge: 30 * 60,
} as const;

/** Possession of a current, signed pass authorizes prefilling its own profile. */
export async function verifyBookingPass(token: string, now: Date = new Date()): Promise<VerifiedProfile | null> {
  const result = await validatePass(token.trim(), now);
  if (!result.ok) return null;
  // TODO(multi-tenancy): validate the pass and profile within the booking site's organization.
  return prisma.visitorProfile.findUnique({
    where: { id: result.pass.profileId },
    select: { id: true, firstName: true, lastName: true, email: true, nameKey: true, phone: true },
  });
}

/** Recheck rotation, revocation and expiry at booking time, without renewing a pass. */
export async function readBookingPassClaim(token: string, now: Date = new Date()): Promise<VerifiedClaim | null> {
  const profile = await verifyBookingPass(token, now);
  return profile ? { profileId: profile.id, email: profile.email, nameKey: profile.nameKey } : null;
}
