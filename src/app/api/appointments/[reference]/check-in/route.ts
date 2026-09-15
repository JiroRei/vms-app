import { NextResponse } from "next/server";

import { redeemAppointment } from "@/lib/appointments";

/**
 * POST /api/appointments/[reference]/check-in — redeem an appointment.
 *
 * Marks it used and creates the Visitor + Visit pair in one transaction.
 * Public, like the rest of the kiosk.
 */
export async function POST(
  _request: Request,
  context: RouteContext<"/api/appointments/[reference]/check-in">,
) {
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
