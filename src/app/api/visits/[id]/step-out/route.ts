import { NextResponse } from "next/server";

// TEMP: dev-only auth, replace with Better Auth call.
import { getDevSession } from "@/lib/dev-auth";
import { markVisitReturning } from "@/lib/visits";

/**
 * POST /api/visits/[id]/step-out — the visitor is leaving but coming back today.
 *
 * The counterpart to `/checkout`: it stamps `exitTime` and moves the visit to
 * PENDING_RETURN, leaving `checkOutTime` null so the visit stays open and can
 * be resumed through `/return`.
 */
export async function POST(
  _request: Request,
  context: RouteContext<"/api/visits/[id]/step-out">,
) {
  // TEMP: dev-only auth, replace with Better Auth call.
  const session = await getDevSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const { result, exitTime } = await markVisitReturning(id);

    if (result === "not-found") {
      return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    }

    // Both conflicts mean someone else already moved this visit on. The caller
    // is out of date rather than wrong, so the client reconciles instead of
    // surfacing a failure.
    if (result === "already-stepped-out") {
      return NextResponse.json(
        { error: "This visitor is already marked as returning." },
        { status: 409 },
      );
    }

    if (result === "already-checked-out") {
      return NextResponse.json(
        { error: "This visit is already checked out." },
        { status: 409 },
      );
    }

    return NextResponse.json({ id, exitTime });
  } catch (error) {
    console.error(`POST /api/visits/${id}/step-out failed`, error);
    return NextResponse.json(
      { error: "Failed to mark this visitor as returning." },
      { status: 500 },
    );
  }
}
