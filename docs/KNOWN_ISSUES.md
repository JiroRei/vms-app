# Known issues

Audit of branch `staging` (working tree including uncommitted files) on
2026-10-14. Every item cites code or something that was run; nothing here was
fixed as part of the audit. The application map is in [APP_MAP.md](./APP_MAP.md)
and screenshots are in [screens/](./screens/README.md)
(local only; the directory is gitignored because the screenshots show
real-looking personal details).

Priorities:

- **Blocker**: must be fixed before any real deployment.
- **Major**: wrong behaviour, data or security exposure that users will hit.
- **Minor**: limited impact, polish, or latent.

## Summary

Still open (fixed items are marked **Fixed** below and listed in
"Fixed on 2026-10-15"):

| Category | Blocker | Major | Minor | Total |
| --- | --- | --- | --- | --- |
| Bugs | 0 | 0 | 9 | 9 |
| Missing but expected | 0 | 2 | 6 | 8 |
| Cleanup | 0 | 0 | 9 | 9 |
| **Total** | **0** | **2** | **24** | **26** |

As found by the audit: Bugs 1/5/15 (21), Missing 0/2/6 (8), Cleanup 0/1/9
(10), 39 in total.

## Fixed on 2026-10-15

B-01, M-01 through M-05 and C-01, plus N-04, N-06, N-07, N-10, N-11 and N-13. C-09/C-10 fixture cleanup is partially addressed. Details are in
CHANGELOG.md (2026-10-15) and under each item.

Access matrix, measured with `tests/e2e/access-matrix.spec.ts` against a
production build seeded with the e2e fixtures: every page and API route found
in `src/app` (70 routes, 394 cells), requested anonymously as a browser
document, as an RSC request (`RSC: 1` with `Next-Router-State-Tree`) and as a
plain fetch without cookies, then as a guard and as an admin.

| Build | Rule violations | What failed |
| --- | --- | --- |
| Before (commit `437ec05`) | 29 | Anonymous RSC requests to all 12 dashboard pages returned 200 instead of a redirect. Anonymous document and plain requests to `/dashboard/appointments`, `/history` and `/visitors` returned 307 but the body still carried seeded visitor data (emails, reference number, names). Guards got 200 on the 4 admin pages (document and RSC). Anonymous `GET /api/visits/export` returned 403 instead of 401. |
| After | 0 | Every anonymous request to a dashboard page is a 307 to /login with no data in the body; guards get 403 on admin pages and admin APIs; anonymous staff and admin APIs return 401. |

---

## Bugs

### B-01 (Blocker) Anonymous RSC requests read dashboard data

**Fixed 2026-10-15.** Every dashboard page calls `requireStaff()` / `requireAdmin()` (`src/lib/session.ts`) before loading anything; staff data is read only through the guarded loaders in `src/lib/staff-data.ts` (an ESLint rule stops `src/app` importing the unguarded functions); `src/proxy.ts` redirects anonymous `/dashboard/**` requests to /login before rendering. The access matrix above is enforced by `tests/e2e/access-matrix.spec.ts`. The re-run also showed the leak was wider than recorded here: plain anonymous requests to three pages carried data in the body of their 307.

- **Where:** `src/app/dashboard/layout.tsx` (the only session check) and the
  pages that rely on it: `src/app/dashboard/visitors/page.tsx`,
  `appointments/page.tsx`, `history/page.tsx`, `page.tsx` (live list),
  `scan/page.tsx`, `account/page.tsx`. `register` and `roll-call` check the
  session themselves; admin pages check the role before querying.
