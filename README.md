# Visitor Management System

A single-site visitor management system: an unattended kiosk where visitors
check themselves in, and a staff dashboard where guards see who is in the
building and check them out again.

- **Current state of each module** → [`STATUS.md`](./STATUS.md)
- **What changed and when** → [`CHANGELOG.md`](./CHANGELOG.md)

Staff login runs on [Better Auth](https://better-auth.com): passwords are stored
as scrypt hashes and sessions are rows in the database behind a signed cookie.
Accounts come from the seed — there is no sign-up endpoint.

---

## Requirements

| | |
| --- | --- |
| Node.js | 20+ |
| PostgreSQL | a reachable server with a database named `vms` |
| Package manager | Bun 1.4 (npm works too) |

## Setup

```bash
# 1. Install — `postinstall` runs `prisma generate` into src/generated/prisma/
bun install                  # or: npm install

# 2. Point at your database
cp .env.example .env         # then edit DATABASE_URL

# 3. Create the schema
npx prisma migrate dev       # or: npm run db:migrate

# 4. Load hosts, appointments and the test logins
npm run db:seed

# 5. Run it
npm run dev                  # http://localhost:3000
```

`.env` needs two things:

```
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5433/vms?schema=public"
BETTER_AUTH_SECRET="…"   # openssl rand -base64 32
BETTER_AUTH_URL="http://localhost:3000"
```

> **Port 5433, not 5432.** This repo runs against its own Postgres cluster,
> created so development never touches a shared server. It is not registered as
> a Windows service, so start it after a reboot:
>
> ```bash
> "/c/Program Files/PostgreSQL/18/bin/pg_ctl" -D "C:/Users/josep/pgdata/vms-dev" \
>   -l "C:/Users/josep/pgdata/vms-dev/server.log" start
> ```
>
> On another machine, point `DATABASE_URL` at whatever Postgres you like — the
> app has no opinion beyond the URL.

`BETTER_AUTH_SECRET` signs the session cookie, so the app will not start
without it and rotating it signs everyone out. Prisma 7 reads the database URL
from `prisma7.config.ts`, **not** from `schema.prisma` — there is no `url` field
in the datasource block.

## Test logins

Created by `npm run db:seed`, and printed by it on every run. The passwords are
fixtures defined in [`prisma/seed.ts`](./prisma/seed.ts) — change them before
this is deployed anywhere. They are hashed on the way into the database; the
seed is simply the one place they are written down.

Because sign-up is disabled, **the seed is the only way an account comes into
existence.** Re-running it re-hashes the fixture passwords, which is also how
you reset a password you have changed.

| Role | Email | Password | Can do |
| --- | --- | --- | --- |
| `ADMIN` | `admin@geoplan.ph` | `admin123` | Everything, including **Close all stale visits** |
| `GUARD` | `guard@geoplan.ph` | `guard123` | Live list, check-out, step-out, history — no stale cleanup |

Sign in at `/login`. The kiosk (`/kiosk`) is public by design and needs no login.

### Other seeded test data

- **3 hosts** — Jeffrey E. (HR), Benjamin N. (Facilities & Security), Charlie K. (Sales).
- **4 appointment references** for the kiosk lookup: `APT-1001`, `APT-1002`,
  `APT-1003` are unused; **`APT-1004` is seeded as already redeemed** so the
  "already used" error path can be tested without checking in first.

Re-running the seed is idempotent and resets `APT-1004` back to used, so the
appointment flow can be exercised repeatedly.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Next.js dev server (Turbopack) |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run db:migrate` | `prisma migrate dev` — create and apply a migration |
| `npm run db:seed` | `tsx prisma/seed.ts` |
| `npm run db:studio` | `prisma studio` — browse the data |
| `./node_modules/.bin/tsc --noEmit` | Typecheck (see quirks: `npx tsc` does **not** work) |

## Routes

| Path | Auth | What it is |
| --- | --- | --- |
| `/` | public | Landing |
| `/login` | public | Staff login |
| `/kiosk` | public | Check-in method chooser |
| `/kiosk/appointment` | public | Look up a reference number and confirm |
| `/kiosk/walkin` | public | Name, purpose, host |
| `/kiosk/delivery` | public | Courier drop-off; recipient optional |
| `/dashboard` | session | Live check-ins + check-out actions |
| `/dashboard/appointments` | session | Pre-register a visitor, list and cancel |
| `/dashboard/history` | session | Searchable visit log + frequency chart |
| `/dashboard/hosts` | ADMIN | Host directory — add, rename, deactivate |
| `/api/auth/*` | public | Better Auth's own endpoints (sign-in, sign-out, session) |

The API routes are listed in [`STATUS.md`](./STATUS.md#api).

---

## What works right now

✅ **Kiosk**

- Walk-in, appointment and delivery check-in flows.
- Appointment references are single-use, enforced in a transaction — two people
  submitting the same one at once produces exactly one visit.
- **Idle reset:** a kiosk left mid-form asks "Are you still there?" after 45s
  and returns to the chooser screen at 60s, so it is clean for the next visitor.
- Inline validation, disabled-while-submitting buttons, and errors that clear as
  soon as the visitor starts fixing them.

✅ **Front desk**

- **Pre-register a visitor** at `/dashboard/appointments` and hand them the
  reference number the kiosk asks for. Generated, not sequential: six characters
  from an alphabet with `O`/`0` and `I`/`1`/`L` taken out, so it survives being
  read off a phone and typed on a tablet.
- Cancel one that is no longer coming. A reference that has already been
  redeemed cannot be cancelled — it produced a visit, and the visit stays.
- **Host directory** at `/dashboard/hosts` (admin only). Add someone, rename
  them, move their department, or deactivate them when they leave. There is no
  delete, on purpose: `Visitor.hostId` cascades, so removing a host row would
  take their visit history with it.

✅ **Dashboard**

- Live check-in list, polling every 5s and pausing on a backgrounded tab.
- Check-out, with a "will they return today?" prompt; a stepped-out visitor is
  parked in `PENDING_RETURN` and resumes the *same* visit when they come back.
- Admin-only bulk cleanup of visits left open from a previous day.
- History with name/host/date-range filters, pagination (25/page) and a
  visitors-per-day chart.
- Dark / light theme toggle.

✅ **Both**

- One shared date/time formatter ([`src/lib/dates.ts`](./src/lib/dates.ts)) —
  every timestamp in the app reads the same way.
- Empty states that say *why* a table is empty, and skeletons while a page loads.
- Laid out for a tablet kiosk and a phone-sized dashboard: the live list becomes
  a card list below `md` so check-out is reachable without sideways scrolling.

✅ **Auth**

- Better Auth with email + password. Hashed credentials on `account`, session
  rows in `session`, signed cookie, 8-hour expiry that refreshes while in use.
- **Sign-up is switched off.** The catch-all at `/api/auth/*` mounts every
  Better Auth endpoint, so registration would otherwise be open to anyone who
  found it. Accounts come from the seed.
- `role` cannot be set through the API, so `/api/auth/update-user` can't be
  used to self-promote to `ADMIN`.
- Sign-in is rate limited (5/min per address), as are the public kiosk
  endpoints — see [`src/lib/rate-limit.ts`](./src/lib/rate-limit.ts) for what
  that does and doesn't cover.

❌ **Not built**

- **Host notification.** Nothing emails, texts or pages anyone. The kiosk says
  reception can see the visitor has arrived, which is all that is true.
- **Staff account management.** Sign-up is disabled and there is no admin UI,
  so `prisma/seed.ts` is still the only way to create a login.
- Group appointments, visitor identity across visits, badge printing.
- Any automated tests — verification is manual.
- A scheduled job for the stale-visit cleanup (the function is ready for one).
- Password reset / change from inside the app. Better Auth exposes the
  endpoints, but nothing sends email, so re-seeding is the reset path.
- Dark mode on `/` and `/login`. The toggle lives in the dashboard and only the
  dashboard and kiosk carry dark styles.

---

## Known quirks

Things that cost time once and shouldn't cost it twice.

- **An option in `src/lib/auth.ts` is a public route.** `/api/auth/[...all]`
  mounts whatever Better Auth is configured to expose, so enabling a feature
  there publishes its endpoint without anything else being written. Check what
  a new option adds before turning it on.
- **Re-seed after migrating, or nobody can sign in.** Credentials live on
  `account`, and a database that has never been seeded has no `account` rows —
  a correct password then still fails with "invalid email or password".
- **Restart `next dev` after a migration.** A schema change plus a regenerated
  client will not be picked up by a running dev server — stop it and start it
  again, or you will chase type errors that no longer exist.
- **`prisma migrate dev` does not regenerate the client here.** Run
  `npx prisma generate` explicitly after a schema change, or new fields simply
  won't exist on the typed client.
- **`npx tsc` doesn't work** — it resolves to a stub package that prints "This
  is not the tsc command you are looking for". Use
  `./node_modules/.bin/tsc --noEmit`.
- **After adding or renaming an API route, run `npx next typegen`.** This
  Next.js version type-checks `RouteContext<"/api/...">` against a generated
  route manifest, so a new route fails `tsc` until the manifest is rebuilt.
- **Adding a column with a default needs a backfill plan.** A plain
  `ADD COLUMN ... DEFAULT` applies that default to *every* existing row. Use
  `prisma migrate dev --create-only`, add the `UPDATE`, then apply.
- **`server-only` blocks running `src/lib/*` from a script.** To drive those
  modules outside Next.js, run tsx with `--conditions=react-server`, which
  resolves the package to its no-op build.
- **On Windows, Node resolves `/tmp` to `C:\tmp`** (which doesn't exist). Use a
  real temp path for scratch files.
- **`dotenv.config()` prints a banner to stdout** — pass `{ quiet: true }` when
  capturing a script's output into a shell variable.
- **The agent-instructions block in `AGENTS.md` is rewritten by `next dev`.**
  Committing it alongside your work keeps the tree clean.
- **`P1000: Authentication failed`** on any `prisma` command or a 500 on
  `/kiosk/walkin` means `DATABASE_URL` is wrong or Postgres isn't running — the
  app surfaces it as a server error rather than a friendly page.
