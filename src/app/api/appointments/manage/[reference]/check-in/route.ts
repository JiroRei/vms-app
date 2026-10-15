import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { after, NextResponse } from "next/server";

import { redeemAppointment } from "@/lib/appointments";
import { APPOINTMENT_FAILURE_STATUS } from "@/lib/qr";
import { getSession } from "@/lib/session";
import { evaluateRecurringVisitor } from "@/lib/visitor-pass";
import { notifyHostArrival } from "@/lib/host-notify";

/**
 * POST /api/appointments/manage/[reference]/check-in — one-click check-in from
 * the appointments list, for a visitor who is at the desk without their QR.
 *
 * Staff-only, and the same `redeemAppointment()` the kiosk and the scanner use,
 * with `checkedInBy` set to the signed-in user: the same eligibility rule, the
 * same linked visit, the same CHECKED_IN log entry — attributed to this guard.
 */
async function POSTHandler(
  _request: Request,
  context: RouteContext<"/api/appointments/manage/[reference]/check-in">,
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reference } = await context.params;

  try {
    const result = await redeemAppointment(reference, {
      checkedInBy: session.userId,
    });

    if (result.status === "failed") {
      return NextResponse.json(
        { reason: result.reason, error: result.message },
        { status: APPOINTMENT_FAILURE_STATUS[result.reason] },
      );
    }

    after(() => evaluateRecurringVisitor(result.visitorProfileId));
    after(() => notifyHostArrival({
      hostId: result.hostId,
      firstName: result.appointment.firstName,
      lastName: result.appointment.lastName,
      purposeLabel: result.appointment.purposeLabel,
      checkedInAt: result.checkInTime,
    }));

    return NextResponse.json(
      { visitId: result.visitId, appointment: result.appointment },
      { status: 201 },
    );
  } catch (error) {
    logger.error(
      "POST /api/appointments/manage/[reference]/check-in failed",
      error,
    );
    return NextResponse.json(
      { error: "Could not check this visitor in." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
