/**
 * Reading the staff session.
 *
 * One place where `auth.api.getSession` is called, so every caller sees the
 * same shape and the same role narrowing. Route handlers and server components
 * should import `getSession` from here rather than reaching for `auth`.
 */
import "server-only";

import { headers } from "next/headers";
import { cache } from "react";

import { Role } from "@/generated/prisma/enums";
import { auth } from "@/lib/auth";

export type StaffSession = {
  userId: string;
  email: string;
  name: string;
  role: Role;
};

/**
 * Narrows the session's `role` to the Prisma enum.
 *
 * Better Auth carries additional fields as plain strings, so what comes back is
 * `string | undefined` however tightly the database column is typed. Anything
 * that isn't exactly ADMIN reads as GUARD: an unrecognised or missing value is
 * a reason to grant less, never more.
 */
function toRole(value: unknown): Role {
  return value === Role.ADMIN ? Role.ADMIN : Role.GUARD;
}

/**
 * The signed-in staff member, or null when nobody is.
 *
 * Wrapped in React's `cache` so the several callers in one request — the
 * dashboard layout and the page it renders both want it — share a single
 * session lookup instead of each making their own round trip. Outside a render
 * (in a route handler) `cache` passes straight through, which is correct: there
 * is one call there anyway.
 */
export const getSession = cache(async function getSession(): Promise<StaffSession | null> {
  const result = await auth.api.getSession({ headers: await headers() });

  if (!result) {
    return null;
  }

  return {
    userId: result.user.id,
    email: result.user.email,
    name: result.user.name,
    role: toRole(result.user.role),
  };
});
