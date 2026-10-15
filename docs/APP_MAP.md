# Application map

Audit snapshot of what exists in the Visitor Management System, taken on
2026-10-14 from branch `staging` (working tree, including uncommitted files).
Every route, model, setting and flow below was read from the code; the access
matrix was produced by actually requesting each route as an anonymous visitor,
a guard and an administrator against a production build (`next build` +
`next start`). Known defects are tracked separately in
[KNOWN_ISSUES.md](./KNOWN_ISSUES.md); screenshots are in [screens/](./screens/README.md)
(local only; the directory is gitignored because the screenshots show
real-looking personal details).

Keep this file current: see the conventions section in [STATUS.md](../STATUS.md).

Roles used below:

- **Anonymous**: no staff session (visitors, kiosks, the public).
- **Guard**: signed-in `User` with `role = GUARD`.
- **Admin**: signed-in `User` with `role = ADMIN`.
- **Staff** means guard or admin.
- **Cron**: caller presenting `Authorization: Bearer $CRON_SECRET`.

Authentication is Better Auth (`src/lib/auth.ts`) with database sessions.
There is no `middleware.ts` / `proxy.ts`; every page and route checks access
itself. `/dashboard/*` pages rely on `src/app/dashboard/layout.tsx` for the
session check, and admin pages add their own role check (see KNOWN_ISSUES
B-01 for why the layout check alone is not sufficient).

---

## 1. Page routes

| Route | Access | File | Purpose |
| --- | --- | --- | --- |
| `/` | Anonymous | `src/app/page.tsx` | Landing page linking to kiosk, booking and staff login. |
| `/check-in` | Anonymous | `src/app/check-in/page.tsx` | Kiosk chooser: appointment or walk-in. Layout adds idle reset and kiosk heartbeat. |
| `/check-in/appointment` | Anonymous | `src/app/check-in/appointment/page.tsx` | Kiosk check-in by QR scan, reference number or visitor pass. |
| `/check-in/walkin` | Anonymous | `src/app/check-in/walkin/page.tsx` | Kiosk walk-in registration form. |
| `/appointment-booking` | Anonymous | `src/app/appointment-booking/page.tsx` | Public multi-step booking (first-time or returning visitor). |
| `/appointment-booking/manage` | Anonymous (manage token or verified cookie) | `src/app/appointment-booking/manage/page.tsx` | Visitor views, reschedules, cancels appointments; downloads `.ics`; replaces pass. |
| `/privacy` | Anonymous | `src/app/privacy/page.tsx` | Privacy notice (currently placeholder text). |
| `/login` | Anonymous | `src/app/login/page.tsx` + `actions.ts` | Staff sign-in (server action calling Better Auth). |
| `/forgot-password` | Anonymous | `src/app/forgot-password/page.tsx` | Requests a staff password reset email. |
| `/reset-password` | Anonymous (token) | `src/app/reset-password/page.tsx` | Sets a new staff password from an emailed token. |
| `/dashboard` | Staff | `src/app/dashboard/page.tsx` | Live check-ins, stat cards, log delivery, admin "Close all stale visits". |
| `/dashboard/appointments` | Staff | `src/app/dashboard/appointments/page.tsx` | "Expected arrivals": create, check in, reschedule, cancel, new QR, event history. |
| `/dashboard/scan` | Staff | `src/app/dashboard/scan/page.tsx` | Guard QR scanner / reference entry (guard-assisted check-in). |
| `/dashboard/history` | Staff (export link admin only) | `src/app/dashboard/history/page.tsx` | Filtered visit history, frequency chart, CSV export link for admins. |
| `/dashboard/register` | Staff | `src/app/dashboard/register/page.tsx` | Printable daily register for one site-time-zone day. |
| `/dashboard/roll-call` | Staff | `src/app/dashboard/roll-call/page.tsx` | Emergency roll-call: on site and expected back, local ticks, print. |
| `/dashboard/visitors` | Staff | `src/app/dashboard/visitors/page.tsx` | Returning-visitor profiles; issue, send, rotate, revoke passes. |
| `/dashboard/account` | Staff | `src/app/dashboard/account/page.tsx` | Own account details and change password. |
| `/dashboard/hosts` | Admin | `src/app/dashboard/hosts/page.tsx` | Host directory: add, edit, deactivate hosts (with optional notification email). |
| `/dashboard/staff` | Admin | `src/app/dashboard/staff/page.tsx` | Staff accounts: create, change role, remove. |
| `/dashboard/email-log` | Admin | `src/app/dashboard/email-log/page.tsx` | Email outbox status with retry. |
| `/dashboard/settings/purposes` | Admin | `src/app/dashboard/settings/purposes/page.tsx` | Purpose-of-visit options: add, rename, retire, reorder. |
| `/kiosk`, `/kiosk/*` | Redirect | `next.config.ts` | 307 to `/check-in`. |
| `/book`, `/book/*` | Redirect | `next.config.ts` | 307 to `/appointment-booking`. |

