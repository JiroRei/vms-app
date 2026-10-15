/**
 * Access matrix (KNOWN_ISSUES B-01): every page and API route under src/app,
 * requested as an anonymous caller in three ways (a browser document request,
 * an RSC request with `RSC: 1` and `Next-Router-State-Tree`, and a plain fetch
 * with no cookies), as a guard and as an administrator.
 *
 * The route list comes from the file system (`tests/access-matrix.ts`), so a
 * new route is covered automatically, and the test fails until it is given an
 * access level there.
 *
 * Set ACCESS_MATRIX_REPORT_ONLY=1 (and E2E_BASE_URL) to record the matrix of
 * an older build without asserting; the observed matrix is written to
 * ACCESS_MATRIX_OUT (default test-results/access-matrix.json).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test } from "@playwright/test";

import { accessOf, discoverRoutes, type Access, type DiscoveredRoute } from "../access-matrix";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
const REPORT_ONLY = process.env.ACCESS_MATRIX_REPORT_ONLY === "1";
const OUT = process.env.ACCESS_MATRIX_OUT ?? "test-results/access-matrix.json";
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? "E2ePassword123!";
const GUARD = process.env.ACCESS_MATRIX_GUARD ?? "guard@e2e.invalid";
const ADMIN = process.env.ACCESS_MATRIX_ADMIN ?? "admin@e2e.invalid";

/** Strings only seeded staff-only data contains (prisma/seed-e2e.ts). */
const DATA_MARKERS = (process.env.ACCESS_MATRIX_MARKERS ?? "@e2e.invalid|APT-E2E001|09170000000|11111111-1111-4111-8111-111111111111|Seeded|Stale").split("|");

type Variant = "document" | "rsc" | "fetch";
type Caller = { name: "anonymous" | "guard" | "admin"; cookie: string | null };
type Observation = { status: number; location: string | null; leaked: string[] };

/** The router state an RSC navigation to `url` sends. */
function routerStateTree(url: string): string {
  const segments = url.split("/").filter(Boolean);
  let tree: unknown = ["__PAGE__", {}];
  for (const segment of [...segments].reverse()) tree = [segment, { children: tree }];
  return encodeURIComponent(JSON.stringify(["", { children: tree }, null, null]));
}

async function call(route: DiscoveredRoute, caller: Caller, variant: Variant): Promise<Observation> {
  const headers: Record<string, string> = { Origin: BASE };
  let url = BASE + route.url;
  if (variant === "document") headers.Accept = "text/html,application/xhtml+xml";
  if (variant === "rsc") {
    headers.RSC = "1";
    headers["Next-Router-State-Tree"] = routerStateTree(route.url);
    headers["Next-Url"] = route.url;
    url += "?_rsc=accessmatrix";
  }
  if (caller.cookie) headers.Cookie = caller.cookie;
  const init: RequestInit = { method: route.method, headers, redirect: "manual" };
  if (route.method !== "GET") {
    headers["Content-Type"] = "application/json";
    init.body = "{}";
  }
  let response = await fetch(url, init);
  // Next answers an RSC request whose `_rsc` value does not match with a
  // redirect to the corrected value; a client follows it with the same
  // headers, so this does too. A redirect to /login is the answer itself.
  for (let hop = 0; variant === "rsc" && hop < 2 && response.status >= 300 && response.status < 400; hop++) {
    const next = response.headers.get("location");
    if (!next || /\/login\b/.test(next) || new URL(next, BASE).pathname !== new URL(url).pathname) break;
    url = new URL(next, BASE).toString();
    response = await fetch(url, init);
  }
  const body = await response.text();
  return {
    status: response.status,
    location: response.headers.get("location") ?? response.headers.get("x-nextjs-redirect") ?? response.headers.get("x-action-redirect"),
    leaked: DATA_MARKERS.filter((marker) => body.includes(marker)),
  };
}

async function signIn(email: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status, `sign-in as ${email}`).toBe(200);
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

const toLogin = (o: Observation) => o.status >= 300 && o.status < 400 && /\/login\b/.test(o.location ?? "");

/** The rule for one cell, as a list of failures (empty when it holds). */
function check(access: Access, route: DiscoveredRoute, caller: Caller["name"], variant: Variant, o: Observation): string[] {
  const failures: string[] = [];
  const where = `${route.key} as ${caller} (${variant}): ${o.status}${o.location ? ` -> ${o.location}` : ""}`;
  if (o.status >= 500) failures.push(`${where}: server error`);
  if (access === "public") return failures;
  const forbiddenForCaller = caller === "anonymous" || access === "cron" || (access === "admin" && caller === "guard");
  if (forbiddenForCaller && o.leaked.length) failures.push(`${where}: body contains ${o.leaked.join(", ")}`);
  if (access === "cron") {
    if (o.status !== 401) failures.push(`${where}: expected 401 without the cron bearer token`);
    return failures;
  }
  if (caller === "anonymous") {
    const ok = route.kind === "page" ? toLogin(o) || o.status === 401 || o.status === 403 : o.status === 401;
    if (!ok) failures.push(`${where}: expected ${route.kind === "page" ? "a redirect to /login" : "401"}`);
  } else if (access === "admin" && caller === "guard") {
    if (o.status !== 403) failures.push(`${where}: expected 403`);
  } else if (o.status === 401 || o.status === 403 || toLogin(o)) {
    failures.push(`${where}: ${caller} was refused`);
  } else if (route.kind === "page" && o.status !== 200) {
    failures.push(`${where}: expected 200`);
  }
  return failures;
}

test("every route is classified", () => {
  const routes = discoverRoutes();
  const unclassified = routes.filter((route) => !accessOf(route)).map((route) => route.key);
  expect(unclassified, "add these to tests/access-matrix.ts").toEqual([]);
});

test("access matrix: anonymous, guard and admin", async () => {
  test.setTimeout(300_000);
  const routes = discoverRoutes();
  const callers: Caller[] = [
    { name: "anonymous", cookie: null },
    { name: "guard", cookie: await signIn(GUARD) },
    { name: "admin", cookie: await signIn(ADMIN) },
  ];
  const matrix: Record<string, Record<string, Observation>> = {};
  const failures: string[] = [];
  for (const route of routes) {
    const access = accessOf(route) ?? "staff";
    matrix[route.key] = {};
    for (const caller of callers) {
      const variants: Variant[] = caller.name === "anonymous" ? ["document", "rsc", "fetch"] : route.kind === "page" ? ["document", "rsc"] : ["fetch"];
      for (const variant of variants) {
        const observed = await call(route, caller, variant);
        matrix[route.key][`${caller.name}:${variant}`] = observed;
        failures.push(...check(access, route, caller.name, variant, observed));
      }
    }
  }
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), access: Object.fromEntries(routes.map((r) => [r.key, accessOf(r) ?? null])), matrix }, null, 1));
  if (!REPORT_ONLY) expect(failures, failures.join("\n")).toEqual([]);
});
