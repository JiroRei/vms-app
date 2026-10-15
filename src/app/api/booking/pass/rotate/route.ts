import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { after, NextResponse } from "next/server";

import { readVisitorClaim } from "@/lib/appointment-access";
import { getClientIp } from "@/lib/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit";
import { emailPass, getActivePass, rotatePass } from "@/lib/visitor-pass";

const LIMIT = { window: 60, max: 5 };

/**
 * POST /api/booking/pass/rotate — "Replace my pass" on the manage page.
 *
 * Only for a visitor signed in with the emailed code (the verified cookie).
 * A manage link from an appointment email is deliberately not enough: it is
 * scoped to one appointment, and a pass is a credential for the whole profile.
 * The old QR stops working at once; the page re-renders the new one, and it is
 * emailed after the response.
 */
async function POSTHandler(request: Request) {
  const limit = consumeRateLimit(`pass-rotate:${getClientIp(request.headers)}`, LIMIT);

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Please wait a moment before replacing your pass again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const claim = await readVisitorClaim();

  if (!claim) {
    return NextResponse.json(
      { error: "Please sign in again to replace your pass." },
      { status: 401 },
    );
  }

  try {
    const active = await getActivePass(claim.profileId);
    const rotated = active ? await rotatePass(active.id) : null;

    if (!rotated) {
      return NextResponse.json(
        { error: "You don't have an active pass to replace." },
        { status: 409 },
      );
    }

    after(() => emailPass(rotated, "replaced"));

    return NextResponse.json({ status: "rotated" });
  } catch (error) {
    logger.error("POST /api/booking/pass/rotate failed", error);
    return NextResponse.json(
      { error: "Could not replace your pass. Please try again." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
