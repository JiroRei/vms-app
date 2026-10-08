import { NextResponse } from "next/server";

// TODO(multi-tenancy): this route can edit any option in the global list. Once
// organizations exist, scope the lookup by the admin's organizationId, or one
// organization's admin will be able to rename or retire another's options.
// See MULTI_TENANCY_TODO.md.

import { requireAdmin } from "@/lib/api-auth";
import { updatePurposeOption } from "@/lib/purposes";

const MAX_LABEL = 80;

/**
 * PATCH /api/purposes/[id] — rename an option, retire it, or bring it back.
 *
 * Admin-only. There is no DELETE on purpose: historical visits reference these
 * rows, so retiring via `isActive` is the only removal there is. The RESTRICT
 * foreign key stops anyone improvising one.
 */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/purposes/[id]">,
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

  const { label, isActive } = (body ?? {}) as Record<string, unknown>;
  const changes: { label?: string; isActive?: boolean } = {};

  if (label !== undefined) {
    const trimmed = typeof label === "string" ? label.trim() : "";

    if (!trimmed) {
      return NextResponse.json(
        { fieldErrors: { label: "Please enter a label." } },
        { status: 400 },
      );
    }

    if (trimmed.length > MAX_LABEL) {
      return NextResponse.json(
        {
          fieldErrors: {
            label: `Please keep this under ${MAX_LABEL} characters.`,
          },
        },
        { status: 400 },
      );
    }

    changes.label = trimmed;
  }

  if (isActive !== undefined) {
    if (typeof isActive !== "boolean") {
      return NextResponse.json(
        { error: "`isActive` must be true or false." },
        { status: 400 },
      );
    }

    changes.isActive = isActive;
  }

  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  try {
    const result = await updatePurposeOption(id, changes);

    if (!result.ok) {
      if (result.reason === "not-found") {
        return NextResponse.json(
          { error: "That purpose no longer exists." },
          { status: 404 },
        );
      }

      return NextResponse.json(
        { fieldErrors: { label: "That purpose already exists." } },
        { status: 409 },
      );
    }

    return NextResponse.json({ option: result.option });
  } catch (error) {
    console.error(`PATCH /api/purposes/${id} failed`, error);
    return NextResponse.json(
      { error: "Could not update that purpose." },
      { status: 500 },
    );
  }
}
