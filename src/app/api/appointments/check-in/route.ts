import { NextResponse } from "next/server";

import { clientIp, consumeRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { redeemAppointment } from "@/lib/appointments";
import {
  APPOINTMENT_FAILURE_MESSAGE,
  APPOINTMENT_FAILURE_STATUS,
} from "@/lib/qr";

/**
 * Same budget the kiosk redeem endpoint had on clark_dev.
 */
const REDEEM_LIMIT = { window: 60, max: 20 };

/**
 * POST /api/appointments/check-in — redeem a scanned or typed code.
 *
 * `assisted` says which surface this came from, and is what the audit trail
 * turns on. A guard scanning on a visitor's behalf sends `true`, must have a
 * session, and gets their user id stamped onto the resulting visit. The kiosk
 * sends nothing and stays anonymous.
 *
 * Asking the client to declare it, rather than stamping whoever happens to hold
 * a session cookie, keeps the record deliberate: a guard who wanders onto the
 * kiosk page does not silently sign for a visitor's self-service check-in.
 * Claiming `false` while signed in only ever records less, never more.
 */
export async function POST(request: Request) {
  const limit = consumeRateLimit(
    `appointment-redeem:${clientIp(request.headers)}`,
    REDEEM_LIMIT,
  );

  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many check-ins from this terminal just now. Please wait a moment, or ask reception for help.",
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

  const { token, assisted } = (body ?? {}) as Record<string, unknown>;
  const candidate = typeof token === "string" ? token : "";

  if (!candidate.trim()) {
    return NextResponse.json(
      { error: "Please enter your reference number." },
      { status: 400 },
    );
  }

  let checkedInBy: string | null = null;

  if (assisted === true) {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    checkedInBy = session.userId;
  }

  try {
    const result = await redeemAppointment(candidate, { checkedInBy });

    if (result.status === "failed") {
      return NextResponse.json(
        {
          reason: result.reason,
          error: APPOINTMENT_FAILURE_MESSAGE[result.reason],
        },
        { status: APPOINTMENT_FAILURE_STATUS[result.reason] },
      );
    }

    return NextResponse.json(
      {
        visitorId: result.visitorId,
        visitId: result.visitId,
        appointment: result.appointment,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/appointments/check-in failed", error);
    return NextResponse.json(
      { error: "Could not complete check-in. Please ask reception for help." },
      { status: 500 },
    );
  }
}
