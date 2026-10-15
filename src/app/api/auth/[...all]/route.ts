import { withApi } from "@/lib/api";
import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";
import { CLIENT_IP_HEADER, getClientIp } from "@/lib/client-ip";

/**
 * Better Auth's own endpoints — `/api/auth/sign-in/email`, `/sign-out`,
 * `/get-session`, `/update-user` and the rest.
 *
 * The catch-all mounts all of them at once, which is worth being aware of when
 * changing `src/lib/auth.ts`: an option enabled there becomes a public route
 * here. Sign-up is switched off for exactly that reason, and `role` is marked
 * `input: false` so `/update-user` cannot write it.
 *
 * Only GET and POST are exported; Better Auth uses no other verb, so PATCH,
 * PUT and DELETE fall through to a 405 rather than being silently routed.
 */
const handlers = toNextJsHandler(auth);

/**
 * Better Auth rate-limits by IP, and by default reads it from
 * `X-Forwarded-For`, which a client controls. `src/lib/auth.ts` points it at
 * this header instead, which always holds the address `getClientIp()`
 * resolved; a client-sent copy is overwritten.
 */
function withClientIp(handler: (request: Request) => Promise<Response>) {
  return (request: Request) => {
    const headers = new Headers(request.headers);
    headers.set(CLIENT_IP_HEADER, getClientIp(request.headers));
    // Rebuilt rather than cloned: the body is a stream, which a copy may only
    // take over with `duplex: "half"`.
    const init: RequestInit & { duplex?: "half" } = { method: request.method, headers, signal: request.signal };
    if (request.body) Object.assign(init, { body: request.body, duplex: "half" });
    return handler(new Request(request.url, init));
  };
}

export const GET = withApi(withClientIp(handlers.GET));
export const POST = withApi(withClientIp(handlers.POST));
