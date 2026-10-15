import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/appointment-responses";
import { findPassAppointments } from "@/lib/appointments";
import { describeAppointmentFailure } from "@/lib/qr";
import { getActivePurposeOptions } from "@/lib/purposes";
import { clientIp, consumeRateLimit } from "@/lib/rate-limit";
import { getHosts } from "@/lib/visits";
import { recentVisitChoices, validatePass } from "@/lib/visitor-pass";

/** Same budget as the appointment lookup: a queue at the door, not a script. */
const LOOKUP_LIMIT = { window: 60, max: 30 };

/**
 * POST /api/passes/resolve — what a scanned visitor pass can do right now.
 *
 * Public, like the rest of the kiosk: the pass is a bearer credential, so
 * whoever presents it is treated as its holder (with a guard present). Returns
 * the holder's name and either the appointments they can check into now — the
 * same rule as an appointment QR — or, if none, what an express walk-in needs:
 * their recent host + purpose combinations, plus the full lists as a fallback.
 *
 * Read-only. Every refusal (forged, rotated, revoked, expired) gets the same
 * 403 and message, so a scan cannot tell which passes exist.
 */
async function POSTHandler(request: Request) {
  const limit = consumeRateLimit(`pass-lookup:${clientIp(request.headers)}`, LOOKUP_LIMIT);

  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many lookups from this terminal just now. Please wait a moment, or ask the guard for help.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = await readJsonBody(request);
  const token = typeof body.token === "string" ? body.token : "";

  try {
    const result = await validatePass(token);

    if (!result.ok) {
      logger.info(`[pass] scan refused: ${result.reason}`);
      return NextResponse.json(
        { reason: "PASS_INVALID", error: result.message },
        { status: 403 },
      );
    }

    const { profile } = result.pass;
    const { ready, laterToday } = await findPassAppointments(profile);

    const holder = { firstName: profile.firstName, lastName: profile.lastName };

    if (ready.length > 0) {
      return NextResponse.json({
        holder,
        appointments: ready.map((appointment) => ({
          referenceNumber: appointment.referenceNumber,
          firstName: appointment.firstName,
          lastName: appointment.lastName,
          purposeLabel: appointment.purposeLabel,
          hostName: appointment.hostName,
          hostDepartment: appointment.hostDepartment,
          scheduledFor: appointment.scheduledFor.toISOString(),
          expiresAt: appointment.expiresAt.toISOString(),
        })),
      });
    }

    const [choices, hosts, purposes] = await Promise.all([
      recentVisitChoices(profile.id),
      getHosts(),
      getActivePurposeOptions(),
    ]);

    return NextResponse.json({
      holder,
      appointments: [],
      // An appointment later today is worth mentioning before offering a
      // walk-in: the visitor may simply be early.
      notice: laterToday[0]
        ? describeAppointmentFailure("TOO_EARLY", { scheduledFor: laterToday[0].scheduledFor })
        : null,
      choices,
      hosts,
      purposes,
    });
  } catch (error) {
    logger.error("POST /api/passes/resolve failed", error);
    return NextResponse.json(
      { error: "Could not read this pass. Please ask the guard for help." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
