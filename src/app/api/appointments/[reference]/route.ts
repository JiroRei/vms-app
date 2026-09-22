import { NextResponse } from "next/server";

import { lookupAppointment } from "@/lib/appointments";
import { clientIp, consumeRateLimit } from "@/lib/rate-limit";

/**
 * Reference numbers are short and sequential, so this endpoint is the one place
 * an outsider could walk the space and read back a visitor's name, purpose and
 * host. The limit leaves room for a visitor mistyping theirs a few times and
 * takes automated enumeration off the table at the speed it needs.
 */
const LOOKUP_LIMIT = { window: 60, max: 30 };

/**
 * GET /api/appointments/[reference] — look up a pre-registered visit.
 *
 * Public, like the rest of the kiosk. Returns 404 for both "no such reference"
 * and "already redeemed" cases as distinct codes so the kiosk can word the
 * message, but never reveals anything beyond the matched appointment.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/appointments/[reference]">,
) {
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

  const { reference } = await context.params;

  if (!reference.trim()) {
    return NextResponse.json(
      { error: "Please enter your reference number." },
      { status: 400 },
    );
  }

  try {
    const result = await lookupAppointment(reference);

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

    return NextResponse.json({ appointment: result.appointment });
  } catch (error) {
    console.error(`GET /api/appointments/${reference} failed`, error);
    return NextResponse.json(
      { error: "Could not look up that reference number." },
      { status: 500 },
    );
  }
}
