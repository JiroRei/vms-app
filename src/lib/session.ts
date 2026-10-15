/**
 * Reading the staff session.
 *
 * One place where `auth.api.getSession` is called, so every caller sees the
 * same shape and the same role narrowing. Route handlers and server components
 * should import `getSession` from here rather than reaching for `auth`.
 */
import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
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

/**
 * The signed-in staff member, or a redirect to /login.
 *
 * Call this at the top of every dashboard page and in every function that
 * loads staff-only data (see `src/lib/staff-data.ts`). The dashboard layout's
 * own check is for the visual shell only: Next.js renders a page in parallel
 * with its layout, and an RSC request (`RSC: 1`) can fetch a page segment
 * without the layout at all, so a check that lives only in the layout does
 * not protect the page's data (KNOWN_ISSUES B-01).
 *
 * `redirect` throws, so nothing after this call runs for an anonymous request.
 */
export async function requireStaff(): Promise<StaffSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * The signed-in administrator. Anonymous callers go to /login; guards go back
 * to /dashboard before any admin data is read.
 *
 * `src/proxy.ts` already answers guards with a real 403 before rendering
 * starts; this is the check next to the data, for when the proxy is bypassed
 * or misconfigured.
 */
export async function requireAdmin(): Promise<StaffSession> {
  const session = await requireStaff();
  if (session.role !== Role.ADMIN) redirect("/dashboard");
  return session;
}