- **Evidence:** with no cookie, `GET /dashboard/visitors?_rsc=<hash>` with
  header `RSC: 1` returned **200 `text/x-component`** containing every visitor
  profile (first/last name, email, visit count, pass id and state). The same
  request to `/dashboard/appointments` returned today's and upcoming
  appointments including `visitorEmail` and `referenceNumber`;
  `/dashboard/history` returned visit names. The payload also contains
  `NEXT_REDIRECT;replace;/login`, but the page segment renders in parallel with
  the layout, so its data is already in the stream. A reference number alone is
  enough to check in at the kiosk (`POST /api/appointments/check-in`).
  Next.js documents this pitfall in
  `node_modules/next/dist/docs/01-app/02-guides/authentication.md` ("Layouts
  and auth checks").
- **Reproduce:** `curl -i -H "RSC: 1" "http://localhost:3000/dashboard/visitors?_rsc=x"`,
  follow the 307 to the corrected `_rsc` value with the same header, and read
  the body.
- **Fix:** move the check next to the data. Add a `requireStaff()` /
  `requireAdmin()` helper in `src/lib/session.ts` that redirects, and call it
  at the top of every dashboard page and inside the data functions they use
  (`listProfilesForStaff`, `listStaffAppointments`, `getVisitHistory`,
  `getActiveVisits`). Optionally add a `proxy.ts` cookie-presence check as a
  second layer.

### M-01 (Major) Every rate limit can be bypassed with `X-Forwarded-For`

**Fixed 2026-10-15.** `getClientIp()` (`src/lib/client-ip.ts`) ignores forwarding headers unless `TRUSTED_PROXY_COUNT` says how many proxies wrote them, and otherwise uses the connection address, which `server.mjs` records for every request. Every limiter, the login action, the kiosk heartbeat and Better Auth use it. Second limits: per email (booking, code requests and checks, sign-in), per reference number plus a global ceiling (kiosk validation and check-in), per device (heartbeat), per account (password change). The kiosk's typed reference number now needs the booking's last name. Covered by `tests/client-ip.test.ts`, `tests/kiosk-claim.test.ts` and two e2e tests.

- **Where:** `src/lib/rate-limit.ts:105` `clientIp()` trusts the first
  `X-Forwarded-For` entry; used by all in-memory limits, the database limits
  in `src/lib/database-rate-limit.ts`, and the login action
  (`src/app/login/actions.ts`).
- **Evidence:** 32 requests to `POST /api/appointments/validate` with a fixed
  `X-Forwarded-For: 203.0.113.7` produced 2 × 429 after the 30/minute limit;
  requests with a rotating header (`198.51.100.0` to `.4`) were never limited.
- **Fix:** only honour forwarding headers from a configured trusted proxy
  (env such as `TRUSTED_PROXY_HOPS`), otherwise use the socket address; key
  sensitive limits additionally by account/email/reference.

### M-02 (Major) Seed ignores `?schema=` and writes to `public`

**Fixed 2026-10-15.** App and seed use `src/lib/database-config.ts`, which passes the URL schema to `PrismaPg`. The seed prints the database/schema/host before connecting, refuses any existing staff accounts unless `--force` is supplied, and creates only missing records. Existing identities (including passwords), purposes, hosts and appointments are never updated. `scripts/verify-seed.ts` migrated a clean scratch schema, exercised refusal and forced repeat runs after operator edits, checked development remained unchanged, then dropped the scratch schema. Test cleanup checks both the environment and the URL captured by the Prisma client; the e2e build, fixtures and server all target `e2e`, and the runner clears test rows in `finally`.

- **Where:** `prisma/seed.ts:13` builds `new PrismaPg({ connectionString })`
  without the `{ schema }` option that `src/lib/prisma.ts` passes.
- **Evidence:** on a scratch database, `migrate deploy` into
  `?schema=audit_scratch` succeeded (19 tables), then `bun run db:seed` with
  the same URL failed with `P2021 TableDoesNotExist` for `PurposeOption`: it
  queried `public`. On a database where `public` already has tables (the dev
  database), seeding a test schema would silently upsert into dev, resetting
  the seeded admin/guard passwords, hosts, purposes and `APT-100x` appointments.
  Seeding a clean `public` schema works and is idempotent (second run made no
  errors).
- **Fix:** read the schema from the URL and pass it as in `src/lib/prisma.ts`,
  or import the shared client.

### M-03 (Major) Any browser that opens `/check-in` becomes a permanent kiosk and triggers the offline alarm

**Fixed 2026-10-15.** Unknown UUIDs register as `PENDING`. Only non-retired `APPROVED` devices affect the chip/banner; staff see an Unconfirmed devices section and admins can Approve or Dismiss. Dismissal retires the identity so later heartbeats cannot re-enrol it. Heartbeat creation is limited to 5 per client address/hour, pending rows are capped at 20 under a Postgres transaction lock, and pending devices unseen for 7 days are deleted on heartbeat/list sweeps. Migration `20261015100000_kiosk_approval` approved only existing non-retired devices seen in the last 24 hours and retired the rest. Service and browser tests cover concurrency, expiry, approval, dismissal and creation limits.

- **Where:** `src/app/check-in/kiosk-heartbeat.tsx` (random id in
  `localStorage`, heartbeat every 30 s), `src/app/api/kiosk/heartbeat/route.ts`
  (upserts unauthenticated), `src/app/dashboard/kiosk-monitor.tsx`.
- **Evidence:** the dev database had one stale device, which is why every
  dashboard screenshot shows "Kiosks: Offline" and "A kiosk has been silent
  for more than 3 minutes". The audit's 27 headless browser contexts that
  opened kiosk pages each registered a new device (`kiosk_device` went from 1
  to 28 rows; removed during cleanup). A visitor opening `/check-in` on a
  phone, or staff testing on a laptop, does the same, and each such device
  raises the alarm until an admin retires it.
- **Fix:** enrol kiosks explicitly (admin-issued enrolment code or signed
  device cookie) and ignore heartbeats from unenrolled browsers; optionally
  auto-retire devices never seen for N days.

### M-04 (Major) Staff "new appointment" uses the staff device's time zone

**Fixed 2026-10-15.** Staff create and reschedule send `YYYY-MM-DDTHH:mm` site wall-clock values; `parseStaffSchedule` uses the booking page's `zonedTimeToUtc` on the server, retaining staff's ability to choose any future minute. Both controls name the site zone. Rescheduling uses the shared site formatter and its duplicated offset helper was removed. Unused device-local date helpers were removed. History/CSV and register filters already use site-midnight boundaries; regression tests now exercise those boundaries and create/reschedule 10:00 appointments with Chromium set to UTC and America/Los_Angeles.

- **Where:** `src/app/dashboard/appointments/appointment-manager.tsx:155`
  sends `new Date(datetimeLocal).toISOString()` (browser zone);
  `src/app/api/appointments/manage/route.ts:74` stores it. By contrast staff
  reschedule (`appointment-board.tsx:359`) appends the site offset via
  `zoneOffset()`, so the two staff forms disagree.
- **Evidence:** with `TZ=UTC`, the value `2026-10-15T10:00` serialises to
  `2026-10-15T10:00:00.000Z`, which is **6:00 PM** site time (Asia/Manila).
  Any guard/admin device not set to the site zone books the wrong time, and
  the visitor is emailed that wrong time.
- **Fix:** send the wall-clock string and convert on the server with
  `zonedTimeToUtc` (as reschedule effectively does), and remove the
  duplicated `zoneOffset` helper.

### M-05 (Major) One-time codes, reset links and pass credentials are stored in plaintext indefinitely

**Fixed 2026-10-15.** Bodies (`html`, `text`, `attachments`) are cleared as soon as a message is sent, fails for good or expires; pass emails store only the pass id and version and render the QR at send time; rows are purged after 14 days (30 if failed) by the request sweep and the cron job. Migration `20261015090000_email_outbox_retention` scrubbed existing rows. Log output is redacted for codes, `token=` links, pass tokens, bearer tokens and inline images, and Better Auth logs go through the same sanitizer. Covered by `tests/pass-email.test.ts`.

- **Where:** `src/lib/email-outbox.ts:45` stores the full `html`, `text` and
  base64 `attachments` of every email; nothing deletes `email_outbox` rows.
- **Evidence:** during the flow run the outbox `text` contained the 6-digit
  booking code (used to verify successfully), the password-reset URL with its
  token (followed successfully), appointment manage links (signed bearer
  links), and the visitor-pass QR PNG, which encodes a bearer credential valid
  for 365 days. This contradicts the design note that only an HMAC of codes is
  stored (`VisitorVerification` docs in `prisma/schema.prisma`). Anyone with
  database or backup read access can take over a staff account within the hour,
  manage appointments, or check in as a pass holder.
- **Fix:** after `SENT` (or final `FAILED`/expiry) null out `html`, `text` and
  `attachments`, or store templates plus non-secret parameters and render at
  send time; add a retention purge.

### N-01 (Minor) Deliveries accept inactive hosts

- **Where:** `src/app/api/deliveries/route.ts:75` uses `findUnique` without
  `active: true` (walk-in, booking and pass routes all filter `active`).
- **Evidence:** after deactivating a host, `POST /api/deliveries` with that
  `hostId` returned **201**; `POST /api/visits` with the same host returned 400.
- **Fix:** use `findFirst({ where: { id, active: true } })`.

### N-02 (Minor) Reset-password page never shows the server's error

- **Where:** `src/app/reset-password/page.tsx:36` reads `result.message`, but
  `withApi` rewrites errors to `{ error: { code, message, requestId } }`.
- **Evidence:** `POST /api/auth/reset-password` with a bad token returned
  `400 {"error":{"code":"INVALID_REQUEST","message":"Invalid token",...}}`;
  the page falls back to its generic text for every failure.
- **Fix:** use `apiErrorMessage(result.error)` as the other forms do.

### N-03 (Minor) Booking confirmation shows the visitor's device time zone and locale

- **Where:** `src/app/appointment-booking/booking-form.tsx:150`
  `toLocaleString([], …)` with no `timeZone`.
- **Evidence (code):** every other visitor-facing time (emails, manage page,
  kiosk) formats in `SITE_TIMEZONE`. A visitor whose phone is in another zone
  sees a different time on the success screen than in the confirmation email.
- **Fix:** use `formatZonedDate`/`formatZonedTime` or pass `timeZone: SITE_TIMEZONE`
  and a pinned locale.

### N-04 (Minor) Kiosk monitor "last seen" uses device locale and zone

**Fixed 2026-10-15.** Uses the shared site-zone `formatDateTime`.

- **Where:** `src/app/dashboard/kiosk-monitor.tsx:45` `toLocaleString()`.
- **Fix:** use `formatDateTime` from `src/lib/dates.ts`.

### N-05 (Minor) Error reports always lose their context

- **Where:** `src/lib/logger.ts:4`: the sensitive-key regex contains `text`,
  which matches the key `context`, so `reportError(error, context)` always
  prints `"context":"[redacted]"`, including in the `ERROR_WEBHOOK_URL` payload.
- **Evidence:** all 8 `Application error` lines in the audit server log read
  `"context":"[redacted]"`.
- **Fix:** anchor the pattern (`^(password|secret|…|text)$`) or match whole
  key names.

### N-06 (Minor) Anonymous export returns 403 instead of 401

**Fixed 2026-10-15** (`requireAdminApi`).

- **Where:** `src/app/api/visits/export/route.ts:10`.
- **Evidence:** access matrix: anonymous `GET /api/visits/export` gives 403;
  every other staff route gives 401.
- **Fix:** return 401 when there is no session.

### N-07 (Minor) Admin pages answer guards with 200 and a meta refresh

**Fixed 2026-10-15.** `src/proxy.ts` answers guards with a 403 page before rendering.

- **Where:** `redirect("/dashboard")` inside `hosts`, `staff`, `email-log`,
  `settings/purposes` pages runs after the layout has started streaming.
- **Evidence:** guard requests returned 200 with
  `<meta http-equiv="refresh" content="1;url=/dashboard">`; no admin data in
  the body.
- **Fix:** resolves with B-01 (role check before rendering, or in `proxy.ts`).

### N-08 (Minor) `AUTO_CLOSE_TIME` is not configurable and early-morning values would not work

- **Where:** `src/lib/site-config.ts` (hardcoded `"23:59"`, while its comment
  says a site "can set an early-morning time"); `src/lib/stale-visits.ts:79`
  only considers visits checked in before today's start, so with `"06:00"` a
  visit from 01:00 today would never close until tomorrow.
- **Fix:** make it an env setting and query by computed close time.

### N-09 (Minor) CSV export repeats typed delivery department in two columns

- **Where:** `src/lib/visit-export.ts:51-52`.
- **Evidence:** the audit export row for a delivery to a typed department read
  `"Mailroom","Mailroom"` for both "Host/destination" and "Department".
- **Fix:** leave "Department" empty when there is no host.

### N-10 (Minor) Booking code is in the email subject

**Fixed 2026-10-15.** Subject is "Your booking code"; existing outbox subjects were rewritten by the retention migration.

- **Where:** `src/lib/email.ts:428` `Your booking code is ${code}`.
- **Fix:** keep the code in the body only (lock-screen previews show subjects).

### N-11 (Minor) `prisma db seed` only works through the package script

**Fixed 2026-10-15.** Seed command is `node --import tsx prisma/seed.ts`; direct CLI invocation was verified on the scratch schema.

- **Where:** `prisma7.config.ts:12` `seed: "tsx prisma/seed.ts"`.
- **Evidence:** `node node_modules/prisma/build/index.js db seed` failed with
  `'tsx' is not recognized`; `bun run db:seed` worked (adds `node_modules/.bin`
  to `PATH`).
- **Fix:** `seed: "node --import tsx prisma/seed.ts"`.

### N-12 (Minor) Stats and roll-call run an unthrottled stale close on every poll

- **Where:** `src/lib/dashboard-stats.ts:29`, `src/lib/roll-call.ts:10` call
  `closeStaleVisits` directly; stat cards poll every 5 s per open dashboard.
- **Fix:** use `sweepStaleVisitsIfDue` (roll-call may keep the strict call).

### N-13 (Minor) Local environment lacks `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`

**Fixed 2026-10-15.** Both are set in the local `.env` (generated secret). `next build` and the production server now refuse to start when the secret is missing, Better Auth's default or the `.env.example` sample (`src/lib/auth-secret.ts`); the production build no longer logs the default-secret error.

- **Evidence:** the production build logged 21 × `BetterAuthError: You are
  using the default secret` and 21 × `Base URL is not set`. `.env` still says
  Better Auth is "scaffolded, not active yet" although it is the live auth
  layer.
- **Fix:** set both in `.env`; update the comment.

### N-14 (Minor) `pg` deprecation warning: concurrent `client.query`

- **Evidence:** `DeprecationWarning: Calling client.query() when the client is
  already executing a query is deprecated and will be removed in pg@9.0`
  appeared in the unit run, the e2e web server and the audit server.
- **Investigation 2026-10-15:** `--trace-deprecation` points to `PgTransaction.performIO` in `@prisma/adapter-pg` and parallel child queries in Prisma's `query-interpreter.ts:261`, including nested writes. Application transaction callbacks already await queries sequentially. A dependency change or transaction adapter serialization is needed; this is not a trivial local query fix, so the warning remains open.

### N-16 (Minor) Seed data is internally inconsistent

- **Where:** `prisma/seed.ts`: `APT-1004` is `CHECKED_IN` with no linked visit;
  `APT-1006` is `PENDING` but already lapsed; passwords `admin123`/`guard123`
  are printed to the console; `GRACE_HOURS = 4` duplicates
  `APPOINTMENT_GRACE_HOURS`.
- **Fix:** create the visit for checked-in fixtures, reuse `appointmentExpiry`,
  stop printing passwords.

---

## Missing but expected

### G-01 (Major) Privacy notice is placeholder text while consent is collected

- **Where:** `src/app/privacy/page.tsx` (see `screens/privacy--default--phone.png`);
  booking requires ticking consent to this page (`POST /api/appointments`
  rejects `consent !== true`).
- **Fix:** publish the operator's real notice (controller, legal basis,
  recipients, retention, rights, contact) before go-live.

