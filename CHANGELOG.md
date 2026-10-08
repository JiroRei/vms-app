# Changelog

What changed, when, and why. Newest session first — add new sessions at the top.
For the current state of the project rather than its history, see
[`STATUS.md`](./STATUS.md).

---

## 2026-10-08 — Visitor names split into first and last

**Status:** complete and verified · ⚠️ **uncommitted** on `staging`
**Scope:** `Visitor`, `Appointment`, `VisitorProfile`, `VisitorVerification`, every
form that captures a visitor name, every surface that shows one, and the
returning-visitor lookup.
**Deliberately untouched:** `User`, `Host`, the delivery form (its "name" is a
courier or company).

### Added

- **`src/lib/names.ts`**: `formatFullName()`, `makeNameKey()` (lower-cased,
  accent-stripped, whitespace-collapsed, `first|last`), `cleanNamePart()`, and
  `validateNameParts()` / `parseNameParts()`, which the forms and the API routes
  share, so the error text is identical everywhere.
- **`src/components/name-fields.tsx`**: the one "First name" / "Last name" pair
  (`given-name` / `family-name`, both required). Used by the booking form, the
  booking lookup and the kiosk walk-in. No guard-side manual name entry exists.
- **`VisitorProfile.nameKey`**, unique on `(email, nameKey)` instead of `email`,
  so one address can hold several people. **`VisitorVerification.nameKey`**: a
  code only verifies the email + name it was issued for.

### Changed

- **Schema**: `firstName`/`lastName` replace `Visitor.name`,
  `Appointment.visitorName` and `VisitorProfile.name`, in two migrations:
  `split_visitor_names_backfill` adds nullable columns and backfills them in SQL
  (split on the last space; one word becomes the first name with an empty last
  name), and `split_visitor_names_finalize` runs a `DO` block that aborts unless
  every row is filled and recombines to its original name, then drops the old
  columns and sets `NOT NULL`. 68 visitors, 11 appointments and 1 profile all
  round-tripped exactly. Outstanding verification codes were deleted (10-minute
  lifetime, not bound to a name).
- **Deliveries** keep the courier/company name whole in `firstName` with an empty
  `lastName`, so it reads unchanged.
- **Booking lookup** takes email + first + last name. The verify route checks all
  three with the code, and the cookie carries the profile's `nameKey`. The rate
  limit stays per email, across names.
- **Booking creation**: profile resolution and the appointment insert now share
  one `prisma.$transaction`. A P2002 (a reference clash, or a concurrent booking
  creating the same pair) retries the transaction, and the retry takes the
  "profile exists, unverified, so unlinked" path. Six concurrent first bookings
  for one new pair gave 1 profile, 1 linked and 5 unlinked, with no errors.
- **History search** matches the first name, the last name, or any substring of
  "first last", case-insensitively (`nameSearchWhere()` in `src/lib/history.ts`).
  The dashboard live list has no search box.
- **Display**: the live list, history, check-in confirmation, booking review and
  confirmation all use `formatFullName()`. Emails greet by first name. There is
  no CSV export in the codebase yet.
- **API payloads**: `firstName`/`lastName` replace `visitorName` (bookings) and
  `name` (walk-ins), in requests, responses and field errors.

### Verified

50 API checks (split and cleaning, two people on one email, a wrong name on the
lookup, a code bound to its name, accent folding, the race, walk-in, delivery,
history search including terms that span the first/last boundary, appointment
check-in) plus a headless-Chrome pass over the booking flows, kiosk walk-in,
dashboard and history: no hydration warnings. Test rows were deleted afterwards.

---

## 2026-10-08 — Stepped booking page, slot picker, returning-visitor lookup

**Status:** complete and verified · ⚠️ **uncommitted** on `staging`
**Scope:** `/appointment-booking`, its API routes, and a `/privacy` placeholder.
**Deliberately untouched:** the confirmation screen and QR/email flow, kiosk and
walk-in, `Visit`/`Visitor`, rescheduling and cancellation, double-booking.

### Added

- **Stepped form**: "visited before?" → details → visit → date & time → review
  with consent. Inline validation per step; data is kept when going back; a
  server field error sends the visitor back to the step that owns it.
- **`src/lib/booking-config.ts`**: hours 08:00–17:00, 30-minute slots, 30 days
  ahead, `BOOKING_TIMEZONE = "Asia/Manila"`. Pure functions shared by the picker
  and the API; "now" is always an argument.
