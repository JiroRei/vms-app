CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
CREATE TABLE "kiosk_device" (
  "id" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "label" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kiosk_device_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kiosk_device_deviceId_key" ON "kiosk_device"("deviceId");
CREATE TABLE "email_outbox" (
  "id" TEXT NOT NULL, "to" TEXT NOT NULL, "subject" TEXT NOT NULL,
  "html" TEXT NOT NULL, "text" TEXT NOT NULL, "attachments" JSONB NOT NULL DEFAULT '[]',
  "kind" TEXT NOT NULL, "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT, "expiresAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3), "lockedUntil" TIMESTAMP(3),
  CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "email_outbox_status_nextAttemptAt_idx" ON "email_outbox"("status", "nextAttemptAt");
CREATE TABLE "rate_limit_bucket" (
  "key" TEXT NOT NULL, "count" INTEGER NOT NULL DEFAULT 1, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "rate_limit_bucket_expiresAt_idx" ON "rate_limit_bucket"("expiresAt");