### G-02 (Major) No retention or deletion for personal data

- **Where:** no purge exists for `visit`, `visitor`, `visitor_profile`,
  `appointment`, `email_outbox` or `export_log` (only rate-limit buckets and
  24-hour-old verification codes are pruned). No staff action deletes or
  exports a visitor's data.
- **Fix:** define retention per table, add a cron purge and an admin
  "delete visitor data" action.

### G-03 (Minor) Emails do not say which organisation or site they are from

- **Where:** `src/lib/email.ts` never uses `ORGANIZATION_NAME` or an address;
  see all nine renders in `screens/emails/`.
- **Fix:** add organisation name (and optional address/contact env) to the
  shell and subjects.

### G-04 (Minor) Operational settings are code constants

- Business hours, slot length, booking horizon, early check-in, grace hours,
  auto-close time, recurring threshold, pass validity and rate limits all
  require a code change (APP_MAP section 4).
- **Fix:** move to env or an admin settings table.

### G-05 (Minor) Email log lacks timestamps, kind filter and totals

- **Where:** `src/app/dashboard/email-log/page.tsx` shows recipient, kind,
  status, attempts, last error only.

### G-06 (Minor) Missed appointments are never recorded

- `AppointmentStatus.EXPIRED` exists but is never written; there is no
  no-show state or report.

