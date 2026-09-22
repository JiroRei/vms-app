import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { clientIp, consumeRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import {
  createDeliveryVisit,
  createWalkInVisit,
  getActiveVisits,
} from "@/lib/visits";

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
 * POST /api/visits — check someone in at the kiosk.
 *
 * `type` selects the flow: "GUEST" (default) is a walk-in and needs a purpose
 * and a host; "DELIVERY" is a courier drop-off and needs only a name, since the
 * recipient department is optional.
 *
 * Deliberately unauthenticated: the kiosk is a public, unattended terminal.
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

  const { name, purpose, hostId, type } = (body ?? {}) as Record<
    string,
    unknown
  >;

  const isDelivery = type === "DELIVERY";
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedPurpose = typeof purpose === "string" ? purpose.trim() : "";
  const selectedHostId = typeof hostId === "string" ? hostId : "";

  const fieldErrors: Record<string, string> = {};

  if (!trimmedName) {
    fieldErrors.name = isDelivery
      ? "Please enter the courier or company name."
      : "Please enter your name.";
  }

  if (!isDelivery) {
    if (!trimmedPurpose) {
      fieldErrors.purpose = "Please enter your purpose of visit.";
    }
    if (!selectedHostId) {
      fieldErrors.hostId = "Please select who you are here to see.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  try {
    // Checked up front so an unknown host is a 400 rather than a foreign-key 500.
    // A delivery may legitimately arrive without one.
    if (selectedHostId) {
      const host = await prisma.host.findUnique({
        where: { id: selectedHostId },
        select: { id: true },
      });

      if (!host) {
        return NextResponse.json(
          {
            fieldErrors: {
              hostId: isDelivery
                ? "That department is no longer available."
                : "That host is no longer available.",
            },
          },
          { status: 400 },
        );
      }
    }

    const created = isDelivery
      ? await createDeliveryVisit({
          name: trimmedName,
          hostId: selectedHostId || null,
        })
      : await createWalkInVisit({
          name: trimmedName,
          purpose: trimmedPurpose,
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
