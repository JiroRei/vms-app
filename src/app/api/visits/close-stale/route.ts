import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { requireAdminApi, requireStaffApi } from "@/lib/api-auth";
import { NextResponse } from "next/server";

import { loadStaleVisitCount } from "@/lib/staff-data";
import { closeStaleVisits } from "@/lib/stale-visits";

/**
 * GET /api/visits/close-stale — how many visits the cleanup would close.
 *
 * Lets the dashboard put a real number in the confirmation dialog rather than
 * asking the user to approve an unknown quantity.
 */
async function GETHandler() {
  await requireStaffApi();

  try {
    return NextResponse.json({ staleCount: await loadStaleVisitCount() });
  } catch (error) {
    logger.error("GET /api/visits/close-stale failed", error);
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
async function POSTHandler() {
  await requireAdminApi("Only administrators can close stale visits.");

  try {
    const { closed } = await closeStaleVisits();
    return NextResponse.json({ closed });
  } catch (error) {
    logger.error("POST /api/visits/close-stale failed", error);
    return NextResponse.json(
      { error: "Failed to close stale visits." },
      { status: 500 },
    );
  }
}

export const GET = withApi(GETHandler);
export const POST = withApi(POSTHandler);
