# Changelog

What changed, when, and why. Newest session first — add new sessions at the top.
For the current state of the project rather than its history, see
[`STATUS.md`](./STATUS.md).

---

## 2026-09-22 — A database at last; appointments and hosts become manageable

**Status:** complete · typecheck, lint and production build pass · **verified
end to end against a running server** · ⚠️ **uncommitted** on `clark_dev`
**Scope:** an isolated dev database, the two red lapses from yesterday's audit,
and the two modules that were keeping the system from closing its own loop.

Yesterday's work could not be run. It can now, and it was — every claim in
`STATUS.md`'s verification table was checked with `curl` against a live server,
including the ones that would have been embarrassing to get wrong (sign-up is
refused; a guard cannot write their own `role`).

### Added

- **A dev Postgres cluster of this repo's own**, `initdb` into
  `C:\Users\josep\pgdata\vms-dev` on **port 5433**, password auth, started with
  `pg_ctl`. The PostgreSQL service on 5432 is untouched — its password was never
  recovered and is no longer needed. Migrations 1–5 applied cleanly from empty.
- **Appointment management** — `/dashboard/appointments`, `POST /api/appointments`,
  `DELETE /api/appointments/[reference]`, and `createAppointment` /
  `listAppointments` / `cancelAppointment` in `src/lib/appointments.ts`.

  This closes a loop that was open: the kiosk could *redeem* a reference number
  and nothing in the running application could *produce* one. Appointments
  existed only in `prisma/seed.ts`, so pre-registering a visitor meant editing
  TypeScript and re-seeding.

  References are now generated rather than sequential — six characters from a
  31-character alphabet with `O`/`0` and `I`/`1`/`L` removed, because a visitor
  reads one off a phone and types it on a tablet. That is ~887 million, which
  retires the enumeration finding from the 2026-09-21 audit for everything
  except the seed fixtures, which stay fixed so they can be documented.
- **`Appointment.scheduledFor`** (migration `20260922092908`) — nullable. The
  kiosk does not check it; it orders the list and answers "who are we expecting
  today?", which was unanswerable before.
- **Host directory management** — `/dashboard/hosts` (admin only), `POST /api/hosts`,
  `PATCH /api/hosts/[id]`, and a new `src/lib/hosts.ts`.
- **`Host.active`** (migration `20260922093221`) — soft delete, and not as a
  nicety. `Visitor.hostId` is `onDelete: Cascade` and `Visit.visitorId` cascades
  from there, so deleting one host row would delete every visitor they ever
  received and every visit those visitors made. There is deliberately **no**
  DELETE route. `getHosts()` now returns active hosts only, so a host who has
  left drops off the kiosk; the history filter uses the full directory, because
  last year's visit still belongs to whoever hosted it.

### Fixed

- **The kiosk no longer tells visitors their host has been notified.** Nothing
  notifies anyone — there is no email, no SMS, no queue anywhere in the
  codebase. Both confirmation screens now say reception can see they have
  arrived, which is the part that is true.
- **An expired session no longer masquerades as a network fault.** The live list
  caught the 401 from `/api/visits` and showed "Live updates paused — retrying…"
  indefinitely, leaving a signed-out guard pressing check-out buttons that
  quietly did nothing. A 401 from the poll or from any row action now says the
  session ended and calls `router.refresh()`, which re-runs the layout's session
  check and lands them on `/login`. The guard is a ref, not state, so the
  in-flight interval cannot fire one more doomed request before it takes effect.

### Verified

See the table in `STATUS.md`. Twelve checks, including both role gates, the
sign-up refusal, the `role`-escalation refusal, the rate limiter tripping at the
sixth sign-in, and the full appointment round trip from creation through kiosk
redemption to the live check-in list.

### Then, the same day — staff accounts

The last seed-only entity. `/dashboard/staff` (admin) creates, promotes,
demotes and removes logins; `/dashboard/account` lets anyone change their own
password.

- **Accounts are written directly**, user + credential `account` in one
  transaction, rather than through `auth.api.signUpEmail`. That call is refused
  exactly as a request to `/api/auth/sign-up/email` would be — the
  `disableSignUp` check lives inside the endpoint, not in the HTTP layer — so
  going through it would have meant reopening public sign-up to use it.
  Verified the long way round: an admin-created account signs in.
- **Deleting a staff account is safe in a way deleting a host is not.** Nothing
  in the visit chain references `User`; only `session` and `account` do, and
  both cascade. An account's rows are its logins, not its history.
