"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getClientIp } from "@/lib/client-ip";
import { consumeRateLimit } from "@/lib/rate-limit";

export type LoginFormState = {
  error?: string;
};

/**
 * Matches the `/sign-in/email` rule in `src/lib/auth.ts`.
 *
 * Better Auth applies its own limiter in the HTTP pipeline, which a server
 * action calling `auth.api.*` never enters — so without this, the form would be
 * the unmetered way in and the metered endpoint beside it would be pointless.
 */
const SIGN_IN_LIMIT = { window: 60, max: 5 };

/**
 * Per account, whatever address the attempts come from, so a password spray
 * spread over many addresses still stops (KNOWN_ISSUES M-01).
 */
const SIGN_IN_EMAIL_LIMIT = { window: 15 * 60, max: 10 };

/**
 * Signs a staff member in and starts a Better Auth session.
 *
 * The password is verified against the hashed credential on the user's
 * `Account` row, and the session cookie is written by the `nextCookies` plugin
 * as this action returns.
 */
export async function signIn(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const requestHeaders = await headers();
  const limit = consumeRateLimit(
    `sign-in:${getClientIp(requestHeaders)}`,
    SIGN_IN_LIMIT,
  );
  if (!limit.allowed) {
    return {
      error: `Too many sign-in attempts. Try again in ${limit.retryAfter} seconds.`,
    };
  }

  const accountLimit = consumeRateLimit(`sign-in-email:${email.toLowerCase()}`, SIGN_IN_EMAIL_LIMIT);

  if (!accountLimit.allowed) {
    return {
      error: `Too many sign-in attempts for this account. Try again in ${Math.ceil(accountLimit.retryAfter / 60)} minutes.`,
    };
  }

  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: requestHeaders,
    });
  } catch (error) {
    // Better Auth already answers an unknown email and a wrong password
    // identically, and this keeps that true: whatever it objected to, the form
    // says the same thing, so the page cannot be used to test which addresses
    // have accounts.
    if (error instanceof APIError) {
      return { error: "Invalid email or password." };
    }

    throw error;
  }

  // `redirect` throws a control-flow exception, so it stays outside the try —
  // inside, the catch above would swallow it and the login would silently
  // appear to fail.
  redirect("/dashboard");
}

/**
 * Ends the session — the `session` row is deleted, not just the cookie, so the
 * token cannot be replayed if it was captured.
 */
export async function signOut(): Promise<void> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch (error) {
    // An expired or already-deleted session throws here. The user asked to be
    // signed out and they are; sending them to /login is the right answer
    // either way.
    if (!(error instanceof APIError)) {
      throw error;
    }
  }

  redirect("/login");
}