Shared UI: `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx`,
`src/app/check-in/error.tsx`, loading skeletons under `dashboard/**/loading.tsx`.

## 2. API routes

All handlers are wrapped in `withApi` (`src/lib/api.ts`), which adds
`X-Request-Id`, normalises error bodies to `{ error: { code, message, requestId } }`
and, after every request, runs the email-outbox sweep and rate-limit pruning.

| Method and route | Access | Purpose |
| --- | --- | --- |
| `GET /api/health` | Anonymous | DB ping; 200 or 503. |
| `GET /api/visits` | Staff | Active and pending-return visits (runs stale sweep first). |
| `POST /api/visits` | Anonymous (kiosk) | Walk-in check-in; host arrival email. |
| `POST /api/deliveries` | Staff | Log a courier delivery (created already checked out). |
| `POST /api/visits/[id]/checkout` | Staff | Check a visit out with staff attribution. |
| `POST /api/visits/[id]/step-out` | Staff | Mark visitor out and expected back (`PENDING_RETURN`). |
| `POST /api/visits/[id]/return` | Staff | Mark returned (`ACTIVE`). |
| `GET /api/visits/[id]/events` | Staff | Visit timeline. |
| `GET /api/visits/close-stale` | Staff | Count of stale open visits. |
| `POST /api/visits/close-stale` | Admin | Close stale visits now. |
| `GET /api/visits/export` | Admin | Streamed CSV export of history filters; writes `ExportLog`. |
| `GET /api/dashboard/stats` | Staff | Stat-card counts (runs full stale close each call). |
| `GET /api/roll-call` | Staff | Roll-call snapshot (runs full stale close each call). |
| `POST /api/appointments` | Anonymous | Public booking (DB rate limits per IP and email; consent required). |
| `POST /api/appointments/validate` | Anonymous | Look up an appointment by QR token or reference (kiosk preview). |
| `POST /api/appointments/check-in` | Anonymous; `assisted: true` requires staff | Redeem an appointment (optionally via pass). |
| `POST /api/appointments/manage` | Staff | Staff-created appointment; scheduledFor is site wall-clock YYYY-MM-DDTHH:mm. |
| `DELETE /api/appointments/manage/[reference]` | Staff | Staff cancel. |
| `POST /api/appointments/manage/[reference]/check-in` | Staff | One-click staff check-in. |
| `POST /api/appointments/manage/[reference]/regenerate-qr` | Staff | Issue a new QR token and email it. |
| `POST /api/appointments/manage/[reference]/reschedule` | Staff | Staff reschedule (any future time). |
| `POST /api/booking/lookup` | Anonymous | Request returning-visitor code (generic response). |
| `POST /api/booking/verify` | Anonymous | Verify the 6-digit code; sets `vms_booking_verified` cookie. |
| `POST /api/booking/pass/verify` | Anonymous | Verify a pass QR ID for booking prefill; sets `vms_booking_pass` cookie. |
| `POST /api/booking/pass/rotate` | Verified visitor cookie | Visitor replaces own pass. |
| `POST /api/booking/sign-out` | Anonymous | Clears booking cookies. |
| `POST /api/booking/appointments/[reference]/cancel` | Manage token or verified cookie | Visitor cancel. |
| `POST /api/booking/appointments/[reference]/reschedule` | Manage token or verified cookie | Visitor reschedule (slot rules enforced). |
| `POST /api/passes/resolve` | Anonymous | Kiosk/guard reads a pass: today's appointments or recent choices. |
| `POST /api/passes/walk-in` | Anonymous; `assisted: true` requires staff | Express walk-in using a pass. |
| `POST /api/visitors/[profileId]/pass` | Staff | `issue`, `send`, `rotate`, `revoke` a profile's pass. |
| `POST /api/kiosk/heartbeat` | Anonymous | Heartbeat; unknown IDs register PENDING (5 creations/IP/hour; cap 20 pending). |
| `GET /api/kiosks` | Staff | Kiosk devices and status. |
| `PATCH /api/kiosks` | Admin | Label, retire, approve or dismiss a kiosk device. |
| `POST /api/email-log/retry` | Admin | Re-queue a pending/failed email. |
| `POST /api/cron/close-stale-visits` | Cron | Scheduled stale-visit close. |
| `POST /api/cron/process-email-outbox` | Cron | Scheduled outbox delivery (25 per call). |
| `POST /api/hosts` | Admin | Create host. |
| `PATCH /api/hosts/[id]` | Admin | Edit or (de)activate host. |
| `POST /api/purposes` | Admin | Create purpose option. |
| `PATCH /api/purposes/[id]` | Admin | Rename or retire/restore a purpose option. |
| `POST /api/purposes/[id]/move` | Admin | Move option up or down. |
| `POST /api/staff` | Admin | Create staff account with password. |
| `PATCH /api/staff/[id]` | Admin | Change role (last admin protected). |
| `DELETE /api/staff/[id]` | Admin | Remove account (last admin protected). |
| `POST /api/account/password` | Staff | Change own password; revokes other sessions. |
| `GET, POST /api/auth/[...all]` | Better Auth | Sign-in, sign-out, session, password reset. Sign-up is disabled (verified: 400). |