- **Three guards on the way out:** nobody can delete the account they are
  signed in as, nobody can demote themselves out of admin, and the last
  administrator can be neither removed nor demoted — otherwise the only way
  back in would be re-running the seed.
- **The password change route brings its own rate limit**, for the same reason
  the login action does: guessing a current password there would be as good as
  guessing it at the login form, and `auth.api.*` skips Better Auth's limiter.
  It revokes other sessions and reissues the current one.

### Known to be unfinished

- Host notification remains unbuilt; the copy is honest about it now.
- **No password reset, only change.** Someone who has forgotten theirs cannot
  recover it — the reset endpoints need an email sender.
- **No audit trail.** Nothing records which guard checked a visitor out or who
  created an appointment. It is what makes deleting a staff account safe, and
  it is a real gap for a system whose job is knowing who was in the building.
- Still no automated tests. The verification table is a list of things someone
  has to remember to re-run, and it is now nineteen rows long.

---

## 2026-09-21 — Better Auth switched on, rate limiting, theme flash

**Status:** code complete · typecheck, lint and production build pass ·
❌ **nothing verified against a database** — `.env` still holds the literal
`YOUR_PASSWORD`, so the migration is unapplied, the seed has not run and no one
has signed in · ⚠️ **uncommitted** on `clark_dev`
**Scope:** authentication, the endpoints that take unauthenticated input, and
one theme bug found while auditing.
**Deliberately untouched:** the visit lifecycle, the shape of every visit API
response, and the query logic in `src/lib/{visits,history,appointments,stale-visits}.ts`.

The throwaway login is gone. `src/lib/dev-auth.ts` compared passwords in
plaintext and handed out an unsigned JSON cookie that anyone could forge into an
`ADMIN` session; both are replaced by Better Auth.

### Added

- **`src/lib/session.ts`** — the one place `auth.api.getSession` is called.
  Wrapped in React's `cache`, so the dashboard layout and the page it renders
  share a single lookup instead of each making its own round trip, and it
  narrows `role` to the Prisma enum: anything that is not exactly `ADMIN` reads
  as `GUARD`, because an unrecognised value is a reason to grant less.
- **`src/app/api/auth/[...all]/route.ts`** — Better Auth's own endpoints. Only
  `GET` and `POST` are exported; no other verb is used, so the rest 405 rather
  than being silently routed.
- **`src/lib/rate-limit.ts`** — a fixed-window in-memory limiter, applied to
  sign-in (5/min), kiosk check-in and appointment redemption (20/min each) and
  appointment lookup (30/min). The kiosk limits are sized for the busiest single
  terminal, not for one visitor: every check-in from a kiosk shares one address,
  so a queue at the door must still get through.
- **Migration `20260921093731_drop_user_password`** — drops `user.password`.
  Written with `prisma migrate diff --from-schema … --to-schema …`, which needs
  no database connection.

### Changed

- **`src/lib/auth.ts`** activated, with three decisions worth naming:
  - **`disableSignUp: true`.** The catch-all mounts *every* configured endpoint,
    and that includes `POST /api/auth/sign-up/email`. Left open, anyone who
    found it could issue themselves a `GUARD` account with dashboard access.
  - **`role` stays `input: false`,** so the mounted `/api/auth/update-user`
    cannot write it. Without that, a guard could promote themselves to `ADMIN`.
  - **8-hour sessions refreshed hourly.** The default `updateAge` is a day,
    which would never fire inside an 8-hour session and would drop a guard
    mid-shift exactly 8 hours after they signed in.
- **`src/app/login/actions.ts`** now calls `auth.api.signInEmail` /
  `signOut`. It carries its own rate limit because Better Auth's limiter is an
  `onRequest` hook in the HTTP pipeline that a direct `auth.api.*` call never
  enters — the form would otherwise have been the unmetered way past the metered
  endpoint beside it. A failed sign-in says the same thing whatever went wrong,
  so the page can't be used to test which addresses have accounts.
- **`prisma/seed.ts`** writes the credential as a scrypt hash on `account`,
  using the same `hashPassword` Better Auth verifies against. Both halves
  sign-in checks are set: `providerId: "credential"` and `accountId` equal to
  the user's own id. Since sign-up is disabled, the seed is now the only way an
  account comes into existence, and re-running it is the password reset.
- **Theme no longer flashes.** An inline script in the root layout applies the
  stored theme while the HTML is still parsing, per the pattern in Next's
  `preventing-flash-before-hydration` guide. `ThemeToggle` now picks its icon in
  CSS rather than from React state — branching on `theme` put the moon in the
  server's HTML and the sun in the client's first render, a hydration mismatch
  on every load in dark mode.
