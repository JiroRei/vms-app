# Changelog

What changed, when, and why. Newest session first — add new sessions at the top.
For the current state of the project rather than its history, see
[`STATUS.md`](./STATUS.md).

---

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
