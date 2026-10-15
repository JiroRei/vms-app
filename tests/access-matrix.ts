/**
 * Who may reach each page and API route. `tests/e2e/access-matrix.spec.ts`
 * reads the routes from `src/app` and fails when one is missing here, so a new
 * route cannot ship without someone deciding its access level.
 *
 * Keep in sync with docs/APP_MAP.md (section 8) and `src/proxy.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * - public: anyone (kiosk, booking, login). Only checked for "no 5xx".
 * - staff: any signed-in staff member. Anonymous gets 307 to /login (pages) or 401.
 * - admin: administrators. Anonymous as staff; a guard gets 403.
 * - cron: bearer CRON_SECRET only; a session is not enough (401 for everyone here).
 */
export type Access = "public" | "staff" | "admin" | "cron";

export const PAGE_ACCESS: Record<string, Access> = {
  "/": "public",
  "/privacy": "public",
  "/login": "public",
  "/forgot-password": "public",
  "/reset-password": "public",
  "/check-in": "public",
  "/check-in/appointment": "public",
  "/check-in/walkin": "public",
  "/appointment-booking": "public",
  "/appointment-booking/manage": "public",
  "/dashboard": "staff",
  "/dashboard/account": "staff",
  "/dashboard/appointments": "staff",
  "/dashboard/history": "staff",
  "/dashboard/register": "staff",
  "/dashboard/roll-call": "staff",
  "/dashboard/scan": "staff",
  "/dashboard/visitors": "staff",
  "/dashboard/hosts": "admin",
  "/dashboard/staff": "admin",
  "/dashboard/email-log": "admin",
  "/dashboard/settings/purposes": "admin",
};

/** Keyed "METHOD /path" with the file system's [segment] names. */
export const API_ACCESS: Record<string, Access> = {
  "GET /api/health": "public",
  "GET /api/auth/[...all]": "public",
  "POST /api/auth/[...all]": "public",
  // Kiosk and public booking. Some accept `assisted: true`, which then needs a
  // staff session; that branch is covered by the kiosk tests.
  "POST /api/visits": "public",
  "POST /api/appointments": "public",
  "POST /api/appointments/validate": "public",
  "POST /api/appointments/check-in": "public",
  "POST /api/passes/resolve": "public",
  "POST /api/passes/walk-in": "public",
  "POST /api/kiosk/heartbeat": "public",
  // Visitor self-service, authorised by the visitor's own signed token or cookie.
  "POST /api/booking/lookup": "public",
  "POST /api/booking/verify": "public",
  "POST /api/booking/sign-out": "public",
  "POST /api/booking/pass/verify": "public",
  "POST /api/booking/pass/rotate": "public",
  "POST /api/booking/appointments/[reference]/cancel": "public",
  "POST /api/booking/appointments/[reference]/reschedule": "public",
  // Staff.
  "GET /api/visits": "staff",
  "GET /api/visits/[id]/events": "staff",
  "POST /api/visits/[id]/checkout": "staff",
  "POST /api/visits/[id]/step-out": "staff",
  "POST /api/visits/[id]/return": "staff",
  "GET /api/visits/close-stale": "staff",
  "POST /api/deliveries": "staff",
  "POST /api/appointments/manage": "staff",
  "DELETE /api/appointments/manage/[reference]": "staff",
  "POST /api/appointments/manage/[reference]/check-in": "staff",
  "POST /api/appointments/manage/[reference]/regenerate-qr": "staff",
  "POST /api/appointments/manage/[reference]/reschedule": "staff",
  "POST /api/visitors/[profileId]/pass": "staff",
  "GET /api/dashboard/stats": "staff",
  "GET /api/roll-call": "staff",
  "GET /api/kiosks": "staff",
  "POST /api/account/password": "staff",
  // Administrators.
  "POST /api/visits/close-stale": "admin",
  "GET /api/visits/export": "admin",
  "PATCH /api/kiosks": "admin",
  "POST /api/email-log/retry": "admin",
  "POST /api/hosts": "admin",
  "PATCH /api/hosts/[id]": "admin",
  "POST /api/purposes": "admin",
  "PATCH /api/purposes/[id]": "admin",
  "POST /api/purposes/[id]/move": "admin",
  "POST /api/staff": "admin",
  "PATCH /api/staff/[id]": "admin",
  "DELETE /api/staff/[id]": "admin",
  // Schedulers.
  "POST /api/cron/close-stale-visits": "cron",
  "POST /api/cron/process-email-outbox": "cron",
};

/** Values for dynamic segments: ids that do not exist, so nothing is changed. */
const PLACEHOLDERS: Record<string, string> = {
  "[id]": "access-matrix-missing",
  "[profileId]": "access-matrix-missing",
  "[reference]": "APT-NOPE00",
  "[...all]": "get-session",
};

export type DiscoveredRoute = { kind: "page" | "api"; key: string; method: string; pattern: string; url: string };

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** Every page and every exported route-handler method under `src/app`. */
export function discoverRoutes(root = process.cwd()): DiscoveredRoute[] {
  const app = join(root, "src", "app");
  const routes: DiscoveredRoute[] = [];
  for (const file of walk(app)) {
    const name = file.split(sep).pop();
    if (name !== "page.tsx" && name !== "route.ts") continue;
    const segments = relative(app, file).split(sep).slice(0, -1).filter((segment) => !/^\(.*\)$/.test(segment));
    const pattern = "/" + segments.join("/");
    const url = "/" + segments.map((segment) => PLACEHOLDERS[segment] ?? segment).join("/");
    if (segments.some((segment) => segment.startsWith("[") && !PLACEHOLDERS[segment])) {
      throw new Error(`No placeholder for a dynamic segment in ${pattern}; add one to tests/access-matrix.ts.`);
    }
    if (name === "page.tsx") {
      routes.push({ kind: "page", key: pattern === "/" ? "/" : pattern, method: "GET", pattern, url: url === "/" ? "/" : url });
      continue;
    }
    const source = readFileSync(file, "utf8");
    const methods = [...source.matchAll(/export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1]);
    if (!methods.length) throw new Error(`${pattern} has a route.ts with no exported method.`);
    for (const method of methods) routes.push({ kind: "api", key: `${method} ${pattern}`, method, pattern, url });
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

export function accessOf(route: DiscoveredRoute): Access | undefined {
  return route.kind === "page" ? PAGE_ACCESS[route.key] : API_ACCESS[route.key];
}