- **Date picker** (`react-day-picker`) and a slot grid. "Now" is read after
  mount via `useSyncExternalStore`, so it never takes part in hydration.
- **Returning visitors**: `POST /api/booking/lookup` emails a 6-digit code (HMAC
  stored, 10-minute TTL, 3 per email per 15 minutes); `POST /api/booking/verify`
  (5 attempts, single use, newest code only) sets a 30-minute signed httpOnly
  cookie and returns the name and phone for prefill. Responses, timing (`after()`)
  and the rate limit are identical for known and unknown emails. Codes are
  logged to the console outside production.
- **Models**: `VisitorProfile`, `VisitorVerification`;
  `Appointment.visitorProfileId` and `consentAcceptedAt`. Migration
  `20261008070405_booking_profiles_and_verification`.
- **`BOOKING_VERIFY_SECRET`** env var (in `.env.example`).
- **`/privacy`**: placeholder notice, clearly marked.
- **`--accent` CSS variable** in `globals.css`, exposed as `bg-accent`,
  `text-accent`, `bg-accent-soft` and so on.

### Changed

- **`POST /api/appointments`** takes `scheduledFor` as a `YYYY-MM-DDTHH:mm` slot
  in Manila time and re-checks it against the booking rules (stored as UTC). It
  requires `consent: true` and links the profile per `resolveBookingProfile()`:
  verified → link and use the stored name; unverified with an existing profile
  → no link, profile untouched; no profile → create and link.

### Verified

47 API checks (first-time, verified, wrong, expired, reused and superseded
codes, attempt cap, rate limit, forged cookie, slot edges) plus a headless-Chrome
walk through both flows at 390px: no hydration warnings. Test rows were deleted
afterwards.

---

## 2026-09-16 — Purpose becomes an admin-managed dropdown

**Status:** complete and verified · ⚠️ **uncommitted** on `devspace`
**Scope:** the purpose field only — schema, both forms, every display surface,
and an admin screen to manage the list.
**Deliberately untouched:** QR/email booking logic, the identity refactor, the
checkout "to return" state. No actual multi-tenancy — markers and a checklist
only.

Purpose was free text typed by whoever was standing at the kiosk, which meant
"Meeting", "meeting" and "mtg" were three different things to every report. It
is now a lookup table an admin curates.

### Added

- **`PurposeOption`** — `label` (unique), `isActive`, `sortOrder`, `createdAt`,
  indexed on `(isActive, sortOrder)`, the shape every dropdown queries.
- **Migration `20260916153037_purpose_option_lookup`**, applied and
  hand-written. It creates an option per distinct purpose string across both
  tables, adds the nullable foreign keys, links every row, and then **verifies
  before dropping anything**: a `DO` block counts rows that still have a purpose
  but no `purposeId` and `RAISE EXCEPTION`s if any remain. Migrations run in a
  transaction, so a partial backfill rolls back with the original columns intact
  rather than destroying the only copy of what it failed to convert. 23 options
  created, 0 rows left unlinked.
- **`/dashboard/settings/purposes`** (ADMIN only) — add, rename, hide/show and
  reorder. Guards are redirected, and the sidebar link is admin-only.
- **`src/lib/purposes.ts`** — every read and write in one place.
- **`POST /api/purposes`**, **`PATCH /api/purposes/[id]`**,
  **`POST /api/purposes/[id]/move`**, all ADMIN-gated via a new
  `requireAdmin()` in `src/lib/api-auth.ts` (a route file may not export
  anything but handlers, so it could not live beside them).
- **`MULTI_TENANCY_TODO.md`** — the running checklist, plus
  `TODO(multi-tenancy):` markers at all seven sites: the model, the lib, the
  three routes, the admin page and the seed.
- **Seeded defaults**: Meeting, Interview, Delivery, Maintenance, Other, at
  `sortOrder` 10–50 so they sort above anything the backfill numbered from 1000.

### Changed

- **`Visitor.purpose` and `Appointment.purpose` are now `purposeId`**, nullable
  references. `ActiveVisit.purpose` / `HistoryVisit.purpose` became
  `purposeLabel: string | null`, joined from the option.
