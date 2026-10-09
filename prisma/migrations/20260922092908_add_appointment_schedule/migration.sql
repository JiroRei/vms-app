-- Merge note (staging, 2026-10-08): `IF NOT EXISTS` added. On the revamp line
-- `scheduledFor` already exists (NOT NULL) from
-- 20260916131241_add_appointment_booking_and_qr, which sorts earlier, so the
-- original plain ADD COLUMN failed there. On a database where this migration
-- already ran, the statements are equivalent.

-- AlterTable
ALTER TABLE "appointment" ADD COLUMN IF NOT EXISTS "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "appointment_scheduledFor_idx" ON "appointment"("scheduledFor");
