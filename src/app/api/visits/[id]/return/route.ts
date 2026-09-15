import { NextResponse } from "next/server";

// TEMP: dev-only auth, replace with Better Auth call.
import { getDevSession } from "@/lib/dev-auth";
import { markVisitReturned } from "@/lib/visits";

/**
 * POST /api/visits/[id]/return — the visitor came back.
 *
 * Resumes the same Visit: status back to ACTIVE and `exitTime` cleared. No new
 * visit is created, so the day still reads as one visit in history.
 */
export async function POST(
  _request: Request,
  context: RouteContext<"/api/visits/[id]/return">,
) {
  // TEMP: dev-only auth, replace with Better Auth call.
  const session = await getDevSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const { result } = await markVisitReturned(id);

    if (result === "not-found") {
      return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    }

    // Already back on the floor — a double-click, or another guard got here
    // first. The caller's intent is satisfied either way.
    if (result === "already-active") {
      return NextResponse.json(
        { error: "This visitor is already checked in." },
        { status: 409 },
      );
    }

    if (result === "already-checked-out") {
      return NextResponse.json(
        { error: "This visit is already checked out." },
        { status: 409 },
      );
    }

    return NextResponse.json({ id, status: "ACTIVE" });
  } catch (error) {
    console.error(`POST /api/visits/${id}/return failed`, error);
    return NextResponse.json(
      { error: "Failed to mark this visitor as returned." },
      { status: 500 },
    );
  }
}