- **Kiosk walk-in and `/book`** post a `purposeId` from a `<select>` of active
  options. The API re-checks it is real *and* still active, so a page rendered
  before an admin retired an option cannot post it.
- **The timeline panel** shows the purpose above the events; the events endpoint
  returns `{ purposeLabel, events }` so the panel needs no second request.
- **Deliveries** link to the "Delivery" option by label. The guard's modal gains
  no field — this only keeps the Purpose column reading as it always did.
- **Reordering renumbers the whole list** rather than swapping two `sortOrder`
  values. Swapping is a no-op on a tie, and every row created before this screen
  existed defaulted to 0; renumbering repairs those ties as it goes.

### Notes

- **`purpose` lives on `Visitor`, not `Visit`.** The task named `Visit.purpose`;
  the column has always been on `Visitor`, so it was converted in place. Each
  check-in creates a fresh `Visitor`, so the two are 1:1 in practice and every
  existing join kept working.
- **Retirement is the only removal.** Both foreign keys are `onDelete: Restrict`,
  verified: deleting an in-use option is refused with P2003.
- Verified against a running server: all three admin routes 401 anonymous, 403 a
  guard and 201/200 an admin; duplicate labels 409; hiding an option removes it
  from the active list and makes a walk-in against it a 400 while its four
  historical rows keep their label; move-up reorders and moving the first row up
  returns `{ moved: false }`; walk-in and booking store and return the joined
  label; a delivery still reads "Delivery"; the live payload carries
  `purposeLabel` and no raw `purpose` key. `tsc --noEmit`, `npm run lint` and
  `npm run build` pass.
- **Known gap:** `label` is case-sensitively unique, so "Meeting" and "meeting"
  can coexist. A proper fix needs a functional unique index on `lower(label)`,
  which Prisma cannot express in the schema.

## 2026-09-16 — Fix: hydration mismatch on the booking date picker

**Status:** complete and verified · ⚠️ **uncommitted** on `devspace`
**Scope:** the rendering path only. No change to booking logic, validation or
the appointment API.

`BookingForm` computed the date picker's `min` with `new Date()` in its render
body. A client component renders twice — once on the server, once at hydration —
so a request that straddled a minute boundary produced two different `min`
attributes and a hydration mismatch.

### Changed

- **`BookPage` computes `minDateTime` once**, alongside its `getHosts()` call,
  and passes it to `BookingForm` as a prop. The page is already
  `force-dynamic`, so the value is per-request rather than baked in at build.
- **`BookingForm` takes `minDateTime`** and uses it directly. Its local
  `localDateTimeValue()` helper is gone from the client entirely.
- **`toDateTimeLocalValue()` added to `src/lib/dates.ts`**, next to the existing
  local-time helpers. It stays in **local** time rather than
  `toISOString().slice(0, 16)`: a `datetime-local` input reads and writes
  wall-clock time, and `POST /api/appointments` parses what comes back with
  `new Date("YYYY-MM-DDTHH:mm")`, which is also local. On this machine (UTC+8) a
  UTC value would have rendered `min="…T07:23"` against a local clock of `15:23`
  — eight hours in the past, so the picker would have offered times the server
  then rejects.

### Notes

- **One instance, repo-wide.** A sweep of every `"use client"` component for
  `new Date()` / `Date.now()` in a render path found only this one.
  `live-check-ins.tsx` calls `new Date()` inside its optimistic-update handler,
  not during render, and the `toast.tsx` hit is a comment.
- The booking confirmation screen and the kiosk/guard confirm step format dates
  with `new Date(iso)` from a **server-supplied** value, not from "now", and only
  render after a fetch resolves — so they never server-render and cannot
  mismatch. Left alone.
- Verified on a built server: `min="2026-09-16T15:23"` matched the server's local
  clock, the same value appears in the RSC flight payload as a serialized
  `minDateTime` prop (so hydration reuses it rather than recomputing), and no
  booking-page client chunk contains `getMinutes()` any more. `tsc --noEmit`,
  `npm run lint` and `npm run build` pass.

## 2026-09-16 — QR appointment booking, email delivery, and scanning

**Status:** complete and verified · ⚠️ **uncommitted** on `devspace`
**Scope:** booking a visit, getting a QR code for it, and redeeming that code at
either surface. The reference-number path is kept as the fallback throughout.
**Deliberately untouched:** walk-in flow, delivery logging, the checkout
"to return" state. No time-slot conflict checks, rescheduling, cancellation UI
or SMS fallback.

