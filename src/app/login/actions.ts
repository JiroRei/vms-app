"use server";

import { redirect } from "next/navigation";

import {
  createDevSession,
  destroyDevSession,
  verifyDevCredentials,
} from "@/lib/dev-auth";

export type LoginFormState = {
  error?: string;
};

/**
 * TEMP: dev-only auth, replace with Better Auth call.
 *
 * Checks email + password straight against the seeded `User` rows and drops an
 * unsigned session cookie. See `src/lib/auth.ts` for the Better Auth module
 * that supersedes this.
 */
export async function signIn(
  _prevState: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const session = await verifyDevCredentials(email, password);

  if (!session) {
    return { error: "Invalid email or password." };
  }

  await createDevSession(session);

  // `redirect` throws a control-flow exception, so nothing below it runs.
  redirect("/dashboard");
}

// TEMP: dev-only auth, replace with Better Auth call (`auth.api.signOut`).
export async function signOut(): Promise<void> {
  await destroyDevSession();
  redirect("/login");
}