Server actions: `signIn`, `signOut` in `src/app/login/actions.ts`.

## 3. Prisma models

Schema: `prisma/schema.prisma` (21 migrations in `prisma/migrations`, all
applied to dev `public`; no drift between the live dev schema and the schema
file per `prisma migrate diff`).

| Model (table) | Purpose |
| --- | --- |
| `User` (`user`) | Staff account and role (`ADMIN`/`GUARD`). Credential lives on `Account`. |
| `Session`, `Account`, `Verification` | Better Auth sessions, credential hashes, password-reset tokens. |
| `Host` (`host`) | Person/department visitors come to see; soft-deleted with `active`; optional `email` for arrival notices. |
| `PurposeOption` (`purpose_option`) | Admin-managed purpose dropdown; retired with `isActive`; case-insensitive unique label (SQL index). |
| `Visitor` (`visitor`) | Per-visit "who" record: name, purpose, host, type (`GUEST`/`DELIVERY`), delivery department and note. |
| `Visit` (`visit`) | One check-in: times, status, step-out, attribution, auto-close flag, method, profile link. |
| `VisitEvent` (`visit_event`) | Append-only visit timeline (check-in, step-out, return, check-out, auto-close). |
| `Appointment` (`appointment`) | Pre-registered visit: reference, QR token, schedule, expiry, status, consent, cancellation. |
| `AppointmentEvent` (`appointment_event`) | Append-only appointment change log with actor. |
| `VisitorProfile` (`visitor_profile`) | Returning visitor identity (email + name key). |
| `VisitorVerification` (`visitor_verification`) | HMAC of emailed booking codes, attempts, expiry. |
| `VisitorPass` (`visitor_pass`) | Persistent pass credential (signed `vp1.<id>.<mac>`), version, status, expiry. |
| `ExportLog` (`export_log`) | Audit row for each CSV export (user id, filters, row count). |
| `EmailOutbox` (`email_outbox`) | Persistent email queue: rendered HTML/text and attachments only until sent, finally failed or expired (then cleared); pass emails keep the pass id instead of the QR; rows purged after 14 days (30 if failed). Updated 2026-10-15. |
| `RateLimitBucket` (`rate_limit_bucket`) | Fixed-window counters for public endpoints. |
| `KioskDevice` (`kiosk_device`) | Device identity, label, last seen, retired; registrationStatus PENDING/APPROVED/RETIRED. Only approved, non-retired devices are monitored. |

### Fields that look unused, legacy or redundant

Checked by grepping writes and reads across `src/`, `prisma/` and `tests/`:

- `AppointmentStatus.EXPIRED`: only read (`src/lib/qr.ts:111`); nothing ever
  writes it. Lapsed appointments stay `PENDING` and expiry is computed from
  `expiresAt` (the dev database holds `PENDING` rows from September).
- `Visitor` vs `Visit`: every code path creates exactly one `Visit` per
  `Visitor` (`createWalkInVisit`, `createDeliveryLog`, `redeemAppointment`), so
  the split is a 1:1 leftover of the pre-profile design. Person identity now
  lives in `VisitorProfile`.
- `Visit.createdAt`: duplicates `checkInTime` for live rows; only read by the
  CSV export cutoff (`src/lib/visit-export.ts`).
- `Visit.checkInMethod`, `Appointment.cancelledBy`, `Appointment.consentAcceptedAt`:
  nullable only for rows that predate the columns (staff-created appointments
  also store `consentAcceptedAt = null`).
- `User.image`, `User.emailVerified`, and `Account.accessToken`,
  `refreshToken`, `idToken`, `*ExpiresAt`, `scope`: required by Better Auth,
  never used (credential provider only).
- `ExportLog.userId`: plain string, no foreign key (by design, survives account
  deletion); no UI reads `ExportLog`.
- `EmailOutbox.html` / `text` / `attachments`: retain full rendered messages,
  including one-time codes, reset links and pass QR images, indefinitely
  (see KNOWN_ISSUES M-05).
- Dropped columns are gone: `appointment.used`, `visitor.purpose`,
  `appointment.purpose`, `user.password`, `appointment.visitorName`,
  `visitor.name`, `visitor_profile.name` were removed by migrations; no
  legacy columns remain in the live schema.
- SQL-only constraints not visible in `schema.prisma`: partial unique index
  for one `PENDING` appointment per host and time, one `ACTIVE` pass per
  profile, and the `lower(trim(label))` unique index on `purpose_option`.

## 4. Settings, constants and environment variables

### Environment variables

