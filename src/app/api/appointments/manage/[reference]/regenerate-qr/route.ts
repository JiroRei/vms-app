import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { after, NextResponse } from "next/server";

import { appBaseUrl } from "@/lib/appointment-access";
import { emailAppointment } from "@/lib/appointment-notify";
import { changeFailureResponse } from "@/lib/appointment-responses";
import {
  getAppointmentByReference,
  regenerateQrToken,
} from "@/lib/appointments";
import { getSession } from "@/lib/session";

/**
 * POST /api/appointments/manage/[reference]/regenerate-qr — issue a new QR code
 * and resend it, for a code that has been lost or shared.
 *
 * Staff-only. The old code stops working the moment this commits, and so do
 * manage links sent with it. The email is awaited (it never throws) so the
 * guard is told whether the visitor actually has the new code; if not, the
 * unchanged reference number still checks them in.
 */
async function POSTHandler(
  request: Request,
  context: RouteContext<"/api/appointments/manage/[reference]/regenerate-qr">,
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reference } = await context.params;

  try {
    const appointment = await getAppointmentByReference(reference);

    if (!appointment) {
      return changeFailureResponse({ status: "not-found" }, "regenerate");
    }

    const result = await regenerateQrToken(appointment.id, {
      type: "STAFF",
      userId: session.userId,
    });

    if (result.status !== "ok") {
      return changeFailureResponse(result, "regenerate");
    }

    const baseUrl = appBaseUrl(request);
    after(() => emailAppointment(
      result.appointment,
      baseUrl,
      "new-code",
    ));

    return NextResponse.json({ emailSent: false, emailQueued: true });
  } catch (error) {
    logger.error(
      "POST /api/appointments/manage/[reference]/regenerate-qr failed",
      error,
    );
    return NextResponse.json(
      { error: "Could not issue a new code." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
