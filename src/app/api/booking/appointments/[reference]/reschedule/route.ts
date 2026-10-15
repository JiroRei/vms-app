import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { after, NextResponse } from "next/server";

import {
  appBaseUrl,
  authorizeVisitorAppointment,
} from "@/lib/appointment-access";
import { emailAppointment } from "@/lib/appointment-notify";
import {
  changeFailureResponse,
  readJsonBody,
} from "@/lib/appointment-responses";
import { rescheduleAppointment } from "@/lib/appointments";
import { checkSlot } from "@/lib/booking-config";
import { getClientIp } from "@/lib/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit";

const LIMIT = { window: 60, max: 10 };

/**
 * POST /api/booking/appointments/[reference]/reschedule — a visitor moves their
 * own appointment from the manage page.
 *
 * Public, and authorized by the body's manage `token` (scoped to this one
 * appointment) or the verified-visitor cookie. Anything else is a 404, the same
 * answer as for a reference that does not exist, so the endpoint reveals
 * nothing to someone holding neither.
 *
 * `scheduledFor` is a `YYYY-MM-DDTHH:mm` slot checked by `checkSlot()` — the
 * same rules as booking. Only a PENDING appointment whose time has not come can
 * move; its QR code and reference number stay the same, and the visitor is sent
 * the "Appointment updated" email.
 */
async function POSTHandler(
  request: Request,
  context: RouteContext<"/api/booking/appointments/[reference]/reschedule">,
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
  const raw = typeof body.scheduledFor === "string" ? body.scheduledFor.trim() : "";

  try {
    const appointment = await authorizeVisitorAppointment({ reference, token });

    if (!appointment) {
      return NextResponse.json(
        { error: "This link is invalid or has expired." },
        { status: 404 },
      );
    }

    const now = new Date();
    const slot = checkSlot(raw, now);

    if (!slot.ok) {
      return NextResponse.json(
        { fieldErrors: { scheduledFor: slot.error } },
        { status: 400 },
      );
    }

    const result = await rescheduleAppointment(
      appointment.id,
      slot.scheduledFor,
      { type: "VISITOR" },
      now,
    );

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
      "POST /api/booking/appointments/[reference]/reschedule failed",
      error,
    );
    return NextResponse.json(
      { error: "Could not reschedule. Please try again." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