### G-07 (Minor) No scheduler is configured for the cron routes

- `/api/cron/close-stale-visits` and `/api/cron/process-email-outbox` exist,
  but the repository has no schedule (e.g. `vercel.json` crons or a documented
  external job), so outbox retries depend on unrelated API traffic.

### G-08 (Minor) Staff-created appointments skip booking rules

- `POST /api/appointments/manage` accepts any future instant: no business
  hours, slot boundaries or horizon (public booking enforces all three via
  `checkSlot`). Confirm whether this is intended and document it.

---

## Cleanup

### C-01 (Major) Most recent work is not in git

**Fixed 2026-10-15** in six commits on `staging` (`6bcf2f1`..`437ec05`); a fresh clone installs, applies all 22 migrations to an empty schema and builds. Not yet pushed: the push was blocked by a permission check in the session that made the commits.

- `git status` lists as untracked: 6 of 21 migrations
  (`20261012013401` to `20261013100000`), `.github/` (CI), `playwright.config.ts`,
  `scripts/`, `prisma/seed-e2e.ts`, about 20 API route directories and 30+
  files under `src/lib`, `src/app` and `tests/`. A lost working copy loses the
  schema history the dev database already depends on, and CI never runs on it.
- **Fix:** commit in reviewable pieces.

### C-02 (Minor) Dead code

