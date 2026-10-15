# Emergency roll-call

Guards and admins can open `/dashboard/roll-call` from the red dashboard header
button or the navigation. The query completes the existing stale-visit closing
rule before reading. ACTIVE non-delivery visits appear on site; PENDING_RETURN
visits appear only under “Out, expected back” and are excluded from the on-site
headcount. Checked-out and automatically closed visits are excluded. Both lists
sort by host or typed destination, then visitor name. There is no existing
Overdue marker in the current stale-visit configuration.

The page polls the authenticated, uncached `GET /api/roll-call` every 15 seconds
and provides a manual Refresh button. A failed refresh retains the last snapshot
and shows a warning with its timestamp. Times use the configured site time zone.

Accounted-for ticks are local to the browser tab, stored in sessionStorage as a
map keyed by visit ID within the signed-in user's storage key. Refreshes and
reloads retain them. Clear ticks removes that map. Ticks do not write to the
database, and only current on-site ticks contribute to the running count.

The shared daily-register PrintTable is used for both sections. Roll-call's
named print page requests A4 portrait; the daily register keeps A4 landscape.
Print hides interactive ticks and controls, substitutes empty checkbox squares,
repeats table headers, keeps rows intact, uses black on white, and adds headcounts
and “Printed by <user> at <timestamp>” in the site time zone. Poll updates pause
while the browser print dialog is open.

## Verification

`bun run test` includes query tests for section membership, destination/name
sorting, deliveries, checked-out visits and stale visits from the previous day.
`bun run test:e2e tests/e2e/roll-call.spec.ts` logs in as both guard and admin,
opens the header link from another dashboard page, checks ticks after manual
refresh, reload and an actual poll, clears ticks, and checks print styles.
The complete `bun run test:e2e` also passed all 11 tests together, with no skips.

The browser fixture contains 60 active visitors to exercise multiple print
pages. Four-page Chromium PDFs were rendered and visually checked for both
roles. Native Chrome print preview remains unverified because no Chrome surface
was connected. Browser fixtures are removed in afterEach; all test data stays
in the isolated e2e schema and the development audit checks for leaked fixtures.
