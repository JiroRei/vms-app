import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { clientIp, consumeRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { MIN_PASSWORD_LENGTH } from "@/lib/staff";

/**
 * Guessing the current password here would be as good as guessing it at the
 * login form, and for the same reason as the login action this route has to
 * bring its own limit: `auth.api.*` called directly never enters the HTTP
 * pipeline that Better Auth's own limiter hooks.
 */
const CHANGE_PASSWORD_LIMIT = { window: 60, max: 5 };

/**
 * POST /api/account/password — change your own password.
 *
 * Anyone signed in, for their own account only: the identity comes from the
 * session, never from the request body, so this cannot be pointed at someone
 * else. Other sessions are revoked, because a password change is usually a
 * response to suspecting one is not yours any more.
 */
export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = consumeRateLimit(
    `change-password:${clientIp(request.headers)}`,
    CHANGE_PASSWORD_LIMIT,
  );

  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { currentPassword, newPassword } = (body ?? {}) as Record<
    string,
    unknown
  >;

  const current = typeof currentPassword === "string" ? currentPassword : "";
  const next = typeof newPassword === "string" ? newPassword : "";

  const fieldErrors: Record<string, string> = {};

  if (!current) {
    fieldErrors.currentPassword = "Enter your current password.";
  }

  if (next.length < MIN_PASSWORD_LENGTH) {
    fieldErrors.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  } else if (next === current) {
    fieldErrors.newPassword = "That is your current password.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return NextResponse.json({ fieldErrors }, { status: 400 });
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: current,
        newPassword: next,
        // Signs out everywhere else. The cookie for *this* request is reissued
        // by the `nextCookies` plugin, so the person doing it stays signed in.
        revokeOtherSessions: true,
      },
      headers: await headers(),
    });

    return NextResponse.json({ changed: true });
  } catch (error) {
    if (error instanceof APIError) {
      // The only thing that realistically lands here is a wrong current
      // password, and it is the one thing worth naming precisely.
      return NextResponse.json(
        { fieldErrors: { currentPassword: "That password is not correct." } },
        { status: 400 },
      );
    }

    console.error("POST /api/account/password failed", error);
    return NextResponse.json(
      { error: "Could not change your password." },
      { status: 500 },
    );
  }
}
