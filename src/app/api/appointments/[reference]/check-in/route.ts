import { NextResponse } from "next/server";

import { redeemAppointment } from "@/lib/appointments";
import { clientIp, consumeRateLimit } from "@/lib/rate-limit";

/** As for a walk-in: enough for a queue at the door, not enough for a script. */
const REDEEM_LIMIT = { window: 60, max: 20 };

/**
 * POST /api/appointments/[reference]/check-in — redeem an appointment.
 *
 * Marks it used and creates the Visitor + Visit pair in one transaction.
 * Public, like the rest of the kiosk.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/appointments/[reference]/check-in">,
) {
  const limit = consumeRateLimit(
    `appointment-check-in:${clientIp(request.headers)}`,
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

  const { reference } = await context.params;

  try {
    const result = await redeemAppointment(reference);

    if (result.status === "not-found") {
      return NextResponse.json(
        { error: "Reference number not found or already used." },
        { status: 404 },
      );
    }

    if (result.status === "already-used") {
      return NextResponse.json(
        { error: "Reference number not found or already used." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { visitorId: result.visitorId, visitId: result.visitId },
      { status: 201 },
    );
  } catch (error) {
    console.error(`POST /api/appointments/${reference}/check-in failed`, error);
    return NextResponse.json(
      { error: "Could not complete check-in. Please ask reception for help." },
      { status: 500 },
    );
  }
}
