import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  signVerifiedCookie,
  VERIFIED_COOKIE_NAME,
  verifiedCookieOptions,
  verifyCode,
} from "@/lib/booking-verification";
import { parseNameParts } from "@/lib/names";

const CODE_PATTERN = /^\d{6}$/;

/** One message for every failure, so the response never confirms a profile. */
const FAILURE =
  "That code is incorrect or has expired. Check the latest email, or request a new code.";

/**
 * POST /api/booking/verify — exchange an emailed code for the visitor's saved
 * details.
 *
 * The email, name and code are checked together: a code only verifies the
 * email + name pair it was issued for. On success sets a signed, httpOnly
 * cookie (30 minutes) naming that one profile, which `POST /api/appointments`
 * checks before linking a booking to it, and returns the stored name and phone
 * for the form to prefill.
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const emailValue = typeof fields.email === "string" ? fields.email.trim() : "";
  const codeValue = typeof fields.code === "string" ? fields.code.trim() : "";
  const name = parseNameParts(fields);

  if (!CODE_PATTERN.test(codeValue)) {
    return NextResponse.json(
      { fieldErrors: { code: "Enter the 6-digit code from the email." } },
      { status: 400 },
    );
  }

  if (!emailValue || !name.ok) {
    return NextResponse.json({ error: FAILURE }, { status: 400 });
  }

  try {
    const profile = await verifyCode(
      {
        email: emailValue,
        firstName: name.firstName,
        lastName: name.lastName,
      },
      codeValue,
    );

    if (!profile) {
      return NextResponse.json({ error: FAILURE }, { status: 400 });
    }

    const cookieStore = await cookies();
    cookieStore.set(
      VERIFIED_COOKIE_NAME,
      signVerifiedCookie(profile),
      verifiedCookieOptions,
    );

    return NextResponse.json({
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone,
    });
  } catch (error) {
    console.error("POST /api/booking/verify failed", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