- **The five call sites** that read a session now import `getSession` from
  `@/lib/session`; the `// TEMP: dev-only auth` markers are gone.

### Removed

- **`src/lib/dev-auth.ts`** and the `password` column on `User`.

### Known to be unfinished

- Nothing here has been run. The next session's first job is a working
  `DATABASE_URL`, then `npx prisma migrate dev`, `npm run db:seed`, and an
  actual sign-in as both roles.
- Appointment references are still sequential and still readable by anyone who
  can reach the kiosk endpoint. Rate limiting slows enumeration; it does not fix
  it.
- `/` and `/login` have no dark styles, so the toggle has no effect there.

---

## 2026-09-18 — Kiosk hardening, shared formatting, docs

**Status:** complete · typecheck, lint and production build pass ·
⚠️ **uncommitted** on `clark_dev`
**Scope:** presentation, kiosk form behaviour and documentation.
**Deliberately untouched:** the visit lifecycle, every API route, the Prisma
schema, and `src/lib/{visits,history,appointments,stale-visits}.ts` query logic.
No migration was needed.

A polish pass over the two surfaces people actually touch: the unattended kiosk
and the guard's dashboard.

### Added

- **`src/lib/dates.ts` grew a display-formatting half** — `formatTime`,
  `formatDate`, `formatShortDate`, `formatDateTime` and `formatDuration`, next
  to the day-boundary helpers that were already there. The locale is **pinned to
  `en-US`** rather than left as `[]`, which previously resolved to whatever
  locale the browser or the server happened to run in. Unparseable or missing
  values render as `—` instead of `Invalid Date`.
- **Kiosk idle reset** — `src/app/kiosk/use-idle-timeout.ts` plus
  `kiosk-idle-reset.tsx`, mounted once from a new `src/app/kiosk/layout.tsx` so
  it covers all three flows *and* their "You're checked in!" screens. Prompts
  "Are you still there?" at 45s, returns to `/kiosk` at 60s. Uses `replace`, not
  `push`, so the back button cannot walk the next visitor into the previous
  one's half-filled form. While the prompt is up, only its buttons dismiss it —
  a passer-by brushing the screen must not cancel a reset already announced.
- **`src/app/kiosk/form-styles.ts`** — one set of control classes for all three
  kiosk forms, sized for a finger (~44px targets, 16px text so iOS Safari stops
  zooming the page on focus).
- **`EmptyState`** and **`TableSkeleton` / `SkeletonLine`** in `src/components/`.
- **`loading.tsx`** for `/dashboard` and `/dashboard/history`.
- **A seeded `GUARD` user** — `guard@geoplan.ph` / `guard123` — so role-gated
  behaviour can be exercised both ways without hand-editing the database.

### Changed

- **Every timestamp** now goes through `src/lib/dates.ts`. `live-check-ins.tsx`,
  `dashboard/history/page.tsx` and the chart labels in `lib/history.ts` each had
  their own inline formatter with a different option set; none remain.
- **History check-out cell** gained a "2h 15m on site" line under the timestamp.
  Both ends of a finished visit are recorded, so it needs no clock and renders
  identically on server and client.
- **Walk-in, appointment and delivery forms**: field errors clear as soon as the
  visitor edits that field, the first invalid field is focused on a failed
  submit, `aria-describedby` wires errors to their inputs, submit handlers guard
  against a double-tap landing before React re-renders the disabled button, and
  inputs are `autoComplete="off"` (a kiosk is shared).
- **Appointment lookup** now distinguishes an unusable reference (404/409) from
  a failed request. "Register as a walk-in instead" only appears for the first —
  it was previously offered after a network blip, throwing away a valid
  appointment. A network failure at the confirm step now keeps the visitor on
  the confirm screen, where one more tap retries.
- **Live check-in list**: a "Updating…" pulse on the Live indicator while a poll
  is in flight (the rows are never blanked, so the table cannot jump), and a
  real empty state instead of the bare "No active check-ins".
- **History empty state** now tells an empty log apart from an over-narrow
  filter, and offers "Clear all filters" for the second.
- **History filters** run the navigation inside `useTransition`, so Apply shows
  "Applying…" and the current table stays on screen until the new one is ready.
- **Responsive pass.** Kiosk screens use `min-h-dvh` (`100vh` counts the mobile
  address bar and pushed the submit button below the fold) with vertical padding
  so a tall form is not clipped by `justify-center`. The live check-in list
  renders as **stacked cards below `md`** — its action buttons were off the
  right edge of a phone, which is exactly where a roving guard needs them. The
  history table gained a `min-w` so it scrolls instead of crushing five columns.
  Dashboard gutters, nav links and dialog buttons resized for touch.