Appointments were fixtures with a short code. They are now bookable by the
public, delivered as a QR code by email, and redeemed by scanning — at the kiosk
or from a guard's phone.

### Added

- **`/book`** — a public booking page: name, email, optional phone, host,
  purpose and a date/time picker. Confirms with the appointment's details, the
  reference number as the headline, and the QR code on screen.
- **`POST /api/appointments`** — creates the appointment, then sends the email.
  Validates required fields, email shape, a known host, and a `scheduledFor`
  that is not in the past (with a two-minute tolerance, so booking *for now*
  does not fail in transit).
- **`src/lib/qr.ts`** — `validateAppointmentToken()`, the single entry point
  every surface calls; `classifyAppointment()`, the pure eligibility rule it and
  the redemption share; `createQrToken()` / `createReferenceNumber()` /
  `appointmentExpiry()`; and PNG + data-URL rendering.
- **`src/lib/email.ts`** — the Resend send. The QR travels as an **inline
  attachment** referenced by `cid:`, not a hosted image, so it renders for a
  visitor with no signal and in clients that block remote images. Returns a
  result and never throws.
- **`POST /api/appointments/validate`** and **`POST /api/appointments/check-in`**
  — one pair of routes for all three surfaces, replacing the two
  `/api/appointments/[reference]` routes. The code travels in the body, not the
  URL, because a `qrToken` is a bearer credential.
- **`src/components/qr-scanner.tsx`** — camera scanning via `html5-qrcode`,
  loaded with a dynamic `import()` inside the effect so it neither breaks the
  server render nor lands in the initial bundle. A missing camera or a declined
  permission is reported plainly, not as an error.
- **`src/components/appointment-check-in.tsx`** — scan-or-type → confirm →
  check in, shared by the kiosk and the guard page. The two differ only in
  wording and in whether the visit records who performed it.
- **`/dashboard/scan`** — the guard-side scanner, reachable from a "Scan QR"
  button in the dashboard toolbar next to "Log delivery" and from the sidebar.
- **Schema:** `Appointment` gained `qrToken` (unique), `visitorEmail`,
  `visitorPhone`, `scheduledFor`, `expiresAt` and `status`; `Visit` gained
  `checkedInBy` → `User`. New `AppointmentStatus` enum.
- **Migration `20260916131241_add_appointment_booking_and_qr`**, applied and
  hand-written: Prisma cannot add four required columns to a populated table, so
  they go on nullable, get backfilled, then tighten to NOT NULL. `used` maps to
  `CHECKED_IN`/`PENDING`; existing rows get real random `qrToken`s, `createdAt`
  as `scheduledFor`, and an `@example.invalid` address — RFC 2606 reserves it, so
  an accidental send fails loudly instead of reaching a stranger.

### Changed

- **`Appointment.used` → `status`.** The boolean could only say "redeemed or
  not", which made a cancelled appointment, a lapsed one and a reference number
  that was never issued all look identical at the kiosk.
- **`redeemAppointment()`** takes either code and an optional `checkedInBy`, and
  guards on `status: "PENDING"` inside its transaction. Still writes the
  `CHECK_IN` VisitEvent, so appointment arrivals and walk-ins read the same on
  the timeline.
- **Kiosk appointment page** leads with the camera and keeps manual entry
  visible underneath rather than behind a link — a kiosk without a camera and a
  creased printout are the ordinary cases it exists for.
- **Seed:** six fixtures covering every status, with fixed `qrToken` uuids so a
  printed test code survives a re-seed, and `scheduledFor` pushed forward on each
  run so they never go stale.

### Notes

- **A failed send never costs a booking.** The row is created first; the send
  reports rather than throws, and the response carries `emailSent` so the
  confirmation screen can say so. Verified against a provider actively rejecting
  every send: booking returned 201, `emailSent: false`, and the reference number
  still validated.
- Verified against a running server: booking 201 with a uuid `qrToken` distinct
  from the row id; all five validation failures rejected with the right field
  errors; both codes resolving to the same appointment (reference matched
  case-insensitively); ALREADY_USED / CANCELLED / EXPIRED / NOT_FOUND each
  returning their own reason and status; kiosk check-in leaving `checkedInBy`
  null; `assisted: true` 401ing without a session and stamping the guard's id
  with one; all three dead ends refusing check-in; four concurrent check-ins
  giving one 201, three 409s and exactly one visit. The QR was confirmed to
  encode the token itself — not an id, not a URL. `tsc --noEmit`,
  `npm run lint` and `npm run build` pass.
