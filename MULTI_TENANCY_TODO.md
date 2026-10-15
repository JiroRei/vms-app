# Organization isolation and tenancy

## Chosen deployment model

Organizations use **separate deployments and separate PostgreSQL databases**.
This keeps each organization's hosts, visits, bookings, staff, visitor passes,
export audit and rate-limit state physically separate without adding an
organization discriminator to every query.

Each deployment has its own secrets, mail credentials, origin, database URL,
organization display name and site time zone. Set the public display values in
`.env` before building because Next.js embeds `NEXT_PUBLIC_*` variables in
the client bundle. See `.env.example`.

The current build still uses generic defaults:
`Visitor Management System`, `Asia/Manila`. This is suitable for local
development, not a configured customer deployment.

## Per-deployment checklist

- [ ] Keep `KioskDevice`, `EmailOutbox` and `RateLimitBucket` data deployment-local. In a shared database, add organization ownership and scope heartbeat upserts, status lists, cron sweeps, email logs/retries, and counter keys to it.
- [ ] Make `PUBLIC_BOOKING_EMAIL_LIMIT`, `PUBLIC_BOOKING_IP_LIMIT`, `VERIFICATION_IP_LIMIT` and `KIOSK_HEARTBEAT_IP_LIMIT` in `booking-config.ts` organization-specific; define whether IP quotas are per organization or shared across the installation.

- [ ] Provision a unique database and restrict database credentials to that
  deployment.
- [ ] Set a real `NEXT_PUBLIC_ORGANIZATION_NAME`,
  `NEXT_PUBLIC_SITE_TIMEZONE`, and optional
  `NEXT_PUBLIC_SITE_TIMEZONE_LABEL` before build.
- [ ] Generate distinct `BETTER_AUTH_SECRET`, `BOOKING_VERIFY_SECRET`,
  `PASS_SECRET`, and `CRON_SECRET` values for each deployment.
- [ ] Configure a verified application origin, HTTPS, mail sender and
  organization privacy details.
- [ ] Keep production credentials and visitor data out of shared development
  fixtures and logs.

`ExportLog` and `ORGANIZATION_NAME` remain relevant isolation points: their
data and display are deployment-local today. If a future product needs several
organizations in one running app or database, complete the shared-database
migration below before enabling that mode.

## Shared-database SaaS migration (not implemented)

A future shared application must add an `Organization` model and enforce
tenant ownership for all tenant data, including `ExportLog`, `PurposeOption`,
`Host`, `Visitor`, `Visit`, `VisitEvent`, `Appointment`,
`AppointmentEvent`, `VisitorProfile`, `VisitorPass`, and
`VisitorVerification`. Staff users need an organization membership and every
authorization check must derive the organization from the authenticated
session. Public routes need an explicit, trusted host-to-organization resolver.

That migration must also:

- Scope history queries, CSV cursor batches, stale-visit sweeps, booking,
  appointment lookup/check-in, visitor profile/pass lookup, staff lists and
  admin actions by the same organization.
- Add composite constraints so a visit cannot point to another organization's
  visitor or profile, an appointment cannot point to another organization's
  host or purpose, and a pass cannot belong to another organization's profile.
- Move organization name, time zone, auto-close time, booking hours,
  appointment windows, upcoming horizon, purpose settings, pass thresholds and
  retention settings into organization records.
- Use organization-scoped rate limits and secrets, including visitor pass and
  appointment-manage signing keys. Plan pass-secret rotation without
  invalidating every organization's passes at once.
- Migrate existing rows to a known default organization, audit uniqueness and
  cross-record references, then test cross-organization access denial for every
  public and staff route before onboarding a second tenant.
- Preserve export audit history and retain the exporter's user identifier when
  staff accounts are removed.

Never treat a UI selector or hidden navigation link as tenant authorization.
The database query and server-side role check must both enforce organization
ownership.

## Markers in the current code

`TODO(multi-tenancy)` comments mark deployment-global settings and shared
queries that need revisiting if the chosen separate-deployment model changes.
Find them with:

```powershell
rg -n "TODO\(multi-tenancy\)" src prisma
```