### Docs

- **`README.md`** rewritten from the stock `create-next-app` text: setup,
  migrations, seeding, both test logins, seeded fixtures, scripts, routes, a
  "what works right now" list and the known quirks.
- **`STATUS.md`** refreshed — health checks, module table, test-login table, and
  three new gotchas (restart `next dev` after a migration; what `P1000` looks
  like from the app; `react-hooks/set-state-in-effect` is an error here).

### Not verified

The local Postgres refused the credentials in `.env` (`P1000`), so nothing
DB-backed was exercised end to end this session: no seed run, no migration
status, and `/kiosk/walkin`, `/kiosk/delivery`, `/dashboard` and
`/dashboard/history` were not rendered against real data. Verified instead:
typecheck, lint, production build, a unit check of all five formatters, and
`/`, `/kiosk`, `/kiosk/appointment`, `/login` returning 200 with `/dashboard`
redirecting to `/login`.

## 2026-09-15 — "Will you return today?" checkout flow

**Status:** complete and verified · ⚠️ **uncommitted** on `devspace`
**Scope:** one visit's lifecycle within a single day. No visitor identity
tracking or cross-visit matching.
**Deliberately untouched:** appointment flow, delivery flow, group appointments.

A guard checking someone out is now asked whether the visitor is coming back
today. If they are, the visit is parked in a new `PENDING_RETURN` state instead
of being closed — it stays on the live list, badged as out, and resumes as the
**same** visit when they return.

### Added

- **`VisitStatus` enum** (`ACTIVE` / `CHECKED_OUT` / `PENDING_RETURN`) and
  `Visit.status`, defaulting to `ACTIVE`, plus an index on it.
- **`Visit.exitTime`** (nullable) — when someone stepped out temporarily.
  Separate from `checkOutTime`: an exit is reversible and leaves the visit open;
  a check-out ends it.
- **Migration `20260915050608_add_visit_status_and_exit_time`**, applied.
- **`POST /api/visits/[id]/step-out`** → `PENDING_RETURN`, stamps `exitTime`.
- **`POST /api/visits/[id]/return`** → back to `ACTIVE`, clears `exitTime`.
- **`markVisitReturning()` / `markVisitReturned()`** in `src/lib/visits.ts`,
  alongside a shared `readStatus()` helper that turns a zero-row `updateMany`
  into a specific reason (not found vs. wrong status).
- **`src/components/visit-status-badge.tsx`** — the amber "Out — Returning"
  badge, following the existing `VisitorTypeBadge` idiom of badging only the
  exception.
- **Confirmation dialog** in the live check-in list: _"Will this visitor return
  later today?"_ → **"No, check out"** / **"Yes, mark as returning"** / Cancel.
  Built on the same inline `role="dialog"` pattern as `CloseStaleVisits`.
- **"Mark as returned"** button on `PENDING_RETURN` rows, an "Out since HH:MM"
  line under the check-in time, and a header count that now reads
  `5 visitors on site · 1 out, returning`.

### Changed

- **`getActiveVisits()`** filters on `status: { in: [ACTIVE, PENDING_RETURN] }`
  instead of `checkOutTime: null`. Both open states carry a null check-out, so
  only `status` can tell "here" from "out, coming back". `ActiveVisit` gained
  `status` and `exitTime`.
- **`checkOutVisit()`** now also sets `status: CHECKED_OUT`. It still guards on
  `checkOutTime: null`, so it closes an `ACTIVE` *or* a `PENDING_RETURN` visit —
  someone who stepped out and turns out not to be coming back can be checked out
  where they stand, without being marked returned first.
- **Stale cleanup** (`src/lib/stale-visits.ts`) rewritten: the where-clause is
  now shared between `countStaleVisits()` and `closeStaleVisits()` so the number
  in the confirmation dialog can't disagree with what the button then closes.
  Batching is keyed by resolved close-timestamp rather than by date.
- **History** (`src/lib/history.ts`, `history/page.tsx`): `HistoryVisit` gained
  `status`, and `StatusCell` now branches on it — a completed visit shows its
  check-out time, a currently stepped-out visit shows "Out — Returning", and
  anyone else still in shows "Still inside".
- **`live-check-ins.tsx`**: the three row actions share one `runAction()`; the
  open dialog is derived from the current list during render rather than held as
  its own state copy, so a poll that closes the row from under it also closes the
  dialog.