- **Camera access needs a secure context**: `getUserMedia` is unavailable over
  plain HTTP except on `localhost`, so on a LAN address the scanner falls back to
  "no camera" until this is served over HTTPS. The manual path still works.

## 2026-09-16 — Per-visit event log + expandable timelines

**Status:** complete and verified · ⚠️ **uncommitted** on `devspace`
**Scope:** one visit's own event history. Purely additive — no existing
check-in, check-out, step-out or return behavior changed.
**Deliberately untouched:** cross-visit and per-visitor-identity history, which
waits on the `VisitorProfile` refactor.

A visit now records what happened to it, not just where it ended up. Expanding a
row on the live list or in history shows that visit's timeline, fetched only when
it is opened.

### Added

- **`VisitEvent` model** and a **`VisitEventType` enum** (`CHECK_IN`,
  `STEP_OUT`, `RETURN`, `CHECK_OUT`), with a `[visitId, timestamp]` index
  covering the only query that reads them, and `onDelete: Cascade` from `Visit`.
- **Migration `20260916011019_add_visit_event_log`**, applied, **including a
  backfill**: every pre-existing visit is replayed into the log from its own
  `checkInTime` / `exitTime` / `checkOutTime`, so no historical row expands to an
  empty panel. 107 events for the 55 existing visits.
- **`applyVisitTransition()`** in `src/lib/visits.ts` — runs a guarded
  `updateMany` and its event insert in one `$transaction`, writing the event only
  when the update actually matched. Each transition still spells out its own
  WHERE guard at the call site; only the "both or neither" invariant is shared.
- **`getVisitEvents()`** and **`GET /api/visits/[id]/events`** (session-required)
  — one visit's timeline, oldest first, with a deterministic tie-break by event
  type for the events a delivery stamps at the same instant.
- **`src/components/visit-timeline.tsx`** — `VisitTimeline` (fetches on mount,
  aborts on collapse, retry on failure) and the shared `TimelineChevron`.
- **`src/app/dashboard/history/history-table.tsx`** — the history table split out
  of the page so its rows can expand. The page stays a server component and still
  does all the querying.
- **Expandable rows** on both tables: click anywhere on a row, or the chevron
  button next to the visitor name, which carries `aria-expanded` /
  `aria-controls`. One row open at a time.

### Changed

- **Event inserts alongside every state change**, all inside the existing
  transaction or nested write: `createWalkInVisit()` and `redeemAppointment()`
  write `CHECK_IN`; `createDeliveryLog()` writes `CHECK_IN` **and** `CHECK_OUT`,
  since a drop-off really is both; `markVisitReturning()` writes `STEP_OUT`,
  `markVisitReturned()` writes `RETURN`, `checkOutVisit()` writes `CHECK_OUT`.
  Return codes, guards and results are untouched.
- **`checkInTime` is now passed explicitly** on walk-in and appointment creation
  rather than left to its `now()` default, so the `CHECK_IN` event and the visit
  row carry the identical instant instead of two timestamps a hair apart.
- **`markVisitReturned()`** captures the return instant, which the visit row has
  nowhere to store — clearing `exitTime` still erases the round trip from the
  row, but the timeline keeps it.

### Notes

- **On-demand by design.** `getActiveVisits()` and `getVisitHistory()` are
  unchanged and fetch no events; a 25-row history page is still one query.
  Confirmed against rendered HTML: 25 expand controls, zero timeline markup.
- Verified against a running server: full lifecycle → `CHECK_IN → STEP_OUT →
  RETURN → CHECK_OUT` in order; a repeat or invalid transition returns 409 and
  adds **no** event; four simultaneous check-outs give one 200, three 409s and
  exactly one `CHECK_OUT`; appointment → one `CHECK_IN`; delivery → a
  `CHECK_IN`/`CHECK_OUT` pair at an identical timestamp; events endpoint 401s
  without a session and 404s on an unknown id; every event timestamp matches its
  visit row's own column. `tsc --noEmit`, `npm run lint` and `npm run build`
  pass.

