import { NextResponse } from "next/server";

import { clientIp, consumeRateLimit } from "@/lib/rate-limit";
import {
  APPOINTMENT_FAILURE_MESSAGE,
  APPOINTMENT_FAILURE_STATUS,
  validateAppointmentToken,
} from "@/lib/qr";

/**
 * Same budget the kiosk reference lookup had on clark_dev: a whole queue at the
 * door is normal, a script walking codes is not.
 */
const LOOKUP_LIMIT = { window: 60, max: 30 };

/**
 * POST /api/appointments/validate — resolve a scanned or typed code.
 *
 * One route for both, because `validateAppointmentToken()` accepts either a
 * `qrToken` or a `referenceNumber`. The kiosk camera, the kiosk keypad fallback
 * and the guard's scanner all post here.
 *
 * POST rather than GET with the code in the path: a `qrToken` is a bearer
 * credential, and a URL is the one part of a request that reliably ends up in
 * access logs, browser history and referrer headers.
 *
 * Public, like the rest of the kiosk. Reads nothing out unless the code is
 * valid, so an attacker learns only whether a code they already hold works.
 */
export async function POST(request: Request) {
  const limit = consumeRateLimit(
    `appointment-lookup:${clientIp(request.headers)}`,
    LOOKUP_LIMIT,
  );

  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many lookups from this terminal just now. Please wait a moment, or ask reception for help.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { token } = (body ?? {}) as Record<string, unknown>;
  const candidate = typeof token === "string" ? token : "";

  if (!candidate.trim()) {
    return NextResponse.json(
      { error: "Please enter your reference number." },
      { status: 400 },
    );
  }

  try {
    const result = await validateAppointmentToken(candidate);

    if (!result.ok) {
      return NextResponse.json(
        {
          reason: result.reason,
          error: APPOINTMENT_FAILURE_MESSAGE[result.reason],
        },
        { status: APPOINTMENT_FAILURE_STATUS[result.reason] },
      );
    }

    return NextResponse.json({ appointment: result.appointment });
  } catch (error) {
    console.error("POST /api/appointments/validate failed", error);
    return NextResponse.json(
      { error: "Could not look up that appointment." },
      { status: 500 },
    );
  }
}