### Fixed

- **Stale cleanup would have stranded swept visits on the live list.** It set
  `checkOutTime` but not `status`, so a swept visit would have stayed `ACTIVE`
  and never left the dashboard. It now sets both.
- **The generated migration would have resurrected every historical visit.**
  `ADD COLUMN ... DEFAULT 'ACTIVE'` applies to *all* existing rows, which would
  have dumped all 41 already-checked-out visits back into the live check-in
  list. The migration was created with `--create-only` and a backfill added
  before applying:

  ```sql
  UPDATE "visit" SET "status" = 'CHECKED_OUT' WHERE "checkOutTime" IS NOT NULL;
  ```

  Verified afterwards: 41 → `CHECKED_OUT`, 8 still-open → `ACTIVE`, zero rows
  where `status` and `checkOutTime` disagree.

### Judgment calls

Three decisions that went slightly beyond or against a literal reading of the
brief — all easy to reverse:

1. **Stale `PENDING_RETURN` visits close at their `exitTime`,** not at end-of-day
   (falling back to end-of-day when there is no `exitTime`). `exitTime` is a real
   observation of when the visitor left the building; stamping someone who walked
   out at 15:30 as leaving at 23:59:59 would discard better data. The brief said
   "same end-of-day logic", so flagging it explicitly.
2. **"Check out" was kept on `PENDING_RETURN` rows** and goes straight through
   without re-prompting — they have already answered the return question.
   Removing it would leave a stepped-out visitor with no way to be closed before
   the end-of-day sweep.
3. **The prompt only appears for `ACTIVE` rows**, for the same reason.

### Files touched

| File | |
| --- | --- |
| `prisma/schema.prisma` | modified |
| `prisma/migrations/20260915050608_add_visit_status_and_exit_time/` | **new** |
| `src/lib/visits.ts` | modified |
| `src/lib/stale-visits.ts` | rewritten |
| `src/lib/history.ts` | modified |
| `src/app/dashboard/live-check-ins.tsx` | modified |
| `src/app/dashboard/history/page.tsx` | modified |
| `src/app/api/visits/[id]/step-out/route.ts` | **new** |
| `src/app/api/visits/[id]/return/route.ts` | **new** |
| `src/components/visit-status-badge.tsx` | **new** |

`6 files changed, 402 insertions(+), 71 deletions(-)` plus 4 new files.

No changes to the appointment, delivery or group flows. All three visit-creation
sites use `visits: { create: {} }` and pick up the `ACTIVE` default, so the
appointment flow needed no edit.

### Verification

- `tsc --noEmit`, `npm run lint` and `npm run build` all clean. Both new routes
  appear in the build's route table.
- **39-assertion lifecycle script against the real database:** every transition,
  both re-entry conflicts on each transition, unknown-id handling, history
  output, and the stale sweep — including a check that a visit stepped out
  *today* is **not** swept. All passed.
- **End-to-end HTTP smoke test** through a running dev server: 401
  unauthenticated, 200 on each transition, 409 on each repeat, 404 on unknown id,
  and correct server-rendered output on `/dashboard` and `/dashboard/history`
  (badge, "Mark as returned", "Out since", and the counter all present).
- **Round-trip confirmed in history:** a visit taken
  `ACTIVE → PENDING_RETURN → ACTIVE → CHECKED_OUT` renders as **one** completed
  row with its original check-in and final check-out.
- All test data removed afterwards; the database returned to its exact pre-test
  counts (8 / 41) with zero invariant violations.

### Follow-ups

- [ ] **Commit this work** — it is still sitting in the working tree, and
      `devspace` has no remote.
- [ ] Turn the throwaway lifecycle script into a **committed regression test**.
      It covered the flow well but was deleted after the run; there is still no
      test runner configured.
- [ ] Schedule `closeStaleVisits()`. It takes no request, session or cookie
      specifically so a cron job can call it, but nothing does yet.
- [ ] Consider whether `exitTime` should be surfaced in the history table.

---

## 2026-09-15 (earlier) — `d7ada93`

_Committed before this session; summarised from the commit and the code._

Walk-in kiosk flow and visitor logging, plus the appointment and delivery
check-in flows, the dashboard live check-in list with manual checkout, the
admin-only stale visit cleanup, visit history with filters/pagination and the
visitor frequency chart, dark/light theming, and the temporary dev-only login.
Migrations `..._init`, `..._add_appointment`, and
`..._add_visitor_type_and_optional_host`.

## 2026-09-11 — `bd75d3b`

Initial commit from `create-next-app`.
