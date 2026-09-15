import { NextResponse } from "next/server";

// TEMP: dev-only auth, replace with Better Auth call.
import { getDevSession } from "@/lib/dev-auth";
import { closeStaleVisits, countStaleVisits } from "@/lib/stale-visits";

/**
 * GET /api/visits/close-stale — how many visits the cleanup would close.
 *
 * Lets the dashboard put a real number in the confirmation dialog rather than
 * asking the user to approve an unknown quantity.
 */
export async function GET() {
  // TEMP: dev-only auth, replace with Better Auth call.
  const session = await getDevSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json({ staleCount: await countStaleVisits() });
  } catch (error) {
    console.error("GET /api/visits/close-stale failed", error);
    return NextResponse.json(
      { error: "Failed to count stale visits." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/visits/close-stale — close visits left open from a previous day.
 *
 * Admin-only: this rewrites historical records in bulk, which is not something
 * a guard on shift should be able to trigger.
 *
 * The work itself lives in `closeStaleVisits()`, which takes no request context
 * — a scheduled job can call it directly without going through this route.
 */
export async function POST() {
  // TEMP: dev-only auth, replace with Better Auth call.
  const session = await getDevSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only administrators can close stale visits." },
      { status: 403 },
    );
  }

  try {
    const { closed } = await closeStaleVisits();
    return NextResponse.json({ closed });
  } catch (error) {
    console.error("POST /api/visits/close-stale failed", error);
    return NextResponse.json(
      { error: "Failed to close stale visits." },
      { status: 500 },
    );
  }
}
