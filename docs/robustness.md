# Operations and testing

`GET /api/health` runs `SELECT 1` and returns only status, database health and UTC time. Monitor its HTTP status externally. Kiosks report every 30 seconds; dashboard monitoring polls every 15 seconds, becomes red after 90 seconds, and warns guards after 3 minutes. Retired devices stay excluded even if their browser keeps reporting. Clearing browser storage creates a new device; retire the old entry.

All email templates use `sendEmail`. Requests schedule email using Next's `after()`. Messages are persisted before the first delivery, claimed for five minutes, and retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours. The sixth failed attempt is final. Expired verification messages become FAILED with `Expired before delivery`; admins cannot retry expired mail. Provider idempotency keys reduce duplicate sends after crashes. Run `POST /api/cron/process-email-outbox` every minute with `Authorization: Bearer <CRON_SECRET>`; traffic also triggers a sweep at most once per minute per process. The admin email log exposes delivery metadata without rendering message contents. Configure retention and access policies for the outbox: it contains personal data and temporary email credentials.

`EMAIL_MODE=test` records SENT messages without contacting Resend. Never use it for real visitor traffic. `ERROR_WEBHOOK_URL` optionally receives sanitized JSON error reports; logs contain request IDs and masked email addresses. Configure the reverse proxy to overwrite forwarding headers, since public rate limits identify IPs through those trusted headers. Booking and verification counters persist in Postgres and old windows are pruned hourly.

## Local tests

Set `DATABASE_URL_TEST` to a separate schema such as `postgresql://USER:PASSWORD@localhost:5432/vms?schema=e2e`. If omitted, tests derive the `e2e` schema from `DATABASE_URL`. Setup rejects the development target, including equivalent URLs with different credentials/options. Both Prisma migrations and the driver adapter use this schema. Unit and end-to-end runs share the isolated schema, so run them sequentially. Never run either against a schema containing data you need to keep.

Run `bun run test:migrate`, `bun run test`, `bunx playwright install chromium`, then `bun run test:e2e`. The end-to-end runner migrates, reseeds and builds automatically, uses a production server on port 3100 with `.next-e2e`, and refuses to reuse an existing server. The database-failure health test uses port 3110 and an unreachable database address. Deterministic staff accounts are `guard@e2e.invalid` and `admin@e2e.invalid`, password `E2ePassword123!`. These fixtures exist only in the isolated schema. CI uses the Bun lockfile and dummy secrets. Existing node:test coverage is retained.

## Backups and restore

Install PostgreSQL client tools compatible with the server (`pg_dump`, `pg_restore`, and `psql`) and put them on PATH. Scripts report a skip when tools are unavailable; they never install system packages. Run `bun run db:backup`: a complete database custom-format dump is gzip-compressed into `backups/vms-<UTC timestamp>.dump.gz`. Partial dumps are removed on failure; the latest 14 successful dumps are kept. The directory is gitignored. Restrict filesystem access and encrypt/offsite-copy these dumps.

Restore to a **new empty database**, never the running application's database: set `DATABASE_URL_RESTORE` to that database, then run `bun run db:restore -- backups/vms-<timestamp>.dump.gz`. The restore runs in one transaction and refuses the development database. Check restored table counts, migrations and representative records before pointing an application at it. Custom-format dumps preserve all schemas, so URL `schema` does not remap the restore.

Real deployments should rely on the database provider's managed backups with point-in-time recovery. Local dumps supplement that service; regularly exercise restores and alert on backup failures.
