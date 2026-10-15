/**
 * Settings that describe the building itself rather than any one feature.
 *
 * Pure constants, no `server-only`: the booking picker reads the time zone in
 * the browser, and the stale-visit cleanup reads both on the server.
 *
 * Each deployment supplies one organization's settings. A future shared-app
 * architecture would store these per organization; see MULTI_TENANCY_TODO.md.
 */

/**
 * The building's time zone. Every "which day is it" question — booking slots,
 * the stale-visit cleanup's day boundaries — is answered on this clock, never
 * in UTC or in whatever zone the server happens to run in.
 */
export const SITE_TIMEZONE =
  process.env.NEXT_PUBLIC_SITE_TIMEZONE?.trim() || "Asia/Manila";

/** Each organization's separate deployment supplies its own public label. */
export const ORGANIZATION_NAME =
  process.env.NEXT_PUBLIC_ORGANIZATION_NAME?.trim() ||
  "Visitor Management System";

/** How booking and printed reports name the configured site time zone. */
export const SITE_TIMEZONE_LABEL =
  process.env.NEXT_PUBLIC_SITE_TIMEZONE_LABEL?.trim() ||
  new Intl.DateTimeFormat("en-US", {
    timeZone: SITE_TIMEZONE,
    timeZoneName: "long",
  })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value ||
  SITE_TIMEZONE;

/**
 * When a visit nobody checked out is closed (`HH:mm`, in `SITE_TIMEZONE`).
 *
 * The visit closes at the last moment of this minute on the day it checked in,
 * so the default `"23:59"` means 23:59:59.999 — the whole check-in day. A site
 * that runs overnight can set an early-morning time instead (`"06:00"`): when
 * the configured time falls before the check-in, the next occurrence after it
 * is used, so a 22:00 arrival closes at 06:00:59 the following morning.
 */
export const AUTO_CLOSE_TIME = "23:59";
