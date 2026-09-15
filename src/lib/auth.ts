/**
 * Better Auth configuration — SCAFFOLDED BUT NOT ACTIVE.
 *
 * This module is intentionally self-contained and is not imported anywhere in
 * the app yet. The login flow currently runs on the throwaway credential check
 * in `src/lib/dev-auth.ts`.
 *
 * To switch Better Auth on later:
 *   1. Add `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` to `.env`.
 *   2. Create the route handler `src/app/api/auth/[...all]/route.ts`:
 *        import { toNextJsHandler } from "better-auth/next-js";
 *        import { auth } from "@/lib/auth";
 *        export const { GET, POST } = toNextJsHandler(auth);
 *   3. Seed real credentials via `auth.api.signUpEmail(...)` so each user gets
 *      an `Account` row with a hashed password (the `User.password` column used
 *      by the dev login is not read by Better Auth).
 *   4. Replace the `signIn` action in `src/app/login/actions.ts` with
 *      `auth.api.signInEmail({ body: { email, password }, headers })`, and
 *      replace `getDevSession()` in `src/lib/dev-auth.ts` with
 *      `auth.api.getSession({ headers: await headers() })`.
 *   5. Delete `src/lib/dev-auth.ts`, the `password` field on `User`, and
 *      migrate.
 */
import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { prisma } from "@/lib/prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      // Mirrors the `Role` enum on the Prisma `User` model so the role travels
      // on the Better Auth session once it is active.
      role: {
        type: "string",
        required: false,
        defaultValue: "GUARD",
        input: false,
      },
    },
  },
});

export type Auth = typeof auth;