| Variable | Read in | Controls |
| --- | --- | --- |
| `DATABASE_URL` | `src/lib/prisma.ts`, `prisma7.config.ts`, `prisma/seed.ts`, scripts, tests | Postgres connection; `?schema=` selects schema (honoured by app, CLI and seed through shared pg adapter configuration). |
| `DATABASE_URL_TEST` | `tests/setup.ts`, `tests/test-database.ts`, `scripts/run-e2e.ts`, `playwright.config.ts` | Isolated test schema (default `e2e`). |
| `DATABASE_URL_RESTORE` | `scripts/restore.ts` | Target for restore script. |
| `BETTER_AUTH_SECRET` | Better Auth (implicit), `scripts/run-e2e.ts`, `tests/setup.ts` | Session signing. Absent from the local `.env` (commented out). |
| `BETTER_AUTH_URL` | Better Auth, `src/lib/appointment-access.ts` (`appBaseUrl`) | Public origin; base for emailed manage links. |
| `BOOKING_VERIFY_SECRET` | `src/lib/booking-verification.ts`, `src/lib/appointment-access.ts` | HMAC for booking codes, verified cookie, manage tokens. |
| `PASS_SECRET` | `src/lib/visitor-pass.ts` | HMAC key for pass tokens (min 32 chars). |
| `CRON_SECRET` | `src/lib/cron-auth.ts`, `src/app/api/cron/close-stale-visits/route.ts` | Bearer token for cron routes; empty gives 503. |
| `RESEND_API_KEY`, `APPOINTMENT_FROM_EMAIL` | `src/lib/email-outbox.ts` | Email transport; if missing, sends fail and retry. |
| `EMAIL_MODE` | `src/lib/email-outbox.ts`, tests | `test` makes the transport a no-op (marks SENT). |
| `ERROR_WEBHOOK_URL` | `src/lib/logger.ts` | Optional POST target for `reportError`. |
| `NEXT_PUBLIC_ORGANIZATION_NAME` | `src/lib/site-config.ts` | Display name (build-time). |
| `NEXT_PUBLIC_SITE_TIMEZONE` | `src/lib/site-config.ts` | Site time zone, default `Asia/Manila` (build-time). |
| `NEXT_PUBLIC_SITE_TIMEZONE_LABEL` | `src/lib/site-config.ts` | Optional zone label. |
| `NEXT_DIST_DIR` | `next.config.ts` | Alternate build directory (used by e2e: `.next-e2e`). |
| `NODE_ENV` | cookies `secure` flag, Prisma singleton | Standard. |
| `CI` | `playwright.config.ts` | Playwright retries. |
| `VMS_DEVELOPMENT_DATABASE_URL` | `tests/setup.ts` | Internal: remembers dev URL for isolation checks. |

### Code constants (require a code change and redeploy)

