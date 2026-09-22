import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { checkOutVisit } from "@/lib/visits";

/** POST /api/visits/[id]/checkout — stamp `checkOutTime` on an active visit. */
export async function POST(
  _request: Request,
  context: RouteContext<"/api/visits/[id]/checkout">,
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const { result, checkOutTime } = await checkOutVisit(id);

    if (result === "not-found") {
      return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    }

    if (result === "already-checked-out") {
      // A double-click or a second guard got here first. The caller's intent is
      // already satisfied, so this is a conflict rather than a failure.
      return NextResponse.json(
        { error: "This visit is already checked out." },
        { status: 409 },
      );
    }

    return NextResponse.json({ id, checkOutTime });
  } catch (error) {
    console.error(`POST /api/visits/${id}/checkout failed`, error);
    return NextResponse.json(
      { error: "Failed to check out this visit." },
      { status: 500 },
    );
  }
}
