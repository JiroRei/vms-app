# Visitor Management System

A single-site visitor management system: an unattended kiosk where visitors
check themselves in, and a staff dashboard where guards see who is in the
building and check them out again.

- **Current state of each module** → [`STATUS.md`](./STATUS.md)
- **What changed and when** → [`CHANGELOG.md`](./CHANGELOG.md)

> ⚠️ **Login is throwaway dev-only auth.** Passwords are compared in plaintext
> and the session cookie is unsigned JSON, so anyone can forge one and claim
> `ADMIN`. Run this locally only. See [Known quirks](#known-quirks).

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

`.env` needs only `DATABASE_URL`:

```
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/vms?schema=public"
```

Prisma 7 reads that URL from `prisma7.config.ts`, **not** from
`schema.prisma` — there is no `url` field in the datasource block.

## Test logins

Created by `npm run db:seed`, and printed by it on every run. Both are
plaintext dev fixtures defined in [`prisma/seed.ts`](./prisma/seed.ts).

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
| `/dashboard/history` | session | Searchable visit log + frequency chart |

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

❌ **Not built**

- Real authentication (Better Auth is scaffolded but not switched on).
- Group appointments, visitor identity across visits, badge printing.
- Any automated tests — verification is manual.
- A scheduled job for the stale-visit cleanup (the function is ready for one).

---

## Known quirks

Things that cost time once and shouldn't cost it twice.

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