| Constant | Value | Location | Controls |
| --- | --- | --- | --- |
| `SITE_TIMEZONE`, `ORGANIZATION_NAME`, `SITE_TIMEZONE_LABEL` | env-driven | `src/lib/site-config.ts` | See above. |
| `AUTO_CLOSE_TIME` | `"23:59"` | `src/lib/site-config.ts` | Stale-visit close time (comment implies it is configurable; it is not). |
| `BUSINESS_HOURS_START` / `END` | `08:00` / `17:00` | `src/lib/booking-config.ts` | Public booking slots. |
| `SLOT_MINUTES` | 30 | `src/lib/booking-config.ts` | Slot length. |
| `MAX_DAYS_AHEAD` | 30 | `src/lib/booking-config.ts` | Booking horizon. |
| `CHECK_IN_EARLY_MINUTES` | 60 | `src/lib/booking-config.ts` | Early check-in window. |
| `RECURRING_VISITS_THRESHOLD` / `RECURRING_WINDOW_DAYS` | 3 / 30 | `src/lib/booking-config.ts` | Automatic pass issue. |
| `PASS_VALID_DAYS` | 365 | `src/lib/booking-config.ts` | Pass expiry (sliding). |
| `PUBLIC_BOOKING_EMAIL_LIMIT`, `PUBLIC_BOOKING_IP_LIMIT`, `VERIFICATION_IP_LIMIT`, `KIOSK_HEARTBEAT_IP_LIMIT` | 5/h, 20/h, 20/15 min, 60/min | `src/lib/booking-config.ts` | DB-backed rate limits, keyed by `getClientIp()` (`TRUSTED_PROXY_COUNT`). Since 2026-10-15 also `VERIFICATION_EMAIL_LIMIT`, `VERIFICATION_CHECK_EMAIL_LIMIT`, `KIOSK_REFERENCE_LIMIT`, `KIOSK_VALIDATION_GLOBAL_LIMIT`, `KIOSK_HEARTBEAT_DEVICE_LIMIT` (address-independent). |
| Per-route in-memory limits | 5 to 30 per minute | each route (`CHECK_IN_LIMIT`, `LOOKUP_LIMIT`, `REDEEM_LIMIT`, `LIMIT`, `SIGN_IN_LIMIT`, `CHANGE_PASSWORD_LIMIT`) | Process-local limits. |
| `APPOINTMENT_GRACE_HOURS` | 4 | `src/lib/qr.ts` | Appointment expiry after scheduled time (duplicated as `GRACE_HOURS` in `prisma/seed.ts`). |
| `STAFF_UPCOMING_DAYS` | 14 | `src/lib/appointments.ts` | Staff appointment list horizon. |
| `MAX_BOOKING_ATTEMPTS`, `MAX_CANCEL_REASON` | 5, 300 | `src/lib/appointments.ts` | Reference collision retries; cancel reason length. |
| `CODE_TTL_MS`, `MAX_CODE_ATTEMPTS`, `MAX_CODES_PER_WINDOW`, `RATE_LIMIT_WINDOW_MS`, `VERIFIED_COOKIE_MAX_AGE_S` | 10 min, 5, 3, 15 min, 30 min | `src/lib/booking-verification.ts` | Returning-visitor verification. |
| `SESSION_MAX_AGE_SECONDS`, Better Auth rate limits | 8 h; 100/min, sign-in 5/min | `src/lib/auth.ts` | Staff sessions. |
| `MIN_PASSWORD_LENGTH` | 8 | `src/lib/staff.ts` | Staff passwords. |
| `EMAIL_BACKOFF_MS` | 1 m, 5 m, 30 m, 2 h, 12 h | `src/lib/email-retry.ts` | Email retries. |
| `KIOSK_STALE_MS`, `KIOSK_ALERT_MS` | 90 s, 180 s | `src/lib/kiosks.ts` | Kiosk offline status and alert. |
| `IDLE_MS`, `WARNING_MS` | 60 s, 15 s | `src/app/check-in/kiosk-idle-reset.tsx` | Kiosk idle reset. |
| Pending kiosks | 20 max; 7 days unseen retention | `src/lib/kiosk-registration.ts` | Pending devices never affect monitoring. |
| Kiosk creation IP limit | 5/hour | `src/lib/booking-config.ts` | Only first registration consumes this budget. |
| Polling intervals | 5 s (live list, stat cards), 15 s (roll-call, kiosk monitor, booking clock), 30 s (heartbeat) | respective components | UI refresh. |
| `SWEEP_INTERVAL_MS` | 60 s | `src/lib/stale-visits.ts` | Throttle for read-triggered stale sweep. |
| `PAGE_SIZE` | 25 | `src/lib/history.ts` | History page size; email log uses 50 inline. |
| `STAFF_PROFILE_LIMIT` | 100 | `src/lib/visitor-pass.ts` | Visitors page cap. |
| `DELIVERY_PURPOSE_LABEL` | `"Delivery"` | `src/lib/purposes.ts` | Purpose attached to deliveries (looked up by label). |

## 5. Emails

All emails go through `sendEmail` (`src/lib/email-outbox.ts`): a row is written
to `email_outbox`, delivery is attempted immediately, and failures are retried
by the sweep or the cron route. Templates live in `src/lib/email.ts`. All nine
were rendered during the audit (`docs/screens/emails/`).

| Kind | Function | Trigger |
| --- | --- | --- |
| `appointment-confirmed` | `sendAppointmentEmail(..., "confirmed")` | Public booking (`POST /api/appointments`), staff create (`POST /api/appointments/manage`). QR attached inline. |
| `appointment-updated` | `sendAppointmentEmail(..., "updated")` | Visitor or staff reschedule. |
| `appointment-new-code` | `sendAppointmentEmail(..., "new-code")` | Staff "new QR code". |
| `appointment-cancelled` | `sendAppointmentCancelledEmail` | Visitor or staff cancel. |
| `verification` | `sendVerificationCodeEmail` | `POST /api/booking/lookup` when a profile matches (expires with code). |
| `visitor-pass-issued` | `sendVisitorPassEmail("issued")` | Staff issue/send, or automatic issue after the recurring threshold. |
| `visitor-pass-replaced` | `sendVisitorPassEmail("replaced")` | Staff rotate or visitor self-rotate. |
| `host-arrival` | `sendHostArrivalEmail` via `notifyHostArrival` | Walk-in, pass walk-in, kiosk/guard/staff appointment check-in, when the host has an email. |
| `password-reset` | `sendPasswordResetEmail` | Better Auth `request-password-reset` (link valid 1 h). |

## 6. Sweeps and scheduled jobs

| Job | Code | Trigger |
| --- | --- | --- |
| Stale-visit close (throttled) | `sweepStaleVisitsIfDue` in `src/lib/stale-visits.ts` | Reads of live list, history, register, export; at most once a minute per process. |
| Stale-visit close (unthrottled) | `closeStaleVisits` | Every `GET /api/dashboard/stats` and `GET /api/roll-call` (polled every 5 s / 15 s). |
| Stale-visit close (manual) | `POST /api/visits/close-stale` | Admin button "Close all stale visits". |
| Stale-visit close (scheduled) | `POST /api/cron/close-stale-visits` | External scheduler with `CRON_SECRET` (none configured in repo). |
| Email outbox sweep | `sweepEmailOutboxIfDue` | After every `withApi` request, at most once a minute per process. |
| Email outbox (scheduled) | `POST /api/cron/process-email-outbox` | External scheduler with `CRON_SECRET`. |
| Rate-limit prune | `pruneRateLimits` | After every `withApi` request, at most hourly. |
| Verification-code prune | `issueVerificationCode` | Deletes codes older than 24 h whenever a code is requested. |
| Recurring visitor check | `evaluateRecurringVisitor` | `after()` each appointment or pass check-in. |
| One-off repair | `prisma/repair-auto-closed-visits.ts` (`bun run db:repair-auto-closed`) | Manual. |

