import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { after, NextResponse } from "next/server";

import { authorizeVisitorAppointment } from "@/lib/appointment-access";
import { emailCancellation } from "@/lib/appointment-notify";
import {
  changeFailureResponse,
  readJsonBody,
} from "@/lib/appointment-responses";
import { cancelAppointment } from "@/lib/appointments";
import { getClientIp } from "@/lib/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit";

const LIMIT = { window: 60, max: 10 };

/**
 * POST /api/booking/appointments/[reference]/cancel — a visitor cancels their
 * own appointment from the manage page.
 *
 * Authorized exactly like the reschedule route (manage `token` or the verified
 * cookie; 404 otherwise). Records `cancelledBy: VISITOR` and the optional
 * `reason`, logs CANCELLED, and sends the cancellation email after the
 * response.
 */
async function POSTHandler(
  request: Request,
  context: RouteContext<"/api/booking/appointments/[reference]/cancel">,
) {
  const limit = consumeRateLimit(
    `appointment-self-service:${getClientIp(request.headers)}`,
    LIMIT,
  );

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many changes just now. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const { reference } = await context.params;
  const body = await readJsonBody(request);
  const token = typeof body.token === "string" ? body.token : null;
  const reason = typeof body.reason === "string" ? body.reason : null;

  try {
    const appointment = await authorizeVisitorAppointment({ reference, token });

    if (!appointment) {
      return NextResponse.json(
        { error: "This link is invalid or has expired." },
        { status: 404 },
      );
    }

    const result = await cancelAppointment(appointment.id, {
      actor: { type: "VISITOR" },
      reason,
    });

    if (result.status !== "ok") {
      return changeFailureResponse(result, "cancel");
    }

    after(() => emailCancellation(result.appointment));

    return NextResponse.json({ status: "cancelled" });
  } catch (error) {
    logger.error("POST /api/booking/appointments/[reference]/cancel failed", error);
    return NextResponse.json(
      { error: "Could not cancel. Please try again." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