- `src/lib/dates.ts`: `toDateTimeLocalValue`, `startOfLocalDay`,
  `endOfLocalDay` are unused, and `toLocalDateKey` is used only internally.
  All are device-local helpers that contradict the site-time-zone rule.
- `src/app/check-in/form-styles.ts:30` `codeInputClass` is unused.
- `src/test.ts`: untracked, zero bytes, excluded in `tsconfig.json`.
- About 70 exports are only used in their own file (full list from the audit:
  mostly result/input types in `src/lib/*`); `isPassToken`, `resetRateLimits`,
  `countAdmins`, `CSV_COLUMNS`, `EMAIL_BACKOFF_MS`, `sanitize` are exported
  only for tests; `closeTimeFor` only for `prisma/repair-auto-closed-visits.ts`.
- `prisma/repair-auto-closed-visits.ts` is a one-off repair script.
- No unused routes or components were found: every page is linked from the
  UI, and all 327 rendered links across the three roles returned 200.

### C-03 (Minor) Duplicated logic

- Email validation `MAX_EMAIL` + `EMAIL_PATTERN`: `src/app/api/appointments/route.ts:34`,
  `appointments/manage/route.ts:18`, `booking/lookup/route.ts:16`.
- Cron bearer check: `src/app/api/cron/close-stale-visits/route.ts:27`
  reimplements `requireCron` (`src/lib/cron-auth.ts`).