## 7. Flows

### Walk-in (kiosk)
Entry: `/check-in` → `/check-in/walkin`. Files: `src/app/check-in/walkin/walkin-form.tsx`,
`POST /api/visits` (`src/app/api/visits/route.ts`), `createWalkInVisit` in
`src/lib/visits.ts`, `notifyHostArrival` (`src/lib/host-notify.ts`).
Creates `Visitor` + `Visit` (`WALK_IN`) + `CHECK_IN` event.

### Appointment booking (public)
Entry: `/appointment-booking`. Files: `booking-form.tsx`, `date-time-picker.tsx`,
`host-combobox.tsx`, `returning-lookup.tsx`; `POST /api/appointments`,
`POST /api/booking/lookup`, `POST /api/booking/verify`, `POST /api/booking/pass/verify`;
`src/lib/appointments.ts` (`createAppointment`), `src/lib/booking-config.ts`
(`checkSlot`), `src/lib/booking-verification.ts`, `src/lib/booking-pass.ts`,
`src/lib/appointment-notify.ts`. Self-service: `/appointment-booking/manage`
(`manage-view.tsx`, `src/lib/appointment-access.ts`, `src/lib/ics.ts`) and
`/api/booking/appointments/[reference]/{cancel,reschedule}`.
Staff creation: `/dashboard/appointments` (`appointment-manager.tsx`,
`appointment-board.tsx`) and `/api/appointments/manage/**`. Both forms submit site wall-clock values converted by `parseStaffSchedule` / `zonedTimeToUtc`; displays and reschedule prefill use the site zone. Staff can choose any future minute. History/CSV date ranges and the daily register use site-midnight boundaries.

### Appointment check-in
Entries: kiosk `/check-in/appointment`, guard `/dashboard/scan` (both
`src/components/appointment-check-in.tsx`, `src/components/qr-scanner.tsx`),
staff one-click on `/dashboard/appointments`. APIs: `POST /api/appointments/validate`,
`POST /api/appointments/check-in`, `POST /api/appointments/manage/[reference]/check-in`.
Logic: `redeemAppointment` and `classifyAppointment` (`src/lib/appointments.ts`,
`src/lib/qr.ts`), then `evaluateRecurringVisitor` and `notifyHostArrival`.

### Visitor pass
Issue/rotate/revoke: `/dashboard/visitors` (`visitor-directory.tsx`) →
`POST /api/visitors/[profileId]/pass`; automatic via `evaluateRecurringVisitor`.
Use: kiosk or guard scan → `POST /api/passes/resolve` → today's appointment
(`POST /api/appointments/check-in` with `passToken`) or express walk-in
(`POST /api/passes/walk-in`). Booking prefill: `POST /api/booking/pass/verify`.
Files: `src/lib/visitor-pass.ts`, `src/lib/pass-token.ts`, `src/lib/booking-pass.ts`.

### Delivery log
Entry: `/dashboard` "Log delivery" (`src/app/dashboard/log-delivery.tsx`) →
`POST /api/deliveries` → `createDeliveryLog` (`src/lib/visits.ts`). Stored as a
`DELIVERY` visitor with a visit that is checked in and out at the same instant.

### Step-out and return
Entry: live list row actions (`src/app/dashboard/live-check-ins.tsx`,
`src/components/visit-timeline.tsx`) → `POST /api/visits/[id]/step-out`,
`/return`, `/checkout`, timeline via `GET /api/visits/[id]/events`. Logic:
`markVisitReturning`, `markVisitReturned`, `checkOutVisit` (`src/lib/visits.ts`).
Roll-call shows `PENDING_RETURN` visits as "expected back" (`src/lib/roll-call.ts`).

### Stale-visit closing
`src/lib/stale-visits.ts` (`closeTimeFor`, `closeStaleVisits`,
`sweepStaleVisitsIfDue`); triggers listed in section 6; UI
`src/app/dashboard/close-stale-visits.tsx`. Sets `closedAutomatically`,
`AUTO_CLOSE` event, close time 23:59:59 site time on the check-in day (or the
step-out time for `PENDING_RETURN`).

### Host notification
`notifyHostArrival` (`src/lib/host-notify.ts`) called with `after()` from
`/api/visits`, `/api/passes/walk-in`, `/api/appointments/check-in`,
`/api/appointments/manage/[reference]/check-in`. Requires `Host.email`
(set in `/dashboard/hosts`). Deliveries do not notify.

