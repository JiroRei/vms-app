/**
 * Better Auth configuration — the real session layer.
 *
 * Sessions are rows in the `session` table, keyed by a signed cookie. Nothing
 * about the caller's identity travels in the cookie itself, so a user whose row
 * is deleted loses access on their next request rather than whenever a cached
 * copy happens to expire.
 *
 * Read sessions through `src/lib/session.ts` rather than calling
 * `auth.api.getSession` directly — it dedupes the lookup within a render and
 * narrows `role` to the Prisma enum.
 */
import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { prisma } from "@/lib/prisma";

/** 8 hours — a shift, matching the session lifetime the dev login used. */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    // Postgres supports transactions, so let the adapter use them: sign-in
    // writes a session row and touches the user in one unit rather than
    // leaving a half-applied pair behind if the second write fails.
    transaction: true,
  }),

  emailAndPassword: {
    enabled: true,

    // The catch-all route at `/api/auth/[...all]` mounts every Better Auth
    // endpoint, and that includes `POST /api/auth/sign-up/email`. This app has
    // no public registration — staff accounts come from the seed or an admin —
    // so leaving it open would let anyone self-issue a GUARD account with
    // dashboard access. Accounts are created by `prisma/seed.ts` instead.
    disableSignUp: true,
  },

  user: {
    additionalFields: {
      // Mirrors the `Role` enum on the Prisma `User` model so the role travels
      // on the session and the API can gate on it without a second query.
      //
      // `input: false` is the security-relevant half: it strips `role` from
      // anything a client can send, so the mounted `POST /api/auth/update-user`
      // cannot be used by a guard to promote themselves to ADMIN.
      role: {
        type: "string",
        required: false,
        defaultValue: "GUARD",
        input: false,
      },
    },
  },

  session: {
    expiresIn: SESSION_MAX_AGE_SECONDS,
    // How stale a session row may get before a request refreshes its expiry.
    // The default is a day, which would never fire inside an 8-hour session and
    // would log a guard out mid-shift exactly 8 hours after they signed in.
    updateAge: 60 * 60,
  },

  rateLimit: {
    // Better Auth only rate-limits in production by default. Turning it on
    // everywhere means the limit is exercised in development too, rather than
    // being first tried in production.
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      // Sign-in is the one endpoint worth guessing at: the seeded accounts have
      // known emails, so cap attempts well below what a password spray needs.
      "/sign-in/email": { window: 60, max: 5 },
    },
  },

  // Must stay last: `nextCookies` hooks every endpoint's response and replays
  // its Set-Cookie headers through `next/headers`, which is what lets the login
  // server action set the session cookie. Without it `auth.api.signInEmail`
  // succeeds and the browser is never given a cookie.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
