import { NextResponse } from "next/server";

import { updateHost } from "@/lib/hosts";
import { getSession } from "@/lib/session";

/**
 * PATCH /api/hosts/[id] — rename a host, move their department, or switch them
 * off.
 *
 * Admin-only, and deliberately the only way a host ever leaves. There is no
 * DELETE on this route: `Visitor.hostId` cascades, so deleting the row would
 * take every visitor the host ever received — and every one of those visits —
 * out of the history with it. `active: false` removes them from the kiosk and
 * keeps the record.
 */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/hosts/[id]">,
) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only administrators can change the host directory." },
      { status: 403 },
    );
  }

  const { id } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { name, department, active } = (body ?? {}) as Record<string, unknown>;

  const fieldErrors: Record<string, string> = {};
  const patch: { name?: string; department?: string; active?: boolean } = {};

  // Each field is optional, but a field that *is* sent has to be usable —
  // sending an empty name must not blank out the directory entry.
  if (name !== undefined) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) {
      fieldErrors.name = "Please enter the host's name.";
    } else {
      patch.name = trimmed;
    }
  }

  if (department !== undefined) {
    const trimmed = typeof department === "string" ? department.trim() : "";
    if (!trimmed) {
      fieldErrors.department = "Please enter their department.";
    } else {
      patch.department = trimmed;
    }
  }

  if (active !== undefined) {
    if (typeof active !== "boolean") {
      return NextResponse.json(
        { error: "`active` must be true or false." },
        { status: 400 },
      );
    }
    patch.active = active;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Nothing to change." },
      { status: 400 },
    );
  }

  try {
    const result = await updateHost(id, patch);

    if (result.status === "not-found") {
      return NextResponse.json({ error: "Host not found." }, { status: 404 });
    }

    return NextResponse.json({ host: result.host });
  } catch (error) {
    console.error(`PATCH /api/hosts/${id} failed`, error);
    return NextResponse.json(
      { error: "Could not update this host." },
      { status: 500 },
    );
  }
}
