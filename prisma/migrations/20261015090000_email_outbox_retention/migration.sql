-- KNOWN_ISSUES M-05: the outbox kept every email body (one-time codes, reset
-- links, manage links, visitor-pass QR images) forever. Bodies are now kept
-- only while a message can still be sent; see src/lib/email-outbox.ts.

ALTER TABLE "email_outbox"
  ADD COLUMN "passId" TEXT,
  ADD COLUMN "passVersion" INTEGER,
  ADD COLUMN "bodyClearedAt" TIMESTAMP(3);

CREATE INDEX "email_outbox_createdAt_idx" ON "email_outbox"("createdAt");

-- Expired messages can never be sent.
UPDATE "email_outbox"
SET "status" = 'FAILED', "lastError" = 'Expired before delivery', "lockedUntil" = NULL
WHERE "status" = 'PENDING' AND "expiresAt" IS NOT NULL AND "expiresAt" <= CURRENT_TIMESTAMP;

-- Pass emails queued before this change carry the QR image itself. Pass emails
-- are now rendered from the pass at send time, so these cannot be sent as they
-- are; staff can re-send the pass from the Visitors page.
UPDATE "email_outbox"
SET "status" = 'FAILED', "lastError" = 'Superseded: re-send the pass from the Visitors page', "lockedUntil" = NULL
WHERE "status" = 'PENDING' AND "kind" LIKE 'visitor-pass-%';

-- Scrub every body that is no longer needed: sent, finally failed, or expired.
UPDATE "email_outbox"
SET "html" = '', "text" = '', "attachments" = '[]', "bodyClearedAt" = CURRENT_TIMESTAMP
WHERE "status" <> 'PENDING';

-- The booking code was also in the subject line (KNOWN_ISSUES N-10).
UPDATE "email_outbox" SET "subject" = 'Your booking code' WHERE "kind" = 'verification';