### Export and register
History: `/dashboard/history` (`src/lib/history.ts`, `history-filters.tsx`,
`history-table.tsx`, `visitor-frequency-chart.tsx`). CSV: `GET /api/visits/export`
(`src/lib/visit-export.ts`, `src/lib/visit-report.ts`), admin only, UTF-8 BOM,
formula neutralisation, `ExportLog` row. Register: `/dashboard/register`
(`src/lib/register.ts`, `src/components/print-table.tsx`, `print-button.tsx`).
Roll-call print: `/dashboard/roll-call` (`roll-call.tsx`).

### Staff accounts and password recovery
`/dashboard/staff` → `/api/staff`, `/api/staff/[id]` (`src/lib/staff.ts`);
`/dashboard/account` → `/api/account/password`; `/forgot-password` and
`/reset-password` → Better Auth endpoints; email via `sendPasswordResetEmail`.

### Kiosk monitoring
`src/app/check-in/kiosk-heartbeat.tsx` (random device id in `localStorage`,
beat every 30 s) → `POST /api/kiosk/heartbeat`; dashboard banner
`src/app/dashboard/kiosk-monitor.tsx` → `GET/PATCH /api/kiosks`.


Unknown devices enter `PENDING` and appear under **Unconfirmed devices**; admins
Approve them into monitoring or Dismiss them into `RETIRED`. Only non-retired
`APPROVED` devices affect status and alerts. Retired identities stay retired on
later heartbeats. `src/lib/kiosk-registration.ts` deletes pending rows unseen
for 7 days on heartbeats and list reads and serializes registration with a
Postgres transaction lock to cap pending rows at 20. Creation has a persistent
5/IP/hour limit in addition to the heartbeat IP/device limits. Existing devices
seen in the last 24 hours were approved by migration; the rest were retired.
Last-seen timestamps use the shared site-zone formatter.

### Seed and test isolation
`prisma/seed.ts` prints its database/schema/host before connecting and refuses
schemas with staff accounts unless `--force` is passed (`db:seed -- --force`
through the package script or direct Prisma CLI `db seed -- --force`). Force
creates only missing records; it never resets passwords or operator data.
`scripts/verify-seed.ts` tests a clean generated scratch schema and drops it in
`finally`. App and seed share `src/lib/database-config.ts` and explicitly pass
`?schema=` to the pg adapter. Unit fixtures and the e2e build/seed/server use the
isolated `e2e` schema. Reset checks the captured client target as well as the
environment; localhost aliases are normalized during isolation checks.
`scripts/run-e2e.ts` clears test rows and the mail sink in `finally`, including
failed runs. Run unit and e2e suites sequentially because they share `e2e`.
`scripts/cleanup-audit-purposes.ts` removes unreferenced `[test]` options and
deactivates referenced ones in the explicitly printed target schema.

## 8. Access matrix (measured)

Measured on 2026-10-14 against `next start` with temporary audit accounts.
Requests to mutating routes used empty JSON bodies or non-existent ids, so a
400/404 for staff means "passed the access check, failed validation".

**Updated 2026-10-15** after the B-01 fix. The tables below show the current
behaviour; `tests/e2e/access-matrix.spec.ts` now measures every route found in
`src/app` (anonymous as document, RSC and plain fetch; guard; admin) and
fails on any regression or unclassified route. Access levels live in
`tests/access-matrix.ts`.

- Anonymous requests to any `/dashboard/*` page, including RSC requests,
  get a 307 to /login from `src/proxy.ts` before rendering, with no data in
  the body. Before the fix, RSC requests returned 200, and document requests
  to `/dashboard/appointments`, `/history` and `/visitors` returned 307 with
  seeded data still in the body (KNOWN_ISSUES "Fixed on 2026-10-15").
- Guards get a real 403 on the admin pages (previously 200 with a meta
  refresh).

| Page | Anonymous | Guard | Admin |
| --- | --- | --- | --- |
| `/` | 200 | 200 | 200 |
| `/check-in` | 200 | 200 | 200 |
| `/check-in/appointment` | 200 | 200 | 200 |
| `/check-in/walkin` | 200 | 200 | 200 |
| `/appointment-booking` | 200 | 200 | 200 |
| `/appointment-booking/manage` | 200 | 200 | 200 |
| `/privacy` | 200 | 200 | 200 |
| `/login` | 200 | 200 | 200 |
| `/forgot-password` | 200 | 200 | 200 |
| `/reset-password` | 200 | 200 | 200 |
| `/dashboard` | 307 → /login | 200 | 200 |
| `/dashboard/appointments` | 307 → /login | 200 | 200 |
| `/dashboard/scan` | 307 → /login | 200 | 200 |
| `/dashboard/history` | 307 → /login | 200 | 200 |
| `/dashboard/register` | 307 → /login | 200 | 200 |
| `/dashboard/roll-call` | 307 → /login | 200 | 200 |
| `/dashboard/visitors` | 307 → /login | 200 | 200 |
| `/dashboard/account` | 307 → /login | 200 | 200 |
| `/dashboard/hosts` | 307 → /login | 403 | 200 |
| `/dashboard/staff` | 307 → /login | 403 | 200 |
| `/dashboard/email-log` | 307 → /login | 403 | 200 |
| `/dashboard/settings/purposes` | 307 → /login | 403 | 200 |
| `/kiosk` | 307 → /check-in | 307 → /check-in | 307 → /check-in |
| `/book` | 307 → /appointment-booking | 307 → /appointment-booking | 307 → /appointment-booking |
| `/does-not-exist` | 404 | 404 | 404 |

