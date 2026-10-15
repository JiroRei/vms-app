import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/appointment-responses";
import { BOOKING_PASS_COOKIE_NAME, bookingPassCookieOptions, verifyBookingPass } from "@/lib/booking-pass";
import { VERIFIED_COOKIE_NAME } from "@/lib/booking-verification";
import { getClientIp } from "@/lib/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit";

const FAILURE = "That visitor pass QR ID is invalid or no longer active. Try again, or use your name and email.";

/** Public booking lookup; a bare database ID never discloses a visitor profile. */
async function POSTHandler(request: Request) {
  const limit = consumeRateLimit(`booking-pass:${getClientIp(request.headers)}`, { window: 60, max: 30 });
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a minute and try again." }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const body = await readJsonBody(request);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  try {
    const profile = await verifyBookingPass(token);
    if (!profile) return NextResponse.json({ error: FAILURE }, { status: 403 });
    const cookieStore = await cookies();
    // Booking-only proof: this cookie does not grant access to the manage page.
    cookieStore.set(BOOKING_PASS_COOKIE_NAME, token, bookingPassCookieOptions);
    cookieStore.delete(VERIFIED_COOKIE_NAME);
    return NextResponse.json({ email: profile.email, firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // Do not log the request or token: the QR is a bearer credential.
    logger.error("Visitor pass booking lookup failed");
    return NextResponse.json({ error: "Could not read your pass. Please try again." }, { status: 500 });
  }
}

export const POST = withApi(POSTHandler);
