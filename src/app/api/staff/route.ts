import { NextResponse } from "next/server";

import { Role } from "@/generated/prisma/enums";
import { getSession } from "@/lib/session";
import { createStaff, MIN_PASSWORD_LENGTH } from "@/lib/staff";

/**
 * POST /api/staff — create a dashboard login.
 *
 * Admin-only, and the only way an account is made now that the seed is not the
 * only door. Public sign-up stays switched off: this is an administrator
 * issuing a credential, not a stranger claiming one.
 */
export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== Role.ADMIN) {
    return NextResponse.json(
      { error: "Only administrators can manage staff accounts." },
      { status: 403 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { email, name, role, password } = (body ?? {}) as Record<
    string,
    unknown
  >;

  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const rawPassword = typeof password === "string" ? password : "";

  const fieldErrors: Record<string, string> = {};

  // Deliberately permissive: the point is to catch a typo, not to adjudicate
  // what a valid address is. Better Auth does the real parse at sign-in.
  if (!trimmedEmail || !/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
    fieldErrors.email = "Please enter a valid email address.";
  }

  if (!trimmedName) {
    fieldErrors.name = "Please enter their name.";
  }

  if (rawPassword.length < MIN_PASSWORD_LENGTH) {
    fieldErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  if (role !== Role.ADMIN && role !== Role.GUARD) {
    fieldErrors.role = "Please choose a role.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  try {
    const result = await createStaff({
      email: trimmedEmail,
      name: trimmedName,
      role: role as Role,
      password: rawPassword,
    });

    if (result.status === "email-taken") {
      return NextResponse.json(
        { fieldErrors: { email: "That email already has an account." } },
        { status: 409 },
      );
    }

    return NextResponse.json({ staff: result.staff }, { status: 201 });
  } catch (error) {
    console.error("POST /api/staff failed", error);
    return NextResponse.json(
      { error: "Could not create this account." },
      { status: 500 },
    );
  }
}
