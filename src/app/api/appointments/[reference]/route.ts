import { NextResponse } from "next/server";

import { cancelAppointment, lookupAppointment } from "@/lib/appointments";
import { clientIp, consumeRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";

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

/**
 * DELETE /api/appointments/[reference] — cancel a pre-registration.
 *
 * Staff-only, and the odd one out on this file: the GET above is the kiosk's
 * and is public, while this is the front desk's. Method-level auth rather than
 * a separate route, because both act on the same thing.
 *
 * A redeemed appointment cannot be cancelled — it has already produced a visit,
 * and deleting the reference would leave that visit unexplained.
 */
export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/appointments/[reference]">,
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reference } = await context.params;

  try {
    const result = await cancelAppointment(reference);

    if (result === "not-found") {
      return NextResponse.json(
        { error: "That appointment no longer exists." },
        { status: 404 },
      );
    }

    if (result === "already-used") {
      // Someone checked in on it, possibly seconds ago. The caller's view is
      // stale rather than wrong, so this is a conflict, not a failure.
      return NextResponse.json(
        { error: "That visitor has already checked in, so it cannot be cancelled." },
        { status: 409 },
      );
    }

    return NextResponse.json({ cancelled: true });
  } catch (error) {
    console.error(`DELETE /api/appointments/${reference} failed`, error);
    return NextResponse.json(
      { error: "Could not cancel this appointment." },
      { status: 500 },
    );
  }
}