- Admin checks: `requireAdmin` in `src/lib/api-auth.ts`, a second local
  `requireAdmin` in `src/app/api/staff/[id]/route.ts:10`, and inline checks in
  hosts, kiosks, email-log, close-stale and export routes.
- `hmac`/`safeEqual`: `src/lib/appointment-access.ts:37,49` and
  `src/lib/booking-verification.ts:58,62`.
- `isUniqueViolation`: `appointments.ts:235`, `purposes.ts:72`, `visitor-pass.ts:78`.
- `QR_OPTIONS` and QR rendering: `src/lib/qr.ts:281`, `src/lib/pass-token.ts:145`.
- Two different `formatDateKey` functions with different output:
  `src/lib/dates.ts:145` ("Sep 15") and `src/lib/booking-config.ts:293`
  ("Thursday, October 8, 2026").
- Local date formatters re-implemented in `history-table.tsx`,
  `live-check-ins.tsx`, `visit-timeline.tsx`, `appointment-check-in.tsx`,
  `booking-form.tsx`, `email.ts` instead of `src/lib/dates.ts`.
- `zoneOffset` in `appointment-board.tsx` duplicates `zonedTimeToUtc`.
- Visitor + visit creation duplicated between `createWalkInVisit` and
  `redeemAppointment`.
- Two error styles side by side: `NextResponse.json({ error })` vs thrown
  `ApiError`; two form-style modules (`appointment-booking/styles.ts`,
  `check-in/form-styles.ts`).

### C-04 (Minor) Inconsistent naming

- Host vs destination vs department vs recipient: column/field labels are
  "Host" (live list), "Host / Department" (kiosk), "Host/destination"
  (register, CSV), "Host or destination", "Recipient" (delivery modal),
  `destination` (roll-call type), `recipientDepartment` (schema).
- Visitor vs guest vs profile: `Visitor` is a per-visit record, `VisitorType.GUEST`
  is the non-delivery type, and the "Visitors & passes" page lists
  `VisitorProfile` rows.
- Check-in spelling: "Check In" (walk-in button), "Check in", "Check-in",
  "Kiosk Check-in"; route `/check-in/walkin` vs label "Walk-in"; `/kiosk`
  redirect and component `KioskPage` for `/check-in`.
- "Expected arrivals" (nav) for `/dashboard/appointments`; "Live check-ins"
  (nav) vs "Live Check-ins" (heading).
- Booking namespaces: page `/appointment-booking`, APIs `/api/appointments`
  and `/api/booking/*`, redirect `/book`.
- Code: `createWalkInVisit` also creates `PASS` visits; appointment lifecycle
  lives in `src/lib/qr.ts`; site-wide date utilities and pass constants live in
  `src/lib/booking-config.ts`; `prisma7.config.ts` naming.

### C-05 (Minor) Hardcoded values that should be settings

- Staff form placeholder `guard@geoplan.ph` (`staff-directory.tsx:190`), host
  placeholder `Jeffrey E.`, phone placeholder `+63 900 000 0000`, courier
  example `LBC Express`, default time zone `Asia/Manila`, default sender
  `VMS <visits@example.com>` in `.env.example`, plus the constants in
  APP_MAP section 4.

