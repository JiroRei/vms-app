# Visitor Management System

A single-organization visitor management app built with Next.js App Router,
TypeScript, Tailwind, Prisma and PostgreSQL. Visitors check in at a kiosk;
staff manage arrivals, appointments, visitor passes and the daily register.

- Project handoff and status report: [docs/PROJECT-HANDOFF.md](./docs/PROJECT-HANDOFF.md)
- Current status: [STATUS.md](./STATUS.md)
- Deferred and pending work: [CONTINUATION.md](./CONTINUATION.md)
- Dated changes: [CHANGELOG.md](./CHANGELOG.md)
- Visit reporting details: [docs/visit-reporting.md](./docs/visit-reporting.md)
- Visitor pass details: [docs/visitor-pass.md](./docs/visitor-pass.md)
- Notifications and password recovery: [docs/notifications-and-password-recovery.md](./docs/notifications-and-password-recovery.md)
- Health, kiosk monitoring, email retries, CI and backups: [docs/robustness.md](./docs/robustness.md)

## Requirements

- Node.js supported by the installed Next.js release
- PostgreSQL
- Bun (project package manager); npm scripts are available too

## Setup

1. Install dependencies: `bun install` or `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`.
3. Set unique local values for the authentication, booking verification,
   visitor-pass and cron secrets described in `.env.example`.
4. Apply the Prisma migrations with `npm run db:migrate`.
5. Seed local staff and demonstration data with `npm run db:seed`.
6. Start the app with `npm run dev` (`node server.mjs --dev`).

The local development database uses the `public` schema; automated tests use
the separate `e2e` schema through `DATABASE_URL_TEST` on port 5432. Test setup
rejects URLs targeting the development schema, including equivalent URLs with
different credentials. Tests reset their isolated schema, so keep real data out
of it. See [operations and testing](./docs/robustness.md).

The seed creates fixture accounts and prints their credentials. Those are for
local development only; replace them before production use. Production also
needs HTTPS, a real `BETTER_AUTH_URL`, strong environment-specific secrets, and
mail configuration if email delivery is expected. `next build` and the
production server refuse to start when `BETTER_AUTH_SECRET` is missing,
Better Auth's built-in default, or the sample value from `.env.example`.

The app runs behind a small Node server (`server.mjs`) so rate limits can use
each request's real connection address; route handlers cannot see the socket
otherwise. Behind a reverse proxy or load balancer, set `TRUSTED_PROXY_COUNT`
to the number of proxies in front of the app (the client is then read from the
right-hand end of `X-Forwarded-For`); leave it at `0` when clients connect
directly. Sensitive endpoints are also limited per email address, reference
number, kiosk device or account, independent of address.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server (`server.mjs --dev`) |
| `npm run build` / `npm run start` | Build and serve production (`server.mjs`) |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Check TypeScript |
| `npm run db:migrate` | Create/apply a development migration |
| `npm run test:migrate` | Apply pending migrations to the isolated test database |
| `npm run db:seed` | Seed local development data |
| `npm run db:studio` | Open Prisma Studio |
| `npm test` | Run the database-backed unit and service tests |
| `bun run test:e2e` | Migrate, seed, build and run Playwright in the isolated schema |
| `bun run db:backup` | Write a compressed Postgres dump and retain the latest 14 |
| `bun run db:restore -- <dump>` | Restore into a separate empty database using DATABASE_URL_RESTORE |
| `npm run test:pass-token` | Run the pass-token focused tests |
| `npm run test:http:reporting` | Run reporting HTTP checks against the local server |
| `npm run test:http:booking-pass` | Run booking-pass HTTP checks against the local server |
| `npm run test:http:password-reset` | Verify reset link, password change and session revocation against the local server |

Prisma 7 reads its datasource URL and seed command from
`prisma7.config.ts`. The generated client is written to
`src/generated/prisma/`; `postinstall` regenerates it.

## Main pages

