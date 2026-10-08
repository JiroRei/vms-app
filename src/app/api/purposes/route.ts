import { NextResponse } from "next/server";

// TODO(multi-tenancy): this route creates options in one global list shared by
// every user of the app. Once organizations exist, stamp the admin's
// organizationId onto the new row and scope the uniqueness check by it — two
// organizations must be able to have their own "Meeting" without colliding.
// See MULTI_TENANCY_TODO.md.

import { requireAdmin } from "@/lib/api-auth";
import { createPurposeOption } from "@/lib/purposes";

const MAX_LABEL = 80;

/**
 * POST /api/purposes — add a purpose option.
 *
 * Admin-only. The settings page hides itself from a guard, but that is not the
 * control: this check is.
 */
export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { label } = (body ?? {}) as Record<string, unknown>;
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

  try {
    const result = await createPurposeOption(trimmed);

    if (!result.ok) {
      return NextResponse.json(
        { fieldErrors: { label: "That purpose already exists." } },
        { status: 409 },
      );
    }

    return NextResponse.json({ option: result.option }, { status: 201 });
  } catch (error) {
    console.error("POST /api/purposes failed", error);
    return NextResponse.json(
      { error: "Could not add that purpose." },
      { status: 500 },
    );
  }
}