### C-06 (Minor) TODO comments

- 13 `TODO(multi-tenancy)` comments (`src/app/api/purposes/**`,
  `src/app/dashboard/settings/purposes/page.tsx`, `src/lib/appointments.ts`,
  `src/lib/booking-config.ts` ×2, `src/lib/booking-pass.ts`,
  `src/lib/purposes.ts`, `src/lib/visit-export.ts`, `prisma/schema.prisma` ×2,
  `prisma/seed.ts`). No `FIXME`, `XXX` or `HACK` markers.

### C-07 (Minor) Places that compute dates without the configured time zone

- `appointment-manager.tsx:155` (M-04), `booking-form.tsx:150` (N-03),
  `kiosk-monitor.tsx:45` (N-04), the device-local helpers in
  `src/lib/dates.ts` (C-02), and `date-time-picker.tsx:56` (DayPicker
  labels; mapped deliberately, documented in the file). All server-side
  day boundaries (history, register, stats, stale close, appointments) use
  `zonedTimeToUtc`/`dateKeyInZone` correctly.

### C-08 (Minor) Repository hygiene

- Two lockfiles: `bun.lock` and tracked `package-lock.json`.
- Two identical tracked agent skill trees: `.agents/skills/**`, `.windsurf/skills/**`.
- CI uses Node 22 (`.github/workflows/ci.yml`); this machine runs Node 26; no
  `engines` field. `npm`/`npx` are blocked on this machine by an NVM integrity
  check (`NVM4306`), so scripts were run with `bun`.
- Loose notes at repo root: `git-merge.md`, `CONTINUATION.md`, `MULTI_TENANCY_TODO.md`.

### C-09 (Minor) Stale documentation and comments

- **Fixed 2026-10-15:** updated the test counts and fixture claim in `STATUS.md`.
- **Partially fixed 2026-10-15:** corrected the fixture claim in `STATUS.md`. Five referenced `[test]` purposes were deactivated in development (zero unused options to delete), preserving historical references while removing them from public dropdowns. Other stale comments remain below.
- `walkin-form.tsx:160` comment says nothing sends a notification; host
  arrival emails now exist.
- `.env` Better Auth comment (N-13); `site-config.ts` `AUTO_CLOSE_TIME` comment (N-08).

### C-10 (Minor) Development database leftovers

**Partially fixed 2026-10-15.** Five referenced `[test]` purposes were deactivated (none unused to delete), and stale kiosk browsers were retired by the approval migration. The other audit leftovers listed below remain.

- `[test] …` and other one-off purpose options (above), one stale kiosk device
  (permanent offline banner), `admin@geosense.biz` with no credential ("cannot
  sign in" on the staff page), one `FAILED` appointment email (no working
  `RESEND_API_KEY`/sender locally), and `PENDING` appointments from September.

---

## Health check results

**Operational re-check 2026-10-15:** 130 unit/service tests and all 18 Chromium
tests passed; production build, TypeScript and lint passed (two existing
unused-variable warnings in `src/test.ts`). The seed verification scratch
schema was dropped; all 18 isolated test tables were verified empty, with no
E2E staff/profile/appointment fixtures in development. Five referenced `[test]`
purposes are inactive. The kiosk migration retained three approved devices and
retired one older browser; its UTC cutoff was verified with 23/25-hour devices
under a non-UTC database session. The `pg` warning remains as described in N-14.
The table below retains the original audit evidence where not explicitly updated.

Commands were run on Windows 11, Node 26.10.0, bun 1.4.0, PostgreSQL on
`localhost:5432`.

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `bun run typecheck` | Pass (exit 0, 32 s). |
| Lint | `bun run lint` | Pass, no warnings (exit 0, 2 m 38 s). |
| Unit tests | `bun run test` | 106 tests in 25 suites: 106 pass, 0 fail, 0 skipped (43 s); 130 of 130 after the operational fixes (26 suites, zero skips). Warnings: one `pg` `DeprecationWarning` (N-14); expected `Email delivery failed` logs from the retry tests. |
| Playwright | `bun run test:e2e` | 11 passed, 0 failed (tests 1.5 m; with build 4 m 23 s). Warnings: Tailwind CSS optimiser warning (since fixed, see CHANGELOG 2026-10-14), `pg` deprecation. Re-run 2026-10-15 after the fixes: 15 passed, 0 failed. |
| Production build | `NEXT_DIST_DIR=.next-audit next build` | Pass (1 m 38 s, 42 static pages). 21 × `BetterAuthError` default secret, 21 × base URL not set (N-13). The build also rewrote `tsconfig.json` to include the new dist dir; that edit was reverted. |
| Schema validate | `prisma validate` | Valid. |
| Migrate status (dev) | `prisma migrate status` | 21 migrations found, database schema up to date. |
| Drift (dev) | `prisma migrate diff --from-config-datasource --to-schema` | Empty. |
| Clean scratch schema | new database `vms_audit_scratch`, schema `audit_scratch` | `migrate deploy` OK; `db:seed` **failed** P2021 (M-02). |
| Clean `public` schema | same database, schema `public` | `migrate deploy` OK; seed OK (3 hosts, 5 purposes, 6 appointments, 2 staff); second run OK. Database dropped afterwards. |
| Direct seed command | `prisma db seed` | Failed: `'tsx' is not recognized` (N-11). |

