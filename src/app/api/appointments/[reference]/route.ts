import { NextResponse } from "next/server";

import { lookupAppointment } from "@/lib/appointments";

/**
 * GET /api/appointments/[reference] — look up a pre-registered visit.
 *
 * Public, like the rest of the kiosk. Returns 404 for both "no such reference"
 * and "already redeemed" cases as distinct codes so the kiosk can word the
 * message, but never reveals anything beyond the matched appointment.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/appointments/[reference]">,
) {
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
