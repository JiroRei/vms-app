import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { after, NextResponse } from "next/server";

import { emailCancellation } from "@/lib/appointment-notify";
import {
  changeFailureResponse,
  readJsonBody,
} from "@/lib/appointment-responses";
import {
  cancelAppointment,
  getAppointmentByReference,
} from "@/lib/appointments";
import { getSession } from "@/lib/session";

/**
 * DELETE /api/appointments/manage/[reference] — cancel an appointment.
 *
 * Staff-only. "Delete" in the HTTP sense only: the row is kept as CANCELLED
 * (with who, when and an optional `reason` from the body) so the kiosk can tell
 * a visitor why their code stopped working. A checked-in, cancelled or lapsed
 * appointment answers 409.
 *
 * The cancellation email goes out after the response (`after()`), so a mail
 * outage can neither block nor fail the cancel; it is logged instead.
 */
async function DELETEHandler(
  request: Request,
  context: RouteContext<"/api/appointments/manage/[reference]">,
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reference } = await context.params;
  const body = await readJsonBody(request);
  const reason = typeof body.reason === "string" ? body.reason : null;

  try {
    const appointment = await getAppointmentByReference(reference);

    if (!appointment) {
      return changeFailureResponse({ status: "not-found" }, "cancel");
    }

    const result = await cancelAppointment(appointment.id, {
      actor: { type: "STAFF", userId: session.userId },
      reason,
    });

    if (result.status !== "ok") {
      return changeFailureResponse(result, "cancel");
    }

    after(() => emailCancellation(result.appointment));

    return NextResponse.json({ status: "cancelled" });
  } catch (error) {
    logger.error("DELETE /api/appointments/manage/[reference] failed", error);
    return NextResponse.json(
      { error: "Could not cancel this appointment." },
      { status: 500 },
    );
  }
}

export const DELETE = withApi(DELETEHandler);
