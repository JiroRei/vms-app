import "server-only";

import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";

/**
 * Turns "must be an admin" into a response, or `null` to carry on.
 *
 * Lives here rather than in a route file because Next only allows HTTP method
 * handlers and a handful of config options to be exported from `route.ts`; an
 * extra export is a build error.
 *
 * Returning the refusal rather than throwing keeps each route's happy path flat:
 * `const denied = await requireAdmin(); if (denied) return denied;`.
 */
export async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only administrators can do that." },
      { status: 403 },
    );
  }

  return null;
}
