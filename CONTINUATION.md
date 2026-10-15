# Continuation checklist

This file tracks what remains after the completed visitor reporting, visitor
pass, booking, notification, and password recovery changes. Current deployment
model: one deployment and PostgreSQL database per organization. The default
display name remains `Visitor Management System` until deployment configuration
provides a real value.

## Environment and production setup

- [ ] Configure `RESEND_API_KEY` and a verified `APPOINTMENT_FROM_EMAIL`; test
  appointment, pass, password reset, and optional host arrival messages with
  the provider. Check delivery failures in the admin email log; credentials are
  never printed in application logs.
- [ ] Set strong unique production values for `BETTER_AUTH_SECRET`,
  `BOOKING_VERIFY_SECRET`, `PASS_SECRET`, and `CRON_SECRET`; configure
  `BETTER_AUTH_URL`, HTTPS, and trusted origins. Replace seeded fixture
  passwords before deployment.
- [ ] Set `NEXT_PUBLIC_ORGANIZATION_NAME` and `NEXT_PUBLIC_SITE_TIMEZONE`
  before building each deployment. The defaults are for local development.
- [ ] Complete the privacy notice with the operating organization's contact,
  retention period, access process, and actual service providers. Cover
  visitor pass lookup and booking prefill.
- [ ] Configure backup, retention, and restore procedures for each database.

## Product work still open

- [ ] Group appointments and consistent identity linking for anonymous walk-ins
  and legacy delivery records. This needs a product decision on how staff link
  records without visitor email or verified identity.
- [ ] Consider shared rate limits for the remaining kiosk check-in and login
  routes if a deployment runs multiple app instances. Public booking,
  verification lookup and heartbeats now use persistent database counters.
- [ ] Design staged visitor-pass secret rotation before changing `PASS_SECRET`;
  changing the current single signing key invalidates every active pass.

## Verification still pending

- [ ] Chrome print preview: verify A4 landscape, repeating header, and rows that
  do not split across pages.
- [ ] Open emergency roll-call in native Chrome print preview. Guard/admin
  browser checks and four-page Chromium PDF rendering passed, including A4
  portrait, repeating headers, intact rows and empty printed checkbox squares;
  no native Chrome surface was connected for the preview dialog check.
- [ ] Open accented names in Excel and confirm the UTF-8 BOM renders correctly;
  verify formula-like names are neutralized in a real spreadsheet application.
- [ ] Run a real HTTP role check: guard export returns 403 while the guard can
  open and print the register. Service tests cover filtering and register
  states, but do not replace this session-level browser check.
- [ ] Verify real email delivery and host arrival notices using a configured
  provider. Password reset request, expiring token, password change, generic
  response, and session revocation passed local HTTP integration tests.
- [ ] Run browser-based camera QR scanning on the deployed HTTPS origin.
- [x] Production build completed successfully. Local build logs warnings
  because `.env` has no production Better Auth secret or `BETTER_AUTH_URL`; set
  both for deployment.

## Not part of the current scope

PDF libraries, scheduled or emailed reports, signature columns, and an export
log interface remain excluded. Browser print-to-PDF is available for the daily
register. Shared-database SaaS tenancy is not the selected architecture; see
[`MULTI_TENANCY_TODO.md`](./MULTI_TENANCY_TODO.md) for the migration needed if
that decision changes.
