import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { NextResponse } from "next/server";

import { getClientIp } from "@/lib/client-ip";
import { consumeKioskCodeLimits, readKioskClaim } from "@/lib/kiosk-claim";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  APPOINTMENT_FAILURE_STATUS,
  validateAppointmentToken,
} from "@/lib/qr";

/**
 * Same budget the kiosk reference lookup had on clark_dev: a whole queue at the
 * door is normal, a script walking codes is not.
 */
const LOOKUP_LIMIT = { window: 60, max: 30 };

/**
 * POST /api/appointments/validate — resolve a scanned or typed code.
 *
 * One route for both, because `validateAppointmentToken()` accepts either a
 * `qrToken` or a `referenceNumber`. The kiosk camera, the kiosk keypad fallback
 * and the guard's scanner all post here.
 *
 * POST rather than GET with the code in the path: a `qrToken` is a bearer
 * credential, and a URL is the one part of a request that reliably ends up in
 * access logs, browser history and referrer headers.
 *
 * Public, like the rest of the kiosk. Reads nothing out unless the code is
 * valid, so an attacker learns only whether a code they already hold works.
 * On the kiosk a typed reference number also needs the booking's last name;
 * a guard (`assisted: true`, signed in) looks up by reference alone. See
 * `src/lib/kiosk-claim.ts` for that rule and the per-code and global limits.
 */
async function POSTHandler(request: Request) {
  const limit = consumeRateLimit(
    `appointment-lookup:${getClientIp(request.headers)}`,
    LOOKUP_LIMIT,
  );

  if (!limit.allowed) {
    return NextResponse.json(
      {
        error:
          "Too many lookups from this terminal just now. Please wait a moment, or ask reception for help.",
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
  const candidate = typeof fields.token === "string" ? fields.token : "";

  if (!candidate.trim()) {
    return NextResponse.json(
      { error: "Please enter your reference number." },
      { status: 400 },
    );
  }

  const claim = await readKioskClaim(fields, candidate);
  if (claim instanceof Response) return claim;

  if (!claim.assisted) {
    const limited = await consumeKioskCodeLimits(candidate);
    if (limited) return limited;
  }

  try {
    const result = await validateAppointmentToken(candidate, claim.holder);

    if (!result.ok) {
      return NextResponse.json(
        {
          reason: result.reason,
          error: result.message,
        },
        { status: APPOINTMENT_FAILURE_STATUS[result.reason] },
      );
    }

    return NextResponse.json({ appointment: result.appointment });
  } catch (error) {
    logger.error("POST /api/appointments/validate failed", error);
    return NextResponse.json(
      { error: "Could not look up that appointment." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
