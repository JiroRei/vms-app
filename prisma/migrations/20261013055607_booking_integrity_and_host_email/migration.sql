-- DropIndex
DROP INDEX "purpose_option_label_key";

-- AlterTable
ALTER TABLE "host" ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE INDEX "purpose_option_label_idx" ON "purpose_option"("label");

-- Purpose names differ only by case should be treated as the same option.
CREATE UNIQUE INDEX "purpose_option_label_lower_key"
  ON "purpose_option" (lower(btrim("label")));

-- A host may have at most one active appointment at an exact instant. The
-- service translates this constraint into a clear slot-unavailable response.
CREATE UNIQUE INDEX "appointment_one_pending_per_host_time"
  ON "appointment" ("hostId", "scheduledFor")
  WHERE "status" = 'PENDING';
