import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { closeStaleVisits } from "@/lib/stale-visits";

/**
 * POST /api/cron/close-stale — run the overnight cleanup from a scheduler.
 *
 * The dashboard button and this route call the same `closeStaleVisits()`, which
 * has always been parameterless and session-free precisely so a scheduled job
 * could call it. This is that job's door.
 *
 * It is not session-authenticated, because a scheduler has no session. It is
 * authenticated by a shared secret instead, and it is **closed unless that
 * secret is configured** — an unset `CRON_SECRET` gives 503, never an open
 * endpoint that empties the live list.
 */

/** Compares without leaking, through timing, how much of the token matched. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);

  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal, so length is checked first and deliberately not hidden:
  // the length of a secret is not the secret.
  if (a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return NextResponse.json(
      {
        error:
          "Scheduled cleanup is not configured. Set CRON_SECRET to enable it.",
      },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!provided || !tokenMatches(provided, expected)) {
    // No detail: a scheduler knows whether it has the right token, and anyone
    // else learns nothing from the difference between wrong and missing.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { closed } = await closeStaleVisits();

    // Logged because nothing else will see it — this runs with nobody watching,
    // and "the cleanup has been silently failing for a week" is the failure
    // mode worth making noisy.
    console.log(`[cron] close-stale closed ${closed} visit(s)`);

    return NextResponse.json({ closed });
  } catch (error) {
    console.error("POST /api/cron/close-stale failed", error);
    return NextResponse.json(
      { error: "Failed to close stale visits." },
      { status: 500 },
    );
  }
}
