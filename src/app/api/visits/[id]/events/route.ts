import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { getVisitEvents } from "@/lib/visits";

/**
 * GET /api/visits/[id]/events — one visit's timeline, oldest first.
 *
 * Staff-only, like the rest of the dashboard's reads. Called when a guard
 * expands a row and not before, which is the point of it being its own route:
 * neither the live list nor history carries event histories for rows nobody
 * has opened.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/visits/[id]/events">,
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const timeline = await getVisitEvents(id);

    if (!timeline) {
      return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    }

    return NextResponse.json(timeline);
  } catch (error) {
    console.error(`GET /api/visits/${id}/events failed`, error);
    return NextResponse.json(
      { error: "Failed to load this visit's timeline." },
      { status: 500 },
    );
  }
}