## 2026-09-16 — Guard-side delivery logging + dashboard ergonomics

**Status:** complete and verified · ⚠️ **uncommitted** on `devspace`
**Scope:** where a delivery is logged, and how the guard dashboard feels to use.
**Deliberately untouched:** appointment flow, group appointments, the return-later
checkout state, visitor identity tracking. Roles still get the same dashboard
actions — no role-based restrictions beyond the pre-existing admin-only cleanup.

Deliveries were a kiosk flow, which meant handing the visitor terminal to a
courier who only wanted to drop a parcel and leave. They are a guard action now:
one button on the dashboard, a small modal, and a record that is complete the
moment it is written.

### Added

- **`POST /api/deliveries`** — session-required, unlike the public kiosk
  endpoints. Validates the courier name, caps the free-text fields, and rejects
  an unknown `hostId` with a 400 rather than a foreign-key 500.
- **`createDeliveryLog()`** in `src/lib/visits.ts`, replacing
  `createDeliveryVisit()`. Stamps `checkOutTime` with the same instant as
  `checkInTime` and sets `status: CHECKED_OUT` at creation, so a delivery is a
  single completed event with nothing to check out later. That also keeps it out
  of the live list for free: `getActiveVisits()` already selects on the two open
  statuses.
- **`Visitor.recipientDepartment`** and **`Visitor.note`** (both nullable), plus
  migration `20260916004016_add_delivery_recipient_and_note`, applied. The first
  holds a typed-in destination for a recipient who is not one of the hosts; the
  second holds the guard's short note.
- **`src/app/dashboard/log-delivery.tsx`** — the "Log delivery" button and its
  modal: courier/company name (required), recipient department (host list, or
  "Other" revealing a free-text field), and an optional note. Closes on Escape,
  returns focus to the button, and never navigates.
- **`src/components/toast.tsx`** — a `ToastProvider` / `useToast()` pair wired
  into the dashboard layout, so the live table, the delivery modal and the stale
  cleanup all confirm themselves in the same corner instead of each inventing a
  spot for its own message.
- **A seeded `GUARD` user** (`guard@geoplan.ph` / `guard123`) alongside the
  admin, using the same dev-login mechanism. The seed script now prints both
  sets of credentials.

### Changed

- **Live check-in table** (`live-check-ins.tsx`): `table-fixed` with widths on
  the headers and no horizontal scroll container, so name, status and check-in
  time stay readable at any width. Purpose and host truncate behind a `title`
  tooltip and drop out on narrow screens, where they reappear as a secondary
  line under the name.
- **Row actions** are 44px tall, and "Check out" is a solid primary button
  rather than a gray outline — it is the action a guard uses all day.
- **Every action now confirms itself.** Success and failure both raise a toast,
  and a row that stays in the list (mark-as-returning, mark-as-returned) flashes
  green for 1.6s. Only the polling failure is still an inline notice, because it
  is a standing condition rather than a response to a tap.
- **Dashboard header is a sticky toolbar** carrying "Log delivery" and, for
  admins, "Close all stale visits", so both stay reachable however far down the
  list the guard has scrolled.
- **`CloseStaleVisits`** drops its own inline summary/error lines in favour of
  the shared toast.
- **History** shows the delivery note under the purpose, and the host column
  falls back to a typed-in `recipientDepartment` before it falls back to
  "Reception".

### Removed

- **`/kiosk/delivery`** (page and form) and the "Delivery / Courier" button on
  the kiosk landing screen.
- **The `DELIVERY` branch of `POST /api/visits`.** That endpoint is deliberately
  public because the kiosk is unattended, so leaving a delivery path on it would
  have left deliveries loggable by anyone. It handles walk-ins only now.

### Notes

- Deliveries written by the old kiosk flow were **not** backfilled — an old one
  still sitting `ACTIVE` stays in the live list until the stale cleanup closes
  it. The host-less "Reception" fallback in the live table exists for those rows
  and only those rows.
- Verified by hand against a running dev server: 401 without a session, 201 with
  one, `checkInTime === checkOutTime` and `CHECKED_OUT` in the database, no
  delivery in `GET /api/visits`, a picked host winning over a typed department,
  and `/kiosk/delivery` returning 404. `tsc --noEmit`, `npm run lint` and
  `npm run build` all pass.

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
