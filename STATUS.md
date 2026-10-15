# VMS — Project Status

Current project snapshot. See [CHANGELOG.md](./CHANGELOG.md) for dated changes and
[CONTINUATION.md](./CONTINUATION.md) for the deferred work list. For a full
project briefing (architecture, features, API surface, known issues, roadmap and
deployment checklist) see [docs/PROJECT-HANDOFF.md](./docs/PROJECT-HANDOFF.md).

The 2026-10-14 audit produced [docs/APP_MAP.md](./docs/APP_MAP.md) (routes,
roles, models, settings, emails, jobs, flows and the measured access matrix),
[docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md) (prioritized findings and health
check results) and [docs/screens/](./docs/screens/README.md) (screenshots; kept local and gitignored because they show real-looking personal details).

## Conventions

- Update [docs/APP_MAP.md](./docs/APP_MAP.md) in the same change whenever a
  page or API route, its access rule, a Prisma model or field, a setting or
  environment variable, an email, a scheduled job, or a main flow is added,
  removed or changed.
- When a finding in [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md) is fixed,
  remove it there and note the fix in [CHANGELOG.md](./CHANGELOG.md).

**Updated:** 2026-10-15
**Branch:** staging
**Database:** local `vms` development schema `public`, automated tests in isolated schema `e2e` on PostgreSQL port 5432 (the older `vms_test` database is no longer used by the default runner)
**Organization label:** generic `Visitor Management System` in `src/lib/site-config.ts`
**Migrations:** 23 applied to development `public` and isolated `e2e` schemas
**Working tree:** substantial existing uncommitted work; preserve it

## Current verification

Robustness work adds a health endpoint, kiosk monitoring, persistent email
delivery/retries, structured logs and API errors, database-backed public limits,
isolated Playwright tests, CI, and Postgres backup tooling. See
[operations and testing](./docs/robustness.md).

The backup command was attempted on 2026-10-13 and reported a skip because
`pg_dump` is not installed/on PATH. No system packages were installed. A dump
and scratch-schema restore/drop verification therefore remain unexecuted on
this machine. Real deployments should rely on the database provider's managed
backups with point-in-time recovery; local dumps are supplementary.

| Check | Result |
| --- | --- |
| Migration deploy | 23 migrations applied to development `public` and isolated `e2e`; kiosk approval migration verified with 23/25-hour devices in a non-UTC database session |
| Prisma client | Regenerated for the current schema |
| Seed safety | Clean scratch schema migrated and seeded; target printed, repeat refused without --force, operator data/passwords preserved with --force, missing records restored; development unchanged and scratch dropped |
| Lint | Passed; two existing unused-variable warnings in `src/test.ts` |
| TypeScript | Passed via the production build and installed TypeScript entry point, using project tsconfig exclusions |
| Automated tests | 130 unit/service tests across 17 modules (26 suites) passed; zero skips. Ran the package test command through the installed Node entry point; Windows child-process sandbox restrictions required approved execution access |
| End-to-end tests | All 18 Chromium Playwright tests passed together via `scripts/run-e2e.ts`; includes access matrix, kiosk approval/dismissal/limits and staff create/reschedule/history boundaries in UTC and America/Los_Angeles; zero skips |
| Emergency roll-call | Guard/admin browser tests passed for access, ticks after refresh/reload/polling, clearing and print styles. Four-page A4 portrait PDFs visually checked; native Chrome preview unavailable |
| HTTP robustness | Health 200 and simulated DB-failure 503, bounded heartbeat input, consistent API errors, email retry/expiry, persistent booking/lookup limits, kiosk alerts and admin controls verified |
| Development isolation | No E2E staff/profile/appointment fixtures in development; all 18 isolated test tables verified empty after testing. Development retains seed/demo data and historical test records; five referenced `[test]` purpose options were deactivated (none unused to delete) |
| Dev server | Restarted hidden on port 3000; `/api/health` returned 200 with database status `ok`; logs in gitignored `logs/` |
| Earlier HTTP verification | Reporting, booking-pass and password-reset suites passed before this robustness work; their temporary fixtures were removed |
| Production build | Passed with configured local auth secrets; the pg concurrent-query deprecation remains (traced to Prisma internal transaction queries, not a trivial local fix) |
| Excel and print preview | Manual export/print verification remains pending; application workflows are covered by Playwright |