| Page | Access | Purpose |
| --- | --- | --- |
| `/check-in` | Public | Walk-in and appointment check-in |
| `/appointment-booking` | Public | Book a visit; returning visitors can scan or paste their pass QR ID |
| `/forgot-password`, `/reset-password` | Staff | Request a private reset link and set a new password |
| `/dashboard` | Staff | Live arrivals, check-out, deliveries and today's register link |
| `/dashboard/appointments` | Staff | Manage expected arrivals |
| `/dashboard/visitors` | Staff | Find visitor profiles and manage passes |
| `/dashboard/history` | Staff | Search and filter past visits; admins can export CSV |
| `/dashboard/register` | Staff | Print the daily register |
| `/dashboard/roll-call` | Staff | Emergency headcounts, local accounted-for ticks and printable roll-call |
| `/dashboard/scan` | Staff | Scan appointment or visitor-pass QR codes |
| `/dashboard/hosts` | Admin | Manage hosts |
| `/dashboard/staff` | Admin | Manage staff accounts |
| `/dashboard/email-log` | Admin | Email delivery status and retries |
| `/dashboard/settings/purposes` | Admin | Purpose options |

Every dashboard page checks the session itself (`requireStaff()` /
`requireAdmin()` in `src/lib/session.ts`), staff data is read only through the
guarded loaders in `src/lib/staff-data.ts`, and `src/proxy.ts` redirects
anonymous requests to `/login` and answers guards on admin pages with 403. The
dashboard layout's own check only decides what shell to draw. Route handlers
use `requireStaffApi()` / `requireAdminApi()` (`src/lib/api-auth.ts`).
`tests/e2e/access-matrix.spec.ts` requests every page and API route found in
`src/app` as an anonymous caller (including RSC requests), a guard and an
admin, and fails for any route not classified in `tests/access-matrix.ts`.

On the self-service kiosk, a typed reference number must be accompanied by the
last name on the booking; a scanned QR code needs nothing else. Guards checking
someone in from the dashboard can still use the reference number alone.

## Reporting

History filters (name, inclusive date range, host and visit type) are shared
with `GET /api/visits/export`. The export is admin-only, streams in cursor
batches, logs each export, uses UTF-8 BOM and CRLF, and protects spreadsheet
formula cells. The export includes every matching row rather than only the
visible page.

Guards and admins can open the daily register, select a date and print. Day
boundaries and displayed times use the configured site time zone. Print layout
uses A4 landscape, repeats the header, keeps rows together and hides dashboard
controls. The organization label is currently the generic
“Visitor Management System”.

The red Emergency roll-call button is available in every dashboard header.
Guards and admins can use `/dashboard/roll-call` to check current on-site
visitors, with a separate list for people out and expected back. It closes
stale visits before reading and refreshes every 15 seconds. Accounted-for
ticks stay in the current browser tab's session storage until cleared; they
do not update visit records. Print uses the shared table in A4 portrait with
empty checkbox squares and staff/time attribution. See
[roll-call details](./docs/emergency-roll-call.md).

## Visitor passes and email

Hosts may have an optional arrival email in the host directory. A notice is
sent after a walk-in, pass, or appointment check-in; delivery drop-offs do not
trigger host notices. Appointment, pass, host, and password recovery messages
use the persistent email outbox and configured Resend sender. Recovery links
and verification codes are never logged. A completed password reset revokes the user's active
sessions.

The outbox keeps a message's content only while it can still be sent. Once a
message is sent, fails for good or expires, its HTML, text and attachments are
deleted and only the recipient, kind, status and timestamps remain; rows are
deleted after 14 days (30 for failed messages). Pass emails store the pass id,
and the QR image is rendered at send time, only if that pass is still active.

Active visitor passes can be queued through **Send QR** without changing the
pass. Missing mail configuration queues delivery for retry; `EMAIL_MODE=test`
records SENT messages without network calls (and, with `EMAIL_TEST_SINK` set,
writes them to that file for the end-to-end tests). See the admin email log for
failures; a message whose content has been deleted cannot be retried from
there and has to be sent again from where it started.

Appointment booking can use a visitor's valid pass QR ID to prefill their
saved details. Visitors without a pass can switch to the existing name and
email verification flow.

## Further work

Group bookings, linking anonymous walk-ins and legacy delivery records,
remaining in-memory kiosk/login limits, pass-secret rotation, and production privacy and
environment setup are tracked in [CONTINUATION.md](./CONTINUATION.md). Each
organization uses a separate deployment and database; the setup is documented
in [MULTI_TENANCY_TODO.md](./MULTI_TENANCY_TODO.md). The UI uses plain text
labels and SVG icons without emoji.
