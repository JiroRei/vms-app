import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { requireStaffApi } from "@/lib/api-auth";
import { after, NextResponse } from "next/server";

import { readJsonBody } from "@/lib/appointment-responses";
import { prisma } from "@/lib/prisma";
import { findSelectablePurpose } from "@/lib/purposes";
import { getClientIp } from "@/lib/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit";
import { notifyHostArrival } from "@/lib/host-notify";
import { createWalkInVisit } from "@/lib/visits";
import {
  evaluateRecurringVisitor,
  recordPassUse,
  validatePass,
} from "@/lib/visitor-pass";

/** Same budget as the other check-in endpoints. */
const CHECK_IN_LIMIT = { window: 60, max: 20 };

/**
 * POST /api/passes/walk-in — express walk-in for a pass holder with no
 * appointment today: one tap on "Same as last time", or a host and purpose.
 *
 * The name comes from the pass's profile, never the request. Goes through the
 * existing `createWalkInVisit()`, recorded as a PASS check-in linked to the
 * profile; the pass is renewed, and the recurring-visitor check runs after the
 * response. `assisted: true` (the guard scanner) requires a session and stamps
 * the guard, exactly as for appointments.
 */
async function POSTHandler(request: Request) {
  const limit = consumeRateLimit(`check-in:${getClientIp(request.headers)}`, CHECK_IN_LIMIT);

  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many check-ins from this terminal just now. Please wait a moment, or ask the guard for help.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = await readJsonBody(request);
  const token = typeof body.token === "string" ? body.token : "";
  const hostId = typeof body.hostId === "string" ? body.hostId : "";
  const purposeId = typeof body.purposeId === "string" ? body.purposeId : "";

  let checkedInBy: string | null = null;

  if (body.assisted === true) {
    const session = await requireStaffApi();
    checkedInBy = session.userId;
  }

  if (!hostId || !purposeId) {
    return NextResponse.json(
      { error: "Please choose who you are visiting and why." },
      { status: 400 },
    );
  }

  try {
    const result = await validatePass(token);

    if (!result.ok) {
      return NextResponse.json(
        { reason: "PASS_INVALID", error: result.message },
        { status: 403 },
      );
    }

    const [host, purpose] = await Promise.all([
      prisma.host.findFirst({ where: { id: hostId, active: true }, select: { id: true } }),
      findSelectablePurpose(purposeId),
    ]);

    if (!host || !purpose) {
      return NextResponse.json(
        { error: "That host or purpose is no longer available. Please choose another." },
        { status: 400 },
      );
    }

    const { pass } = result;
    const created = await createWalkInVisit({
      firstName: pass.profile.firstName,
      lastName: pass.profile.lastName,
      hostId: host.id,
      purposeId: purpose.id,
      visitorProfileId: pass.profile.id,
      checkInMethod: "PASS",
      checkedInBy,
    });

    await recordPassUse(pass.id);
    after(() => notifyHostArrival({
      hostId: host.id,
      firstName: pass.profile.firstName,
      lastName: pass.profile.lastName,
      purposeLabel: purpose.label,
      checkedInAt: new Date(),
    }));
    after(() => evaluateRecurringVisitor(pass.profile.id));

    return NextResponse.json(
      { ...created, firstName: pass.profile.firstName, lastName: pass.profile.lastName },
      { status: 201 },
    );
  } catch (error) {
    logger.error("POST /api/passes/walk-in failed", error);
    return NextResponse.json(
      { error: "Could not complete check-in. Please ask the guard for help." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
