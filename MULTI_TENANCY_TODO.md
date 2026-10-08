# Multi-tenancy checklist

This system currently supports **a single organization**. Multi-tenancy is a
planned future phase, and everything built before it arrives is implicitly
global — one shared list of hosts, one shared list of purposes, one shared pool
of visits.

This file is the running list of exactly where that assumption is baked in, so
none of it has to be rediscovered by reading the whole codebase when the work
starts. **Add an entry here whenever you build something that is not
tenant-scoped**, and pair it with a `TODO(multi-tenancy):` comment at the site
itself so the two can be cross-checked.

Find every marker in the code with:

```bash
grep -rn "TODO(multi-tenancy)" src prisma --include="*.ts" --include="*.tsx" --include="*.prisma"
```

(Scoped to `src` and `prisma` deliberately — pointing it at `.` walks
`node_modules` and appears to hang.)

---

## Outstanding

- **PurposeOption**: currently global/shared across the whole app. Needs
  `organizationId` added and every query (admin CRUD, kiosk dropdown, booking
  dropdown) scoped by it before onboarding a second real client.

  Specifics worth knowing before that work starts:
  - `label` is `@unique` globally. That has to become unique *per organization*,
    or the second client to want a "Meeting" option is refused one.
  - `src/lib/purposes.ts` holds every read and write. Scoping starts there.
  - `/dashboard/settings/purposes` lists and edits the whole table; an admin can
    currently rename or hide an option another organization depends on.
  - `POST /api/purposes`, `PATCH /api/purposes/[id]` and
    `POST /api/purposes/[id]/move` all act on the global list. The move endpoint
    renumbers **every** row, so one organization reordering its list would
    rewrite everyone's.
  - `prisma/seed.ts` seeds one default set. Each new organization will need its
    own copy.

---

## Also global, and not yet marked in code

Not part of the purpose work, but the same assumption applies. Listed here so
the checklist is honest about scope rather than looking complete:

- **Host** — one shared list behind every host dropdown and the history filter.
- **Visit / Visitor / VisitEvent** — no tenant column, so the dashboard's live
  list, history and stale-visit cleanup all read across everything.
- **Appointment** — booking, QR validation and check-in are all unscoped; a
  reference number or `qrToken` is globally unique rather than per-organization.
- **User / Role** — `ADMIN` means admin of the whole system, not of an
  organization.