The complete current commands are in [README.md](./README.md). Reporting,
booking-pass, and password-reset HTTP verification scripts are
`npm run test:http:reporting`, `npm run test:http:booking-pass`, and
`npm run test:http:password-reset`.

## Working features

- Public walk-in, appointment and staff-assisted visitor check-in; guard QR
  scanning; logged deliveries; check-out, step-out and return tracking.
- Stale visits close before live-list and history reads. An authenticated cron
  endpoint is available for external scheduling.
- Appointment self-service and staff management, event history, QR replacement,
  visitor passes, and returning-visitor booking by scanned or pasted pass QR ID.
  Returning visitors can switch to name and email verification.
- Visitor pass emails use the persistent outbox with inline QR attachments.
  Staff can queue the current QR without rotating its credential. Codes, reset
  links and pass tokens are no longer printed in development logs.
- Optional host arrival notices are sent after walk-in, pass and appointment
  check-in. Password recovery uses Better Auth reset endpoints, generic
  responses, one-hour links and session revocation.
- Public appointment booking is rate-limited, and a partial unique index
  prevents pending bookings for the same host and time. Purpose labels are
  unique without case sensitivity.
- Searchable history with shared name, date range, host and type filtering.
  Admins can export all matching rows as a streamed CSV; guards do not see the
  export action.
- Printable daily register at `/dashboard/register`, available to guards and
  admins. The dashboard and history page link to it.
- The register uses the same generic organization name as the kiosk header,
  site-time-zone day boundaries, a visit summary and print attribution. Its
  reusable table component supports future printable pages.
- Emergency roll-call at `/dashboard/roll-call` is available to guards and
  admins from every dashboard header. Stale visits close before reading;
  expected-back visitors have a separate headcount. Local ticks survive refresh,
  and the shared print table uses A4 portrait with empty checkbox squares.
- Business-facing interface and project documentation use text labels and SVG
  icons without emoji.

## Data and routes

Prisma includes Better Auth models and `User`, `Host`, `Visitor`, `Visit`,
`VisitEvent`, `Appointment`, `AppointmentEvent`, `PurposeOption`,
`VisitorProfile`, `VisitorVerification`, `VisitorPass`, and `ExportLog`.
The generated Prisma client is under `src/generated/prisma/`.

| Route | Access | Description |
| --- | --- | --- |
| `/check-in` | Public | Visitor check-in chooser |
| `/appointment-booking` | Public | New and returning visitor booking |
| `/dashboard` | Staff | Live register, deliveries and today's register entry |
| `/dashboard/history` | Staff | Filtered history, admin CSV export and register entry |
| `/dashboard/register` | Staff | Daily printable visitor register |
| `/dashboard/roll-call` | Staff | Emergency on-site and expected-back headcounts, local ticks and print |
| `/dashboard/appointments` | Staff | Expected arrivals and appointment actions |
| `/dashboard/visitors` | Staff | Visitor profile and pass actions |
| `/dashboard/hosts`, `/dashboard/staff` | Admin | Directory and staff administration |
| `GET /api/visits/export` | Admin | Streamed CSV export; other roles receive 403 |
| `POST /api/booking/pass/verify` | Public | Validate a pass for booking prefill |
| `POST /api/visitors/[profileId]/pass` | Staff | Issue, send, rotate or revoke a visitor pass |

See [docs/visit-reporting.md](./docs/visit-reporting.md) and
[docs/visitor-pass.md](./docs/visitor-pass.md) and
[docs/notifications-and-password-recovery.md](./docs/notifications-and-password-recovery.md)
for implementation details.
Each organization uses a separate deployment and database. The deployment
checklist and future shared-database migration are tracked in
[MULTI_TENANCY_TODO.md](./MULTI_TENANCY_TODO.md).

## Known gaps

Group bookings, complete identity linking across anonymous walk-ins and legacy
delivery records, multi-instance rate limiting, and pass-secret rotation remain
future product/infrastructure work. Production mail, secrets, origin/TLS,
privacy details, and fixture credential rotation need environment-specific
setup.

See [CONTINUATION.md](./CONTINUATION.md) for the full deferred list and
verification items.
