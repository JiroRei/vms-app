/**
 * First line of defence for /dashboard/**: turns requests away before any
 * page or layout renders, including RSC requests (`RSC: 1`) that fetch a page
 * segment without its layout.
 * 
 * 
 *
 * This is an extra layer, not the control. Every dashboard page still calls
 * `requireStaff()` / `requireAdmin()` and every staff data loader checks the
 * session itself (`src/lib/staff-data.ts`), so a misconfigured matcher cannot
 * expose data.
 *
 * - Anonymous (no session cookie): 307 to /login. Presence only, so the
 *   common case costs no database lookup.
 * - Admin-only pages: the session is validated and a guard gets a real 403
 *   before streaming starts. A page-level check alone cannot do that, because
 *   `loading.tsx` makes the dashboard stream a 200 shell first.
 */
import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/lib/auth";

/** Keep in sync with the `requireAdmin()` pages and the APP_MAP access matrix. */
const ADMIN_PAGE_PREFIXES = [
  "/dashboard/hosts",
  "/dashboard/staff",
  "/dashboard/email-log",
  "/dashboard/settings",
] as const;

function isAdminPage(pathname: string): boolean {
  return ADMIN_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function toLogin(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/login", request.url));
}

const FORBIDDEN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Access denied</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#111827"><h1 style="font-size:1.25rem">Access denied</h1><p>This page is for administrators.</p><p><a href="/dashboard">Back to the dashboard</a></p></body></html>`;

export async function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) return toLogin(request);
  if (!isAdminPage(request.nextUrl.pathname)) return NextResponse.next();

  const result = await auth.api.getSession({
    headers: request.headers,
    // Read-only: a proxy response should not be the one that refreshes the
    // session cookie; the page request that follows does that.
    query: { disableRefresh: true },
  });
  if (!result) return toLogin(request);
  if (result.user.role !== "ADMIN") {
    return new NextResponse(FORBIDDEN_HTML, {
      status: 403,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*"],
};
