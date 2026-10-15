import { withApi } from "@/lib/api";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { VERIFIED_COOKIE_NAME } from "@/lib/booking-verification";
import { BOOKING_PASS_COOKIE_NAME, BOOKING_PASS_COOKIE_PATH } from "@/lib/booking-pass";

/**
 * POST /api/booking/sign-out — forget the verified-visitor cookie, so the next
 * person at a shared device does not see this visitor's appointments.
 */
async function POSTHandler() {
  const cookieStore = await cookies();
  cookieStore.delete(VERIFIED_COOKIE_NAME);
  cookieStore.delete({ name: BOOKING_PASS_COOKIE_NAME, path: BOOKING_PASS_COOKIE_PATH });
  return NextResponse.json({ status: "signed-out" });
}

export const POST = withApi(POSTHandler);
