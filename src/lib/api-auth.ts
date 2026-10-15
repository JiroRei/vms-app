import "server-only";

import { Role } from "@/generated/prisma/enums";
import { ApiError } from "@/lib/api";
import { getSession, type StaffSession } from "@/lib/session";

/**
 * The route-handler counterparts of `requireStaff()` / `requireAdmin()` in
 * `src/lib/session.ts`. A JSON API should answer 401/403 rather than redirect,
 * so these throw an `ApiError` that `withApi` turns into that response.
 *
 * Lives here rather than in a route file because Next only allows HTTP method
 * handlers and a handful of config options to be exported from `route.ts`; an
 * extra export is a build error.
 *
 * Call one at the top of every staff route, before reading the body or the
 * database: `const session = await requireStaffApi();`.
 */
export async function requireStaffApi(): Promise<StaffSession> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "UNAUTHORIZED", "Please sign in.");
  return session;
}

/** As `requireStaffApi`, and a 403 for a signed-in guard. */
export async function requireAdminApi(
  message = "Only administrators can do that.",
): Promise<StaffSession> {
  const session = await requireStaffApi();
  if (session.role !== Role.ADMIN) {
    throw new ApiError(403, "FORBIDDEN", message);
  }
  return session;
}
