# CSV export and daily register

Admins can export from Visit History. CSV exports use the applied name, date,
host and type filters and include every matching row, regardless of page.
Guards and unauthenticated requests receive 403 from `/api/visits/export`.
Both staff roles can use `/dashboard/register` and browser print-to-PDF.

Dates and times use `SITE_TIMEZONE` in `src/lib/site-config.ts`. The generic
`ORGANIZATION_NAME` is shared by the kiosk and register header. Date ranges
include both selected calendar days, using midnight of the next day as the
exclusive end. Invalid dates are ignored by history/export and default to today
on the register. Legacy `hideDeliveries=1` links still work; the Type control
supports All types, Guest and Delivery.

CSV files contain a UTF-8 BOM, CRLF record separators and quoted fields.
Formula-like cells receive an apostrophe, including after leading whitespace.
Times are `YYYY-MM-DD HH:mm`. Unbounded filename dates use `all`, for example
`visits_all_to_all.csv`. Duration is whole elapsed minutes from check-in to
checkout, or export time for an open visit; auto-closed durations are blank.
Guard assistance takes precedence over the underlying QR/pass method.
Older deliveries use their simultaneous checkout attribution when no check-in
attribution exists.

Exports read in cursor batches of 1,000 with deterministic check-in/ID sorting.
Rows created after the export begins are excluded. `ExportLog` retains the
exporter's user ID, normalized filters (without pagination), generation time
and number of rows produced. It is created before streaming and updated for
each batch, so interrupted exports retain their progress. The user identifier
is retained independently of staff account deletion. There is no audit UI.

The reusable `PrintTable` accepts columns, rows and a row key. Print CSS hides
dashboard controls, requests A4 landscape, repeats the table header and keeps
rows together. The attribution timestamp refreshes immediately before print,
including when printing from Chrome's menu.

## Verification

The migration was applied to the local database and the isolated test database,
the Prisma client regenerated, and the dev server restarted.

Run focused database tests against the derived `_test` database:

```powershell
node --import tsx --import ./tests/setup.ts --conditions=react-server --test --test-concurrency=1 tests/reporting.test.ts
```

Run HTTP verification with the local dev server on port 3000:

```powershell
node --import tsx --conditions=react-server tests/verify-reporting-http.ts
```

These checks create and delete only their own fixtures. They cover large
exports, audit counts, all filters, BOM/accent preservation, injection safety,
ADMIN/guard permissions, register states and 23:50/00:10 day boundaries.

Interactive checks remain pending because no browser or Excel surface was
connected to the automation session:

1. Open an exported CSV in Excel and confirm `José` displays correctly and a
   name beginning with `=` is text.
2. Open a register with enough rows for multiple pages in Chrome and click
   Print. Confirm A4 landscape, repeating column headers, unsplit rows, hidden
   dashboard navigation and black text on white paper.

The repository-wide TypeScript check currently stops on an untracked
`src/test.ts` file that contains only zero characters and is parsed as invalid
octal syntax. It has been left untouched. The full automated suite also needs
to be run outside the sandbox: Node's test runner could not spawn child
processes inside it (`EPERM`). See [CONTINUATION.md](../CONTINUATION.md) for
the current verification state.
