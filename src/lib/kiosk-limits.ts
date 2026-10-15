/** Address-independent limits for kiosk code lookups; see `kiosk-claim.ts`. */
import "server-only";

import { KIOSK_REFERENCE_LIMIT, KIOSK_VALIDATION_GLOBAL_LIMIT } from "@/lib/booking-config";
import { consumeDatabaseRateLimit } from "@/lib/database-rate-limit";

/**
 * The address-independent limits for anonymous kiosk lookups: per code (so a
 * reference cannot be paired with guessed names from many addresses) and one
 * ceiling across every caller. Database-backed so they hold across instances
 * and restarts. Returns the 429 to send when either is spent, else null.
 */
export async function consumeKioskCodeLimits(token: string): Promise<Response | null> {
  const code = token.trim().toUpperCase();
  for (const [key, rule, message] of [
    ["kiosk-validation:global", KIOSK_VALIDATION_GLOBAL_LIMIT, "The kiosk is busy just now. Please wait a moment, or ask reception for help."],
    [`kiosk-validation:code:${code}`, KIOSK_REFERENCE_LIMIT, "Too many attempts for this reference number. Please ask reception for help."],
  ] as const) {
    const limit = await consumeDatabaseRateLimit(key, rule);
    if (!limit.allowed) {
      return Response.json({ error: message }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
    }
  }
  return null;
}