| API route | Anonymous | Guard | Admin |
| --- | --- | --- | --- |
| `GET /api/health` | 200 | 200 | 200 |
| `GET /api/visits` | 401 | 200 | 200 |
| `POST /api/visits` | 400 (validation; public) | 400 | 400 |
| `POST /api/deliveries` | 401 | 400 (validation) | 400 (validation) |
| `POST /api/appointments` | 400 (validation; public) | 400 | 400 |
| `POST /api/appointments/validate` | 400 (validation; public) | 400 | 400 |
| `POST /api/appointments/check-in` | 400 (validation; public) | 400 | 400 |
| `POST /api/appointments/manage` | 401 | 400 (validation) | 400 (validation) |
| `DELETE /api/appointments/manage/[reference]` | 401 | 404 | 404 |
| `POST /api/appointments/manage/[reference]/check-in` | 401 | 404 | 404 |
| `POST /api/appointments/manage/[reference]/regenerate-qr` | 401 | 404 | 404 |
| `POST /api/appointments/manage/[reference]/reschedule` | 401 | 400 (validation) | 400 (validation) |
| `POST /api/booking/lookup` | 400 (validation; public) | 400 | 400 |
| `POST /api/booking/verify` | 400 (validation; public) | 400 | 400 |
| `POST /api/booking/sign-out` | 200 | 200 | 200 |
| `POST /api/booking/pass/verify` | 403 (invalid pass; public) | 403 | 403 |
| `POST /api/booking/pass/rotate` | 401 (no visitor cookie) | 401 | 401 |
| `POST /api/booking/appointments/[reference]/cancel` | 404 (no token) | 404 | 404 |
| `POST /api/booking/appointments/[reference]/reschedule` | 404 (no token) | 404 | 404 |
| `POST /api/passes/resolve` | 403 (invalid pass; public) | 403 | 403 |
| `POST /api/passes/walk-in` | 400 (validation; public) | 400 | 400 |
| `POST /api/visitors/[profileId]/pass` | 401 | 404 | 404 |
| `POST /api/visits/[id]/checkout` | 401 | 404 | 404 |
| `GET /api/visits/[id]/events` | 401 | 404 | 404 |
| `POST /api/visits/[id]/step-out` | 401 | 404 | 404 |
| `POST /api/visits/[id]/return` | 401 | 404 | 404 |
| `GET /api/visits/close-stale` | 401 | 200 | 200 |
| `POST /api/visits/close-stale` | 401 | 403 | 200 |
| `GET /api/visits/export` | 401 | 403 | 200 |
| `GET /api/dashboard/stats` | 401 | 200 | 200 |
| `GET /api/roll-call` | 401 | 200 | 200 |
| `GET /api/kiosks` | 401 | 200 | 200 |
| `PATCH /api/kiosks` | 401 | 403 | 400 (validation) |
| `POST /api/kiosk/heartbeat` | 400 (validation; public) | 400 | 400 |
| `POST /api/email-log/retry` | 401 | 403 | 400 (validation) |
| `POST /api/cron/close-stale-visits` | 401 (no bearer) | 401 | 401 |
| `POST /api/cron/process-email-outbox` | 401 (no bearer) | 401 | 401 |
| `POST /api/hosts` | 401 | 403 | 400 (validation) |
| `PATCH /api/hosts/[id]` | 401 | 403 | 400 (validation) |
| `POST /api/purposes` | 401 | 403 | 400 (validation) |
| `PATCH /api/purposes/[id]` | 401 | 403 | 400 (validation) |
| `POST /api/purposes/[id]/move` | 401 | 403 | 400 (validation) |
| `POST /api/staff` | 401 | 403 | 400 (validation) |
| `PATCH /api/staff/[id]` | 401 | 403 | 400 (validation) |
| `DELETE /api/staff/[id]` | 401 | 403 | 404 |
| `POST /api/account/password` | 401 | 400 (validation) | 400 (validation) |
| `GET /api/auth/get-session` | 200 (`null`) | 200 | 200 |
| `POST /api/auth/sign-up/email` | 400 (sign-up disabled) | 400 | 400 |

With a valid `CRON_SECRET` both cron routes returned 200; a wrong bearer
returned 401 (verified in the flow run).
