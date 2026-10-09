# Merge log — `staging` revamp + `origin/staging`

**Date:** 2026-10-08
**Ours:** `b64111a` "Revamp of VMS system" (local `staging`)
**Theirs:** `ea929f8` — PR #2 from `clark_dev` (Better Auth, staff/host/appointment
management, tests, kiosk idle reset), 5 commits since merge base `e4f45f7`
**Rule applied:** where the two sides disagreed, **the revamp (ours) wins** —
its data model, routes and flows. Clark's features that did not compete with it
were kept and adapted to the revamp's model rather than dropped.

28 files conflicted. All resolved; merge not yet committed or pushed.

---

## Schema and migrations

- **Duplicate `Appointment.scheduledFor`.** Clark's nullable column
  (`20260922092908_add_appointment_schedule`) collided with the revamp's
  required one (created earlier in `20260916131241_add_appointment_booking_and_qr`).
  Kept **required**. Clark's migration was edited to `ADD COLUMN IF NOT EXISTS` /
  `CREATE INDEX IF NOT EXISTS` — otherwise it fails on any database built from
  this chain. ⚠️ On a database where Clark already applied it, `prisma migrate
  dev` will report the migration as modified (checksum change); the SQL is
  equivalent, so `prisma migrate resolve` or a dev reset is the fix there.
- **Two `User` ↔ `Visit` relations** (revamp's `checkedInBy`, Clark's
  `checkedOutBy`) now named `VisitCheckedInBy` / `VisitCheckedOutBy`.
  Schema-only; no SQL change.
- **Appointment indexes:** union of both sides.
- Clark's other migrations kept as-is: `drop_user_password`, `add_host_active`,
  `add_checkout_attribution_and_restrict_host_deletes`.
- **Verified:** the full 15-migration chain applied cleanly to a fresh scratch
  database (`vms_merge_check`), with zero drift against the merged schema.
  The scratch database can be dropped.

## Auth

- Clark's **Better Auth** replaces dev auth (`src/lib/dev-auth.ts` deleted on
  his side). Every revamp file still calling `getDevSession()` was moved to
  `getSession()` from `src/lib/session.ts` (same shape): appointment check-in,
  deliveries, visit events, dashboard page, purpose settings, `api-auth.ts`.
- `.env.example`: Clark's `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` /
  `CRON_SECRET` + the revamp's Resend and `BOOKING_VERIFY_SECRET`.
  ⚠️ Local `.env` needs a `BETTER_AUTH_SECRET` before the app will start, and
  the seed must be re-run (`npm run db:seed`) after `drop_user_password` so
  staff logins exist again.

## Appointments (biggest overlap)

Both sides owned `POST /api/appointments` with incompatible meanings.

- **Kept (ours):** `POST /api/appointments` = public booking; QR/status model;
  `/api/appointments/validate` and `/check-in`; first/last names, purpose
  options, profiles.
- **Deleted (ours removed, theirs edited):** `/api/appointments/[reference]`
  (lookup/cancel) and `[reference]/check-in`; `/kiosk/appointment/*`,
  `/kiosk/delivery/*`.
- **Adapted (theirs):** the staff manager at `/dashboard/appointments` now posts
  to new staff-only routes:
  - `POST /api/appointments/manage` → goes through the revamp's
    `createAppointment()` (QR + email, profile handling); consent left null;
    any future time allowed (not limited to booking slots).
  - `DELETE /api/appointments/manage/[reference]` → sets `CANCELLED`
    instead of deleting the row.
  - UI: first/last name (`NameFields`), required email, purpose dropdown,
    required time, status badge (Checked in / Cancelled / Expired) instead of
    `used`.
- Clark's random reference generator dropped in favour of the revamp's in
  `src/lib/qr.ts`. Note: his alphabet also removed `L`; the revamp's keeps it.
- **Rate limits ported:** Clark's kiosk limits (lookup 30/min, redeem 20/min)
  applied to `/api/appointments/validate` and `/check-in`.

## Kiosk (`/kiosk` → `/check-in`)

- The revamp renamed `/kiosk` to `/check-in`; Clark's new kiosk files
  (`form-styles.ts`, `kiosk-idle-reset.tsx`, `layout.tsx`, `use-idle-timeout.ts`)
  were accepted under `/check-in`, idle reset now returns to `/check-in`.
- Chooser: Clark's layout, revamp routes, **no delivery card** (deliveries are a
  guard action in the revamp).
- Walk-in form rebuilt from both: revamp's `NameFields` + purpose dropdown,
  Clark's shared styles, clear-on-edit errors, focus-first-error, double-tap
  guard, and honest success copy (nothing notifies the host).
- ⚠️ **Open decision:** Clark used `autocomplete="off"` on the kiosk name so a
  shared tablet never suggests the previous visitor; the revamp's name-split
  spec requires `given-name` / `family-name`. Revamp kept — revisit for the
  kiosk.
- Walk-in and booking routes now also reject **inactive hosts** (Clark's soft
  delete) server-side.

## Visits / dashboard

- `checkOutVisit()`: Clark's checked-out-by attribution + revamp's CHECK_OUT
  timeline event.
- Deliveries are now attributed to the guard who logged them (otherwise history
  would read "closed automatically").
- Live list: revamp version (toasts, flash, timelines, responsive table) +
  Clark's 401 → sign-in handling and empty state. Clark's phone card layout
  and refresh indicator not carried over.
- History: revamp's `HistoryTable` + Clark's empty states, time on site,
  "by …/closed automatically", min-width scroll, and `listHosts()` filter
  (includes inactive hosts).
- Dashboard nav: union — Scan QR, Appointments, History; admin: Hosts, Staff,
  Purpose Options; Clark's narrower phone gutters around the revamp's toasts.
- Close-stale buttons: revamp's 44px touch targets.

## Seed, lockfiles, docs

- `prisma/seed.ts`: revamp appointment fixtures + Clark's hashed Better Auth
  staff logins; summary prints both.
- `bun.lock`: revamp's (Clark added no dependencies). `package-lock.json`
  (Clark's) regenerated lock-only so it includes the revamp's packages.
- `CHANGELOG.md`: entries interleaved by date + a merge entry. `STATUS.md`:
  rewritten for the merged state.

## Not done / follow-ups

- **Not verified after the final edits** (skipped on request): no typecheck,
  lint, `npm test`, or browser run since resolving. Run before pushing:
  `./node_modules/.bin/tsc --noEmit && npx eslint . && npm test`.
  Clark's tests (`tests/*.test.ts`) were written against the old model
  (`visitorName`, `purpose`, `used`) and will need updating.
- Apply migrations locally: `npx prisma migrate deploy && npx prisma generate`,
  re-seed, add `BETTER_AUTH_SECRET` to `.env`, restart `next dev`.
- Then: `git commit` (merge commit) and `git push origin staging`.