### End-to-end flows

Run over HTTP against the production build with `EMAIL_MODE=test`, temporary
audit accounts and records (all removed afterwards).

| Flow | Result | Steps |
| --- | --- | --- |
| Walk-in | Pass 3/3 | Anonymous kiosk check-in 201; empty form returns field errors; visit appears in live list. |
| Host notification | Pass 1/1 | Walk-in to a host with email created a `host-arrival` email. |
| Step-out and return | Pass 7/7 | Step out; repeat 409; roll-call lists as expected back; return; timeline `CHECK_IN, STEP_OUT, RETURN`; check out; repeat 409. |
| Delivery log | Pass 4/4 | To host 201; to typed department 201; stored checked out with method `DELIVERY`; anonymous 401. (Inactive host accepted: N-01.) |
| Appointment booking | Pass 10/10 | Book tomorrow 201; same host/slot 409; out-of-hours 400; no consent 400; emailed manage link opens; self-reschedule via token; confirmation + update emails; code request generic; code email created; code verifies. |
| Appointment check-in | Pass 9/9 | Tomorrow refused `WRONG_DAY`; staff creates today; new QR; kiosk validate; kiosk check-in with lower-case reference; reuse `ALREADY_USED`; staff reschedule; staff cancel; cancelled refused `CANCELLED`. |
| Visitor pass | Pass 9/9 | Issue; kiosk resolve; express walk-in; booking prefill; resend; rotate; old token 403; revoke; revoked token 403. |
| Stale-visit closing | Pass 4/4 | Count reported; cron wrong secret 401; cron closes 1; visit flagged `closedAutomatically`. |
| Email processing | Pass 1/1 | Cron outbox route 200. |
| Export and register | Pass 4/4 | Admin CSV has UTF-8 BOM and audit rows (first run's check misread the BOM through `fetch().text()`; rechecked on raw bytes: `efbbbf`); guard export 403; guard register shows today's audit visit; history search works and guard sees no export link. |
| Password reset | Pass 4/4 | Request 200; email contains link; link 302 to `/reset-password?token=`; new password accepted. |
| Booking UI (browser) | Pass | Phone: first-time booking through review to success screen with QR. |
| Kiosk UI (browser) | Pass | Tablet: walk-in success; appointment found and checked in. |

Email templates: all nine kinds rendered with every inline `cid:` QR image
resolved (`screens/emails/`). Links: 327 links rendered on 24 pages across the
three roles, 23 distinct targets, all returned 200.

## How this audit was run

1. Static checks and test suites as listed above (via `bun`; `npm` is blocked
   by NVM on this machine).
2. A separate production build (`NEXT_DIST_DIR=.next-audit`) served with
   `next start --port 3200`, `EMAIL_MODE=test`, an audit-only
   `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL=http://localhost:3200`, against
   the development database. The running dev server on port 3000 was not touched.
3. Two temporary staff accounts (`audit-admin@audit.invalid`,
   `audit-guard@audit.invalid`) were inserted directly; all other records were
   created through the application.
4. Access matrix, flows, link crawl, RSC probe and the targeted probes were
   scripted with `fetch`; screenshots with Playwright Chromium.
5. Before testing, every row id and hash of the 18 application tables was
   snapshotted. Afterwards all rows not in the snapshot were deleted (146
   rows: visits, visitors, events, appointments, profiles, passes, outbox,
   rate-limit buckets, kiosk devices, sessions, the two accounts and users,
   one host). A final diff showed no remaining additions and no changed
   pre-existing rows. One pre-existing `verification` row, a password-reset
   token that had expired on 2026-10-13, was removed by Better Auth's own
   expired-token cleanup during the reset test and was not restored.
6. The scratch database and the `.next-audit` build directory were deleted.
