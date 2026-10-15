/**
 * Production guard for `BETTER_AUTH_SECRET`, which signs session cookies.
 *
 * Without it Better Auth falls back to a built-in default that is public, so
 * anyone could forge a session cookie (KNOWN_ISSUES N-13). Better Auth only
 * logs that; `next.config.ts` calls this during `next build` and server start
 * so a production deployment refuses to run instead.
 *
 * Kept free of imports so `next.config.ts` can load it.
 */

/** Better Auth's fallback (`better-auth/dist/utils/constants.mjs`). */
const BETTER_AUTH_DEFAULT_SECRET = "better-auth-secret-12345678901234567890";

/** The sample value committed in `.env.example`: public, so never valid in production. */
const ENV_EXAMPLE_SECRET = "Ch9UySKhhFufjTT64Wm7fs/ZN1aV4xh4DVQ5EzZglDU=";

export const MIN_AUTH_SECRET_LENGTH = 32;

/** Why the secret is unusable in production, or null when it is fine. */
export function authSecretProblem(secret: string | undefined): string | null {
  const value = secret?.trim();
  if (!value) return "BETTER_AUTH_SECRET is not set.";
  if (value === BETTER_AUTH_DEFAULT_SECRET) return "BETTER_AUTH_SECRET is Better Auth's built-in default.";
  if (value === ENV_EXAMPLE_SECRET) return "BETTER_AUTH_SECRET is the sample value from .env.example.";
  if (value.length < MIN_AUTH_SECRET_LENGTH) return `BETTER_AUTH_SECRET is shorter than ${MIN_AUTH_SECRET_LENGTH} characters.`;
  return null;
}

export function assertProductionAuthSecret(secret = process.env.BETTER_AUTH_SECRET): void {
  const problem = authSecretProblem(secret);
  if (problem) {
    throw new Error(
      `${problem} It signs session cookies, so production builds and servers refuse to start without a private value. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
}
