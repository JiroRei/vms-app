import { NextResponse } from "next/server";

import { cancelAppointment } from "@/lib/appointments";
import { getSession } from "@/lib/session";

/**
 * DELETE /api/appointments/manage/[reference] — cancel an appointment.
 *
 * Staff-only. "Delete" in the HTTP sense only: the row is kept as CANCELLED so
 * the kiosk can tell a visitor why their code stopped working. A checked-in or
 * already cancelled appointment answers 409.
 */
export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/appointments/manage/[reference]">,
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
        { error: "No appointment has that reference." },
        { status: 404 },
      );
    }

    if (result === "not-pending") {
      return NextResponse.json(
        {
          error:
            "This appointment can no longer be cancelled — it was checked in or already cancelled.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ status: "cancelled" });
  } catch (error) {
    console.error("DELETE /api/appointments/manage/[reference] failed", error);
    return NextResponse.json(
      { error: "Could not cancel this appointment." },
      { status: 500 },
    );
  }
}
