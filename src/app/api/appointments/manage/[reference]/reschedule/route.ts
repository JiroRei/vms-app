import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { after, NextResponse } from "next/server";

import { appBaseUrl } from "@/lib/appointment-access";
import { emailAppointment } from "@/lib/appointment-notify";
import {
  changeFailureResponse,
  readJsonBody,
} from "@/lib/appointment-responses";
import {
  getAppointmentByReference,
  rescheduleAppointment,
} from "@/lib/appointments";
import { getSession } from "@/lib/session";

/**
 * POST /api/appointments/manage/[reference]/reschedule — move an appointment
 * from the dashboard.
 *
 * Staff-only. Takes `scheduledFor` as an ISO instant, any time in the future —
 * the same latitude staff have when pre-registering, since the desk may need to
 * fit someone in outside the public slots. The QR code and reference number are
 * unchanged; the visitor gets the "Appointment updated" email after the
 * response.
 */
async function POSTHandler(
  request: Request,
  context: RouteContext<"/api/appointments/manage/[reference]/reschedule">,
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reference } = await context.params;
  const body = await readJsonBody(request);
  const raw = typeof body.scheduledFor === "string" ? body.scheduledFor : "";
  const scheduledFor = raw ? new Date(raw) : null;

  if (!scheduledFor || Number.isNaN(scheduledFor.getTime())) {
    return NextResponse.json(
      { fieldErrors: { scheduledFor: "Please choose the new time." } },
      { status: 400 },
    );
  }

  if (scheduledFor.getTime() <= Date.now()) {
    return NextResponse.json(
      { fieldErrors: { scheduledFor: "Please choose a time in the future." } },
      { status: 400 },
    );
  }

  try {
    const appointment = await getAppointmentByReference(reference);

    if (!appointment) {
      return changeFailureResponse({ status: "not-found" }, "reschedule");
    }

    const result = await rescheduleAppointment(appointment.id, scheduledFor, {
      type: "STAFF",
      userId: session.userId,
    });

    if (result.status !== "ok") {
      return changeFailureResponse(result, "reschedule");
    }

    const baseUrl = appBaseUrl(request);
    after(() => emailAppointment(result.appointment, baseUrl, "updated"));

    return NextResponse.json({
      scheduledFor: result.appointment.scheduledFor.toISOString(),
      expiresAt: result.appointment.expiresAt.toISOString(),
    });
  } catch (error) {
    logger.error(
      "POST /api/appointments/manage/[reference]/reschedule failed",
      error,
    );
    return NextResponse.json(
      { error: "Could not reschedule this appointment." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
