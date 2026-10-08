import { NextResponse } from "next/server";

// TODO(multi-tenancy): reordering renumbers the whole global list. Once
// organizations exist, scope both the read and the renumbering by the admin's
// organizationId, or moving one option will rewrite every other organization's
// ordering. See MULTI_TENANCY_TODO.md.

import { requireAdmin } from "@/lib/api-auth";
import { movePurposeOption } from "@/lib/purposes";

/**
 * POST /api/purposes/[id]/move — shift an option one place up or down.
 *
 * A dedicated route rather than a `sortOrder` on PATCH: a move is a swap, and
 * letting the client compute both new values means two requests that can
 * interleave and leave the list scrambled. This does the whole reordering in one
 * transaction server-side.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/purposes/[id]/move">,
) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { direction } = (body ?? {}) as Record<string, unknown>;

  if (direction !== "up" && direction !== "down") {
    return NextResponse.json(
      { error: "`direction` must be \"up\" or \"down\"." },
      { status: 400 },
    );
  }

  try {
    const result = await movePurposeOption(id, direction);

    if (result === "not-found") {
      return NextResponse.json(
        { error: "That purpose no longer exists." },
        { status: 404 },
      );
    }

    // Already at the end it was asked to move towards. Nothing changed, and
    // nothing is wrong — the buttons are disabled at the edges anyway.
    if (result === "at-edge") {
      return NextResponse.json({ moved: false });
    }

    return NextResponse.json({ moved: true });
  } catch (error) {
    console.error(`POST /api/purposes/${id}/move failed`, error);
    return NextResponse.json(
      { error: "Could not reorder that purpose." },
      { status: 500 },
    );
  }
}
