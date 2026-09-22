import { NextResponse } from "next/server";

import { createHost } from "@/lib/hosts";
import { getSession } from "@/lib/session";

/**
 * POST /api/hosts — add someone to the host directory.
 *
 * Admin-only. The directory decides who a visitor can ask for at an unattended
 * kiosk, so adding to it is a structural change rather than a shift task — the
 * same reasoning that puts the stale-visit cleanup behind ADMIN.
 */
export async function POST(request: Request) {
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

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { name, department } = (body ?? {}) as Record<string, unknown>;

  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedDepartment =
    typeof department === "string" ? department.trim() : "";

  const fieldErrors: Record<string, string> = {};

  if (!trimmedName) {
    fieldErrors.name = "Please enter the host's name.";
  }

  if (!trimmedDepartment) {
    fieldErrors.department = "Please enter their department.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  try {
    const result = await createHost({
      name: trimmedName,
      department: trimmedDepartment,
    });

    return NextResponse.json({ host: result.host }, { status: 201 });
  } catch (error) {
    console.error("POST /api/hosts failed", error);
    return NextResponse.json(
      { error: "Could not add this host." },
      { status: 500 },
    );
  }
}
