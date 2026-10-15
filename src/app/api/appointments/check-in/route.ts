import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { after, NextResponse } from "next/server";

import {
  belongsToClaim,
  getAppointmentByReference,
  redeemAppointment,
} from "@/lib/appointments";
import { APPOINTMENT_FAILURE_STATUS, describeAppointmentFailure } from "@/lib/qr";
import { getClientIp } from "@/lib/client-ip";
import { consumeKioskCodeLimits, readKioskClaim } from "@/lib/kiosk-claim";
import { consumeRateLimit } from "@/lib/rate-limit";
import { notifyHostArrival } from "@/lib/host-notify";
import {
  evaluateRecurringVisitor,
  recordPassUse,
  validatePass,
} from "@/lib/visitor-pass";

/**
 * Same budget the kiosk redeem endpoint had on clark_dev.
 */
const REDEEM_LIMIT = { window: 60, max: 20 };

/**
 * POST /api/appointments/check-in — redeem a scanned or typed code.
 *
 * `assisted` says which surface this came from, and is what the audit trail
 * turns on. A guard scanning on a visitor's behalf sends `true`, must have a
 * session, and gets their user id stamped onto the resulting visit. The kiosk
 * sends nothing and stays anonymous.
 *
 * Asking the client to declare it, rather than stamping whoever happens to hold
 * a session cookie, keeps the record deliberate: a guard who wanders onto the
 * kiosk page does not silently sign for a visitor's self-service check-in.
 * Claiming `false` while signed in only ever records less, never more.
 */
async function POSTHandler(request: Request) {
  const limit = consumeRateLimit(
    `appointment-redeem:${getClientIp(request.headers)}`,
    REDEEM_LIMIT,
  );

  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many check-ins from this terminal just now. Please wait a moment, or ask reception for help.",
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const { token, passToken } = fields;
  const candidate = typeof token === "string" ? token : "";

  if (!candidate.trim()) {
    return NextResponse.json(
      { error: "Please enter your reference number." },
      { status: 400 },
    );
  }

  // A pass vouches for its holder (re-checked below), so a pass check-in needs
  // no last name; otherwise the kiosk rule from `readKioskClaim` applies.
  const viaPassToken = typeof passToken === "string" && passToken !== "";
  const claim = await readKioskClaim(fields, candidate, { viaPass: viaPassToken });
  if (claim instanceof Response) return claim;
  const checkedInBy = claim.assisted ? claim.session.userId : null;

  if (!claim.assisted) {
    const limited = await consumeKioskCodeLimits(candidate);
    if (limited) return limited;
  }

  try {
    // Express check-in: the pass found this appointment. Re-validate the pass
    // and confirm the appointment really is its holder's — the reference alone
    // must not let one pass redeem someone else's booking as a PASS check-in.
    let viaPass: { profileId: string; passId: string } | null = null;

    if (typeof passToken === "string" && passToken) {
      const pass = await validatePass(passToken);

      if (!pass.ok) {
        return NextResponse.json(
          { reason: "PASS_INVALID", error: pass.message },
          { status: 403 },
        );
      }

      const appointment = await getAppointmentByReference(candidate);
      const { profile } = pass.pass;

      if (
        !appointment ||
        !belongsToClaim(appointment, {
          profileId: profile.id,
          email: profile.email,
          nameKey: profile.nameKey,
        })
      ) {
        return NextResponse.json(
          { reason: "NOT_FOUND", error: describeAppointmentFailure("NOT_FOUND", null) },
          { status: 404 },
        );
      }

      viaPass = { profileId: profile.id, passId: pass.pass.id };
    }

    const result = await redeemAppointment(candidate, { checkedInBy, viaPass, holder: claim.holder });

    if (result.status === "failed") {
      return NextResponse.json(
        {
          reason: result.reason,
          error: result.message,
        },
        { status: APPOINTMENT_FAILURE_STATUS[result.reason] },
      );
    }

    if (viaPass) {
      await recordPassUse(viaPass.passId);
    }

    // Every check-in linked to a profile may tip it over the recurring
    // threshold. After the response, so a slow email never holds up the kiosk.
    after(() => evaluateRecurringVisitor(result.visitorProfileId));
    after(() => notifyHostArrival({
      hostId: result.hostId,
      firstName: result.appointment.firstName,
      lastName: result.appointment.lastName,
      purposeLabel: result.appointment.purposeLabel,
      checkedInAt: result.checkInTime,
    }));

    return NextResponse.json(
      {
        visitorId: result.visitorId,
        visitId: result.visitId,
        appointment: result.appointment,
      },
      { status: 201 },
    );
  } catch (error) {
    logger.error("POST /api/appointments/check-in failed", error);
    return NextResponse.json(
      { error: "Could not complete check-in. Please ask reception for help." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
