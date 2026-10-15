# Visitor Management System — Project Handoff & Status Report

Self-contained project briefing for a project manager or incoming engineer. Covers
what the system does, how it is built, what is finished, what still needs work, and
what must happen before a real deployment.

| Field | Value |
| --- | --- |
| Product | Visitor Management System (VMS) |
| Document date | 2026-10-13 |
| Branch | `staging` |
| Working tree | Substantial uncommitted work present; preserve it |
| Deployment model | One deployment + one PostgreSQL database per organization |
| Overall state | Feature-complete for core visitor workflows; production hardening and a few product items remain |

Companion documents: [STATUS.md](../STATUS.md) (snapshot), [CONTINUATION.md](../CONTINUATION.md)
(open checklist), [CHANGELOG.md](../CHANGELOG.md) (dated history), and the focused notes
in [docs/](#14-documentation-index).

---

## 1. Executive summary

The VMS is a single-organization visitor management application built on Next.js
(App Router), TypeScript, Tailwind, Prisma and PostgreSQL. Visitors register at a
kiosk or online; staff manage arrivals, appointments, deliveries, visitor passes,
the daily register and emergency roll-call.

Core functionality is implemented and working:

- Public kiosk check-in (walk-in, appointment QR/reference, and visitor-pass express).
- Self-service appointment booking with returning-visitor recognition and email verification.
- Reusable visitor passes with a signed QR credential, automatic issuance, and staff management.
- Staff dashboard: live floor, check-out / step-out / return tracking, deliveries, history, search and CSV export.
- Appointment self-service (visitor) and staff management (book, reschedule, cancel, regenerate QR, one-click check-in).
- Printable daily register and emergency roll-call.
- Host arrival email notices, persistent email outbox with retries, and staff password recovery.
- Audit trails (per-visit event log, per-appointment event log, export log), timezone-aware stale-visit auto-closing, rate limiting, health endpoint, kiosk monitoring and backups tooling.

Verification is strong: 102 unit/service tests across 11 modules, 11 Playwright
end-to-end tests (all passing on Chromium), lint and typecheck passing, and HTTP
integration checks for reporting, booking-pass and password reset.

The remaining work is concentrated in four buckets:

1. **Production configuration** — real email provider, strong secrets, HTTPS/origins, organization name/timezone, privacy notice, backups and cron scheduler.
2. **A handful of unverified manual checks** — native Chrome print preview, Excel export rendering, live camera scanning on HTTPS, real email delivery.
3. **Deferred product work** — group bookings, cross-visit identity linking, shared (multi-instance) rate limits, pass-secret rotation.
4. **Optional architecture change** — a shared-database multi-tenant rewrite, which is explicitly *not* the chosen model today.

---

## 2. What the product does

### Users

| Role | How they use it |
| --- | --- |
| Visitor | Self check-in at the kiosk; book and manage appointments online; hold a visitor pass |
| Guard | Staff dashboard: live floor, check-out/return, scanner, log deliveries, history, register, roll-call |
| Admin | Everything a guard can do, plus hosts, staff accounts, purpose options, CSV export, email log, bulk stale-visit closure |

### Primary journeys

1. **Walk-in** — Visitor chooses "Walk-in" at the kiosk, enters name, host and purpose, and is checked in.
2. **Appointment** — Visitor books online, receives a QR by email; at the kiosk or guard scanner the QR/reference is redeemed into a visit.
3. **Visitor pass** — A frequent visitor gets a persistent QR pass; scanning it checks them in (redeeming a matching appointment or creating an express walk-in) and renews the pass.
4. **Returning booking** — On the booking page the visitor can use a pass QR, or verify their email with a 6-digit code, to prefill saved details.
5. **Delivery** — A guard logs a courier drop-off from the dashboard (host or typed department, optional note); it is recorded as already complete.
6. **Check-out lifecycle** — Guard checks a visitor out, or marks them stepped-out/expected-back; stale visits close automatically at end of day.
7. **Reporting** — Staff search history and print the daily register; admins export all matching rows to CSV.
8. **Emergency roll-call** — Staff open the roll-call page for an on-site headcount and an expected-back list, with local accounted-for ticks and a printable sheet.

---

## 3. Technology and architecture

| Layer | Choice |
| --- | --- |
| Framework | Next.js 16.3.4 (App Router, server components, route handlers) |
| Language | TypeScript 5 |
| UI | React 19.2.8, Tailwind CSS 4, plain-text labels + SVG icons (no emoji) |
| Charts | Recharts 3 |
| Database | PostgreSQL via Prisma 7.10.0 (`@prisma/adapter-pg` driver adapter) |
| Auth | Better Auth 1.7.5 (email + password, sign-up disabled) |
| Email | Resend 6 with a persistent database outbox |
| QR | `qrcode` (generation) and `html5-qrcode` (camera scanning) |
| Tests | Node `node:test` (unit/service) + Playwright (e2e) |
| Package manager | Bun 1.4.0 (npm scripts also work) |

### Architectural notes

- **Prisma 7** reads its datasource URL and seed command from `prisma7.config.ts`, not from the schema. The generated client is written to `src/generated/prisma/` and regenerated on `postinstall`.
- **Single database client** (`src/lib/prisma.ts`) over the `PrismaPg` adapter.
- **Route wrapper** `withApi()` (`src/lib/api.ts`) assigns a request id, normalizes error bodies to `{ error: { code, message, requestId } }`, logs 5xx, and after each response opportunistically drains the email outbox and prunes rate-limit rows.
- **No global middleware** — every route handler enforces its own authentication and role checks.
- **Session** is read once per request via a cached `getSession()`; any role that is not `ADMIN` is treated as `GUARD`.
- **Server modules** under `src/lib/` hold domain logic (visits, appointments, passes, booking, email, reporting, rate limiting, config); route handlers are thin.
- **Public configuration** (`NEXT_PUBLIC_*`) is embedded at build time, so organization name/timezone are per-deployment build settings.

### Repository layout

```
prisma/            schema.prisma, 21 migrations, seed.ts, seed-e2e.ts, repair scripts
src/app/            routes and pages (api/ = route handlers, rest = pages)
src/components/     shared UI (nav, name fields, QR scanner, print table, timeline, badges)
src/lib/            domain logic and infrastructure
src/generated/      generated Prisma client (do not edit)
tests/              node:test suites, HTTP verification scripts, Playwright e2e/
scripts/            backup, restore, e2e runner, isolation audit, postgres tools
docs/               focused feature and operations notes
.github/workflows/  CI
```

---

## 4. Features implemented

### 4.1 Kiosk and visitor check-in

- Kiosk chooser at `/check-in` with appointment and walk-in paths.
- Walk-in form with host and purpose selection; public endpoint is rate limited.
- Appointment check-in by scanning QR or typing the reference number.
- Visitor-pass express check-in (single matching appointment, a picker, or an express walk-in).
- Idle timeout reset on the shared kiosk, and a kiosk heartbeat for device monitoring.
- Deliveries are guard-only (not exposed at the public kiosk).

### 4.2 Appointments

- Public self-service booking with slot validation, booking window, and consent capture.
- Staff pre-registration from the dashboard.
- Visitor manage page (signed link or email verification): QR display, calendar file, reschedule, cancel.
- Staff appointment board: create, search, one-click check-in, reschedule, cancel, regenerate QR, expandable event log.
- Status lifecycle PENDING / CHECKED_IN / CANCELLED / EXPIRED with a partial unique index preventing double-booking the same host and time.
- Per-appointment event history with actor attribution.

### 4.3 Visitor passes

- Canonical HMAC-signed token `vp1.<passId>.<mac>`; the secret is never in the token and the pass is re-rendered on demand.
- Automatic issuance when a profile reaches the recurring-visit threshold within the window.
- Staff actions from `/dashboard/visitors`: issue, revoke, rotate, send QR.
- Visitor self-service "My pass" with replace (rotate) and QR download.
- Pass used to prefill the booking form (validated, but does not grant manage access).
- Expiry is derived from `expiresAt` and pushed forward on use; at most one active pass per profile.
- Full mechanism documented in [docs/visitor-pass.md](./visitor-pass.md).

### 4.4 Dashboard and floor management

- Live check-ins with check-out, step-out (expected back) and return.
- Guard QR scanner.
- Delivery logging modal.
- Stale-visit bulk closure (admin) and automatic end-of-day closure.
- Host arrival notifications after walk-in, pass, and appointment check-ins.

### 4.5 Reporting

- History with shared name / inclusive date range / host / type filters and pagination.
- Visitor frequency chart.
- Admin-only streamed CSV export of every matching row (cursor batches, UTF-8 BOM, CRLF, spreadsheet-formula protection) with an `ExportLog` audit row.
- Printable daily register (A4 landscape, repeating header, non-splitting rows).
- Emergency roll-call (on-site vs. expected-back, local ticks, A4 portrait print).
- See [docs/visit-reporting.md](./visit-reporting.md) and [docs/emergency-roll-call.md](./emergency-roll-call.md).

### 4.6 Administration

- Host directory (create/edit; soft-delete only, because `Visitor.hostId` is restricted).
- Staff accounts (create, promote/demote, delete) with last-admin and self-action guards.
- Purpose options (add, rename, hide, reorder).
- Email outbox log with status filter and manual retry.
- Account page with self-service password change.

### 4.7 Notifications and account recovery

- Persistent email outbox: persisted before send, claimed for 5 minutes, retried on a backoff schedule, expired on 6th failure.
- Appointment, pass, host-arrival and password-reset emails via a configured Resend sender.
- Staff forgot/reset password with generic responses, 1-hour links, and session revocation on reset.
- See [docs/notifications-and-password-recovery.md](./notifications-and-password-recovery.md).

### 4.8 Reliability, security and operations

- `GET /api/health` for external monitors; kiosk online/offline/retired status and dashboard monitoring.
- Rate limiting: in-memory for some routes, database-backed counters for booking, verification and heartbeats.
- Timezone-aware stale-visit closing with an honest auto-closed marker.
- Stale-visit cron endpoint (bearer secret) for external schedulers.
- Structured JSON logging with redaction and request ids; optional error webhook.
- Backup/restore scripts and a Playwright-based e2e runner with an isolation audit.
- See [docs/robustness.md](./robustness.md).

---

## 5. Data model overview

Prisma models (all in `prisma/schema.prisma`):

| Model | Purpose |
| --- | --- |
| `User`, `Session`, `Account`, `Verification` | Better Auth staff accounts and sessions |
| `Host` | Directory entry a visitor is visiting; soft-deleted, restricted on delete |
| `PurposeOption` | Admin-managed "purpose of visit" lookup; retired, never deleted |
| `Visitor` | Per-visit person record (guest or delivery); split first/last name |
| `Visit` | A single visit with status, exit time, check-in method and audit attribution |
| `VisitEvent` | Append-only per-visit timeline (check-in, step-out, return, check-out, auto-close) |
| `Appointment` | Pre-registered visit with QR token, reference number, status and events |
| `AppointmentEvent` | Append-only per-appointment change log |
| `VisitorProfile` | Returning person identified by email + name key |
| `VisitorPass` | Bearer QR credential for a profile (versioned, revocable) |
| `VisitorVerification` | One-time emailed code for booking identity proof |
| `EmailOutbox` | Durable outbound email queue |
| `RateLimitBucket` | Database-backed fixed-window counters |
| `KioskDevice` | Registered kiosk devices and last-seen heartbeat |
| `ExportLog` | CSV export audit retained independently of staff accounts |

Migrations: **21 applied** to both the development `public` schema and the isolated `e2e` schema.

---

## 6. API surface

All routes are wrapped by `withApi()`. Auth legend: **Public**, **Staff** (any
role), **Admin**, **Cron-secret**, **Visitor-credential** (signed cookie / token).

| Area | Route | Auth | Summary |
| --- | --- | --- | --- |
| Auth | `GET/POST /api/auth/[...all]` | Public | Better Auth endpoints (sign-in/out, session, password reset). Sign-up disabled; role not client-settable |
| Account | `POST /api/account/password` | Staff | Change own password; revokes other sessions |
| Kiosk | `POST /api/kiosk/heartbeat` | Public | Device liveness (rate limited, strict body) |
| Kiosk | `GET/PATCH /api/kiosks` | Staff / Admin | List devices; label or retire a device |
| Health | `GET /api/health` | Public | `SELECT 1`; 200 or 503 |
| Cron | `POST /api/cron/close-stale-visits` | Cron-secret | Close previous-day stale visits |
| Cron | `POST /api/cron/process-email-outbox` | Cron-secret | Drain the email outbox |
| Email log | `POST /api/email-log/retry` | Admin | Re-queue a non-expired outbox message |
| Deliveries | `POST /api/deliveries` | Staff | Log a courier drop-off |
| Hosts | `POST /api/hosts` | Admin | Add a host |
| Hosts | `PATCH /api/hosts/[id]` | Admin | Edit/deactivate a host (no delete) |
| Staff | `POST /api/staff` | Admin | Create a staff login |
| Staff | `PATCH/DELETE /api/staff/[id]` | Admin | Change role / delete (last-admin and self-action guards) |
| Purposes | `POST /api/purposes` | Admin | Add a purpose option |
| Purposes | `PATCH /api/purposes/[id]` | Admin | Rename or toggle active |
| Purposes | `POST /api/purposes/[id]/move` | Admin | Reorder |
| Dashboard | `GET /api/dashboard/stats` | Staff | Today's summary counts for the dashboard cards |
| Roll call | `GET /api/roll-call` | Staff | On-site / expected-back snapshot |
| Visits | `GET /api/visits` | Staff | Active visits |
| Visits | `POST /api/visits` | Public | Kiosk walk-in check-in (rate limited) |
| Visits | `GET/POST /api/visits/close-stale` | Staff / Admin | Count / bulk-close stale visits |
| Visits | `POST /api/visits/[id]/checkout` | Staff | Check out with audit name |
| Visits | `POST /api/visits/[id]/step-out` | Staff | Mark expected back |
| Visits | `POST /api/visits/[id]/return` | Staff | Resume a stepped-out visit |
| Visits | `GET /api/visits/[id]/events` | Staff | Visit timeline |
| Visits | `GET /api/visits/export` | Admin | Streamed CSV export (guards get 403) |
| Appointments | `POST /api/appointments` | Public | Book an appointment (rate limited, consent required) |
| Appointments | `POST /api/appointments/validate` | Public | Validate QR/reference for check-in |
| Appointments | `POST /api/appointments/check-in` | Public (staff if `assisted`) | Redeem a code into a visit |
| Appointments | `POST /api/appointments/manage` | Staff | Staff pre-registration |
| Appointments | `DELETE .../manage/[reference]` | Staff | Cancel |
| Appointments | `POST .../manage/[reference]/reschedule` | Staff | Reschedule |
| Appointments | `POST .../manage/[reference]/check-in` | Staff | One-click check-in |
| Appointments | `POST .../manage/[reference]/regenerate-qr` | Staff | New QR; old code and links die |
| Booking | `POST /api/booking/lookup` | Public | Request a verification code (neutral response) |
| Booking | `POST /api/booking/verify` | Public | Exchange code for a signed cookie + profile |
| Booking | `POST /api/booking/sign-out` | Public | Clear visitor cookies |
| Booking | `POST /api/booking/pass/verify` | Public | Verify a pass token for booking prefill |
| Booking | `POST /api/booking/pass/rotate` | Visitor-credential | Replace own pass |
| Booking | `POST /api/booking/appointments/[reference]/cancel` | Visitor-credential | Visitor cancels own appointment |
| Booking | `POST /api/booking/appointments/[reference]/reschedule` | Visitor-credential | Visitor reschedules own appointment |
| Passes | `POST /api/passes/resolve` | Public | Resolve a scanned pass to check-in options |
| Passes | `POST /api/passes/walk-in` | Public (staff if `assisted`) | Express pass walk-in, renews pass |
| Visitors | `POST /api/visitors/[profileId]/pass` | Staff | Issue / revoke / rotate / send a pass |

---

## 7. Security and access control

- **Authentication** via Better Auth; sign-up disabled, role is not client-settable, sessions last 8 hours.
- **Authorization** enforced server-side per route (`requireAdmin()`, session role checks). The UI hides actions by role, but never as the only control.
- **Public write endpoints** are all rate limited; booking/verification use database-backed counters so limits survive restarts and multiple instances share them.
- **Bearer credentials**: appointment QR tokens and visitor passes are HMAC-signed; tokens and codes are never written to application logs.
- **Password recovery and booking lookups** return generic responses that do not reveal whether an account or profile exists.
- **Cookie hardening**: verification and pass-prefill cookies are httpOnly, short-lived, and path-scoped; successful password reset revokes active sessions.
- **Referential safety**: hosts are deactivated rather than deleted, and visit audit attribution keeps both a live user id and a copied name so removing an account never destroys history.
- **CSV injection** is neutralized on export; error bodies are normalized and request ids are logged.
- **Known residual gap**: some kiosk/login routes still use the in-memory limiter, which is per-process and can be spoofed through forwarding headers if the reverse proxy is not configured to overwrite them.

---

## 8. Verification status

Source: [STATUS.md](../STATUS.md) and [docs/robustness.md](./robustness.md).

| Check | Result |
| --- | --- |
| Migrations | 21 applied to development `public` and isolated `e2e`; none pending |
| Prisma client | Regenerated for the current schema |
| Lint | Passed |
| TypeScript | Passed (with the empty untracked `src/test.ts` excluded) |
| Unit/service tests | 102 tests across 11 modules passed; zero skips |
| End-to-end tests | 11 Chromium Playwright tests passed together, including both roll-call roles |
| HTTP robustness | Health, simulated DB-failure 503, rate limits, email retry/expiry, kiosk alerts verified |
| Reporting / booking-pass / password-reset HTTP checks | Passed against a local server |
| Production build | Passed (local warnings only because Better Auth secrets are unset) |
| Test isolation | Audit found no e2e fixtures leaked into development |

Still to verify manually (see section 11): native Chrome print preview, Excel
rendering of accented/formula names, a live browser guard export-403 check, real
provider email delivery and host notices, and camera QR scanning on HTTPS.

---

## 9. Known issues and things to fix

Ordered by likely impact. None are known to break core workflows today.

### 9.1 Production blockers (will bite in a real deployment)

1. **Unconfigured secrets and origin.** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BOOKING_VERIFY_SECRET`, `PASS_SECRET` and `CRON_SECRET` currently fall back to development values or empty. Production needs strong, unique, per-deployment values.
2. **Email not configured.** Without `RESEND_API_KEY` and a verified `APPOINTMENT_FROM_EMAIL`, all messages queue for retry instead of sending. Appointments, passes, host notices and password resets depend on this.
3. **Privacy notice is a placeholder.** `src/app/privacy/page.tsx` explicitly says it is not legal text and must be completed with the organization's contact, retention period, access process and service providers.
4. **No cron scheduler.** The stale-visit and email-outbox endpoints exist but nothing calls them on a schedule in production.
5. **Backups unproven locally.** The backup command skipped because `pg_dump` is not on PATH on this machine; a real restore has not been exercised. Production should rely on managed database backups with point-in-time recovery.
6. **Generic organization identity.** The deployment name and timezone default to `Visitor Management System` / `Asia/Manila` and must be set before building.

### 9.2 Code and behavior issues

1. **Stale unit test expectation.** `tests/stale-visits.test.ts` still asserts the older `endOfLocalDay()` rule rather than the current timezone-aware closing; it needs updating.
2. **In-memory rate limits** remain on kiosk check-in and login. They are per-process (not shared across instances) and depend on trusted forwarding headers.
3. **Legacy open deliveries.** Deliveries created by the retired kiosk flow were not backfilled; any still `ACTIVE` stay in the live list until stale cleanup closes them.
4. **No visitor identity across visits.** Anonymous walk-ins and legacy delivery records cannot be linked; only booked/pass visitors get a `VisitorProfile`. `VisitEvent` timelines are therefore scoped to a single visit.
5. **Stepped-out round trips leave no trace on the visit row.** `PENDING_RETURN` only reflects the current state; history does not show that a visit stepped out and returned (only the event log does).
6. **Purpose label uniqueness is case-sensitive.** "Meeting" and "meeting" could both exist; the desired `lower(trim(label))` functional index is not expressible in the Prisma schema.
7. **Browser autofill caveat.** Chrome/Edge ignore `autocomplete="off"` on password fields, so the password manager may still offer saved credentials.

---

## 10. What still needs to be done

Source: [CONTINUATION.md](../CONTINUATION.md).

### 10.1 Product work

- [ ] Group appointments, and a product decision on linking records for anonymous walk-ins and legacy deliveries.
- [ ] Shared rate limits for the remaining kiosk/in-memory routes if multiple app instances are run.
- [ ] A staged visitor-pass secret rotation design before ever changing `PASS_SECRET` (a single change invalidates every active pass).

### 10.2 Explicitly out of current scope

PDF libraries, scheduled or emailed reports, signature columns, and an export-log UI remain excluded. Browser print-to-PDF covers the register and roll-call.

### 10.3 Manual verification still pending

- [ ] Chrome print preview: A4 landscape, repeating header, rows that do not split (daily register).
- [ ] Native Chrome print preview for roll-call (Chromium PDFs were checked; native preview was not).
- [ ] Open an exported CSV in Excel: accented names (`José`) render correctly and formula-like names are text.
- [ ] Live HTTP role check: a guard gets 403 from export while still being able to open and print the register.
- [ ] Real email delivery and host arrival notices with a configured provider.
- [ ] Camera QR scanning in a browser on the deployed HTTPS origin.

### 10.4 Environment and production setup

- [ ] Configure `RESEND_API_KEY` and a verified `APPOINTMENT_FROM_EMAIL`; test every message type.
- [ ] Set strong production values for `BETTER_AUTH_SECRET`, `BOOKING_VERIFY_SECRET`, `PASS_SECRET`, `CRON_SECRET`; configure `BETTER_AUTH_URL`, HTTPS and trusted origins.
- [ ] Replace seeded fixture passwords before deployment.
- [ ] Set `NEXT_PUBLIC_ORGANIZATION_NAME` and `NEXT_PUBLIC_SITE_TIMEZONE` (and optional label) before building each deployment.
- [ ] Complete the privacy notice.
- [ ] Configure backup, retention and restore procedures per database.

---

## 11. Deployment and production readiness checklist

| Area | Requirement |
| --- | --- |
| Runtime | Node.js supported by Next.js 16; PostgreSQL |
| Build | Set `NEXT_PUBLIC_*` values first — they are embedded at build time |
| Migrations | Run `prisma migrate deploy` against the production database (not `migrate dev`) |
| Secrets | Unique `BETTER_AUTH_SECRET`, `BOOKING_VERIFY_SECRET`, `PASS_SECRET`, `CRON_SECRET` per deployment |
| Origin/TLS | HTTPS with `BETTER_AUTH_URL` and trusted origins; required for camera scanning and secure cookies |
| Email | Verified Resend sender; monitor the admin email log and configure outbox retention/access |
| Reverse proxy | Overwrite forwarding headers so IP-based rate limits cannot be spoofed |
| Cron | Schedule `POST /api/cron/close-stale-visits` and `POST /api/cron/process-email-outbox` with the bearer secret |
| Backups | Managed provider backups with point-in-time recovery; locally test a restore |
| Privacy | Completed notice with contact, retention, access and service-provider details |
| Fixtures | Do not ship seeded credentials or test data to production |

---

## 12. Architecture options and multi-tenancy

The selected model is **one deployment and one PostgreSQL database per
organization**. This keeps each organization's hosts, visits, bookings, staff,
passes, export audit and rate-limit state physically separate without an
organization discriminator on every query.

A shared-database SaaS model is **not implemented** and would be a larger
migration: it requires an `Organization` model, tenant-scoped queries and
composite constraints, organization-scoped settings/secrets/rate limits, a
trusted host-to-organization resolver for public routes, and a data migration of
all existing rows. Details and a checklist are in
[MULTI_TENANCY_TODO.md](../MULTI_TENANCY_TODO.md). `TODO(multi-tenancy)` comments
in the code mark the deployment-global settings that would need revisiting.

---

## 13. Commands reference

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server (`server.mjs --dev`) |
| `npm run build` / `npm run start` | Build and serve production (`server.mjs`) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Check TypeScript |
| `npm run db:migrate` | Create/apply a development migration |
| `npm run test:migrate` | Apply migrations to the isolated test database |
| `npm run db:seed` | Seed local development data |
| `npm run db:studio` | Open Prisma Studio |
| `npm test` | Run database-backed unit and service tests |
| `bun run test:e2e` | Migrate, seed, build and run Playwright in the isolated schema |
| `bun run db:backup` | Write a compressed Postgres dump, retain the latest 14 |
| `bun run db:restore -- <dump>` | Restore into a separate empty database |
| `npm run test:pass-token` | Pass-token focused tests |
| `npm run test:http:reporting` | Reporting HTTP checks against a local server |
| `npm run test:http:booking-pass` | Booking-pass HTTP checks against a local server |
| `npm run test:http:password-reset` | Password-reset HTTP verification against a local server |

---

## 14. Documentation index

| Document | Covers |
| --- | --- |
| [STATUS.md](../STATUS.md) | Current snapshot, working features, known gaps |
| [CONTINUATION.md](../CONTINUATION.md) | Open checklist of deferred and pending work |
| [CHANGELOG.md](../CHANGELOG.md) | Dated history of changes |
| [docs/visitor-pass.md](./visitor-pass.md) | Visitor pass mechanism, token format, trust model |
| [docs/visit-reporting.md](./visit-reporting.md) | CSV export, daily register, print table |
| [docs/emergency-roll-call.md](./emergency-roll-call.md) | Roll-call behavior, ticks, print |
| [docs/notifications-and-password-recovery.md](./notifications-and-password-recovery.md) | Host notices, password reset |
| [docs/robustness.md](./robustness.md) | Health, kiosk monitoring, email outbox, tests, backups |
| [MULTI_TENANCY_TODO.md](../MULTI_TENANCY_TODO.md) | Per-deployment isolation and future shared-database migration |
| [README.md](../README.md) | Setup, commands, routes, reporting summary |
