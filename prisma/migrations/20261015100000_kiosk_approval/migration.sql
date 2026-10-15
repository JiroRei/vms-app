CREATE TYPE "KioskRegistrationStatus" AS ENUM ('PENDING', 'APPROVED', 'RETIRED');
ALTER TABLE "kiosk_device" ADD COLUMN "registrationStatus" "KioskRegistrationStatus" NOT NULL DEFAULT 'PENDING';
-- Existing browsers seen recently are the only devices kept in monitoring.
UPDATE "kiosk_device" SET "registrationStatus" = 'APPROVED'
WHERE "retiredAt" IS NULL AND "lastSeenAt" >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours';
UPDATE "kiosk_device" SET "registrationStatus" = 'RETIRED', "retiredAt" = COALESCE("retiredAt", CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
WHERE "retiredAt" IS NOT NULL OR "lastSeenAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '24 hours';
CREATE INDEX "kiosk_device_registrationStatus_lastSeenAt_idx" ON "kiosk_device"("registrationStatus", "lastSeenAt");
