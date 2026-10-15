# Notifications and password recovery

## Host arrival notices

Hosts can store an optional arrival email in the admin host directory. When a
walk-in, visitor-pass check-in, or appointment check-in completes, the server
loads the selected host contact and sends a notice after the response using
Next.js `after()`. The email contains the visitor name, check-in time in the
configured site time zone, and purpose when present. Delivery logs do not send
arrival notices.

The contact is optional. A missing address, provider outage, or failed delivery
does not roll back a visit and does not change the check-in response. Host
notices use `RESEND_API_KEY` and `APPOINTMENT_FROM_EMAIL`, the same sender
configuration as appointment and visitor-pass email. Confirm a verified sender
and appropriate recipient policy before production use.

## Staff password recovery

The login page links to `/forgot-password`. The request form calls Better Auth's
`POST /api/auth/request-password-reset` endpoint and always shows the same
confirmation text, whether or not the email matches a staff account. Better
Auth sends a one-hour link to `/reset-password?token=...` through the configured
`sendResetPassword` callback. `/reset-password` posts the new password to
`POST /api/auth/reset-password`.

Reset links use the configured application origin and are delivered with the
same persistent outbox and Resend settings as other transactional messages.
Unconfigured senders and provider failures queue retries; expired links are
dropped. Links, codes and tokens are never written to application logs.
Successful password resets revoke all
sessions for that user.

## Verification

`npm run test:http:password-reset` exercises the flow against a running local
server with a temporary account, verifies that prior sessions are removed,
and deletes the temporary account and reset record. Provider delivery still
requires a real configured sender and inbox test.
