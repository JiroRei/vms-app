import { logger } from "@/lib/logger";
import { withApi } from "@/lib/api";
import { requireAdminApi } from "@/lib/api-auth";
import { NextResponse } from "next/server";

import { createHost } from "@/lib/hosts";

/**
 * POST /api/hosts — add someone to the host directory.
 *
 * Admin-only. The directory decides who a visitor can ask for at an unattended
 * kiosk, so adding to it is a structural change rather than a shift task — the
 * same reasoning that puts the stale-visit cleanup behind ADMIN.
 */
async function POSTHandler(request: Request) {
  await requireAdminApi("Only administrators can change the host directory.");

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { name, department, email } = (body ?? {}) as Record<string, unknown>;

  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedDepartment =
    typeof department === "string" ? department.trim() : "";
  const trimmedEmail = typeof email === "string" ? email.trim() : "";

  const fieldErrors: Record<string, string> = {};

  if (!trimmedName) {
    fieldErrors.name = "Please enter the host's name.";
  }

  if (!trimmedDepartment) {
    fieldErrors.department = "Please enter their department.";
  }
  if (trimmedEmail && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmedEmail)) {
    fieldErrors.email = "Enter a valid host email address or leave it blank.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  try {
    const result = await createHost({
      name: trimmedName,
      department: trimmedDepartment,
      email: trimmedEmail.toLowerCase() || null,
    });

    return NextResponse.json({ host: result.host }, { status: 201 });
  } catch (error) {
    logger.error("POST /api/hosts failed", error);
    return NextResponse.json(
      { error: "Could not add this host." },
      { status: 500 },
    );
  }
}

export const POST = withApi(POSTHandler);
