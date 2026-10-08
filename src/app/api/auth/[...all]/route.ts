import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

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
export const { GET, POST } = toNextJsHandler(auth);
