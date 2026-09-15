/**
 * ============================================================================
 * TEMP: dev-only auth. DELETE THIS FILE once Better Auth is switched on.
 * ============================================================================
 *
 * This is throwaway session handling for local development and testing:
 *   - Credentials are compared against `User.password` in PLAINTEXT.
 *   - The session cookie is an unsigned, unencrypted JSON blob, so anyone can
 *     forge one and claim any role.
 *
 * Neither is acceptable outside a dev box. The real implementation is already
 * scaffolded in `src/lib/auth.ts` — see the switch-on steps there.
 */
import "server-only";

import { cookies } from "next/headers";

import type { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

// TEMP: dev-only auth, replace with Better Auth call.
export const DEV_SESSION_COOKIE = "vms_dev_session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8; // 8 hours

export type DevSession = {
  userId: string;
  email: string;
  name: string;
  role: Role;
};

/**
 * TEMP: dev-only auth, replace with Better Auth call
 * (`auth.api.signInEmail({ body: { email, password }, headers })`).
 *
 * Plaintext comparison against the seeded `User.password` column.
 */
export async function verifyDevCredentials(
  email: string,
  password: string,
): Promise<DevSession | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });

  // TEMP: plaintext comparison — Better Auth will hash/verify via `Account`.
  if (!user || user.password !== password) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

/**
 * TEMP: dev-only auth, replace with Better Auth call.
 * Writes the session as plain JSON — no signing, no encryption.
 */
export async function createDevSession(session: DevSession): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(DEV_SESSION_COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: "lax",
    // Dev runs over http, so `secure` would stop the cookie being stored.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * TEMP: dev-only auth, replace with Better Auth call
 * (`auth.api.getSession({ headers: await headers() })`).
 *
 * Returns the current session, or `null` when nobody is logged in.
 */
export async function getDevSession(): Promise<DevSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(DEV_SESSION_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DevSession>;

    if (!parsed.userId || !parsed.email || !parsed.role) {
      return null;
    }

    return parsed as DevSession;
  } catch {
    // Malformed cookie — treat as logged out.
    return null;
  }
}

/**
 * TEMP: dev-only auth, replace with Better Auth call
 * (`auth.api.signOut({ headers })`).
 */
export async function destroyDevSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(DEV_SESSION_COOKIE);
}
