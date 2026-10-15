import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { requireStaffApi } from "@/lib/api-auth";
import { NextResponse } from "next/server";

import { loadVisitEvents } from "@/lib/staff-data";

/**
 * GET /api/visits/[id]/events — one visit's timeline, oldest first.
 *
 * Staff-only, like the rest of the dashboard's reads. Called when a guard
 * expands a row and not before, which is the point of it being its own route:
 * neither the live list nor history carries event histories for rows nobody
 * has opened.
 */
async function GETHandler(
  _request: Request,
  context: RouteContext<"/api/visits/[id]/events">,
) {
  await requireStaffApi();

  const { id } = await context.params;

  try {
    const timeline = await loadVisitEvents(id);

    if (!timeline) {
      return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    }

    return NextResponse.json(timeline);
  } catch (error) {
    logger.error(`GET /api/visits/${id}/events failed`, error);
    return NextResponse.json(
      { error: "Failed to load this visit's timeline." },
      { status: 500 },
    );
  }
}

export const GET = withApi(GETHandler);
