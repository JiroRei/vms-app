import { NextResponse } from "next/server";

import { parseNameParts } from "@/lib/names";
import { prisma } from "@/lib/prisma";
import { findSelectablePurpose } from "@/lib/purposes";
import { clientIp, consumeRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { createWalkInVisit, getActiveVisits } from "@/lib/visits";

/**
 * Sized for the busiest single kiosk rather than for one visitor: every check-in
 * from a terminal shares one address, so this has to clear a queue at the door
 * while still being far below what a script would need.
 */
const CHECK_IN_LIMIT = { window: 60, max: 20 };

/**
 * GET /api/visits — active (not yet checked out) visits.
 *
 * Staff-only: this returns visitor names and purposes, so it requires the
 * dashboard session. The kiosk never calls it.
 */
export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const visits = await getActiveVisits();
    return NextResponse.json({ visits });
  } catch (error) {
    console.error("GET /api/visits failed", error);
    return NextResponse.json(
      { error: "Failed to load active visits." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/visits — check a walk-in visitor in at the kiosk.
 *
 * Deliberately unauthenticated: the kiosk is a public, unattended terminal.
 * That is also why deliveries are not accepted here — a courier drop-off is
 * logged by a guard through `POST /api/deliveries`, which requires a session.
 *
 * That makes it the one write endpoint anyone on the network can call, so it is
 * rate limited — generously, because a whole tour group checking in one after
 * another is normal and must not be turned away.
 */
export async function POST(request: Request) {
  const limit = consumeRateLimit(
    `check-in:${clientIp(request.headers)}`,
    CHECK_IN_LIMIT,
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
  const { purposeId, hostId } = fields;

  const name = parseNameParts(fields);
  const selectedPurposeId = typeof purposeId === "string" ? purposeId : "";
  const selectedHostId = typeof hostId === "string" ? hostId : "";

  const fieldErrors: Record<string, string> = name.ok ? {} : { ...name.errors };

  if (!selectedPurposeId) {
    fieldErrors.purposeId = "Please choose your purpose of visit.";
  }

  if (!selectedHostId) {
    fieldErrors.hostId = "Please select who you are here to see.";
  }

  if (!name.ok || Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  try {
    // Both checked up front so an unknown id is a 400 rather than a
    // foreign-key 500. The purpose check also rejects a retired option, which a
    // kiosk page rendered before the admin retired it would still be offering.
    const [host, purpose] = await Promise.all([
      prisma.host.findFirst({
        where: { id: selectedHostId, active: true },
        select: { id: true },
      }),
      findSelectablePurpose(selectedPurposeId),
    ]);

    if (!host) {
      return NextResponse.json(
        { fieldErrors: { hostId: "That host is no longer available." } },
        { status: 400 },
      );
    }

    if (!purpose) {
      return NextResponse.json(
        { fieldErrors: { purposeId: "That purpose is no longer available." } },
        { status: 400 },
      );
    }

    const created = await createWalkInVisit({
      firstName: name.firstName,
      lastName: name.lastName,
      purposeId: purpose.id,
      hostId: selectedHostId,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("POST /api/visits failed", error);
    return NextResponse.json(
      { error: "Could not complete check-in. Please ask reception for help." },
      { status: 500 },
    );
  }
}
