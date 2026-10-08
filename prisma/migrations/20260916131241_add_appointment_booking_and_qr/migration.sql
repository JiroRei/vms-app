-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CHECKED_IN', 'CANCELLED', 'EXPIRED');

-- AlterTable
-- Written by hand rather than generated: `qrToken`, `visitorEmail`,
-- `scheduledFor` and `expiresAt` are all required, and the table already holds
-- appointments that predate every one of them. They go on nullable, get
-- backfilled below, and are tightened to NOT NULL only once every row has a
-- value.
ALTER TABLE "appointment"
    ADD COLUMN     "qrToken" TEXT,
    ADD COLUMN     "visitorEmail" TEXT,
    ADD COLUMN     "visitorPhone" TEXT,
    ADD COLUMN     "scheduledFor" TIMESTAMP(3),
    ADD COLUMN     "expiresAt" TIMESTAMP(3),
    ADD COLUMN     "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill.
--
-- `qrToken` gets a real random uuid per row, the same shape the application
-- mints, so old appointments are scannable rather than second-class.
--
-- `visitorEmail` has no truthful answer for a row booked before the column
-- existed, so it gets an address that provably cannot be delivered to: RFC 2606
-- reserves `.invalid`, which makes an accidental send fail loudly instead of
-- reaching a stranger. The seed overwrites these with its fixture addresses.
--
-- `scheduledFor` falls back to `createdAt` — the only time these rows carry —
-- and `expiresAt` to four hours after it, matching APPOINTMENT_GRACE_HOURS in
-- `src/lib/qr.ts`. Both are in the past for existing rows, which is correct:
-- they were booked long ago and should not stay redeemable forever.
UPDATE "appointment" SET
    "qrToken" = gen_random_uuid()::text,
    "visitorEmail" = 'noreply+' || lower("referenceNumber") || '@example.invalid',
    "scheduledFor" = "createdAt",
    "expiresAt" = "createdAt" + interval '4 hours',
    -- The `used` boolean only ever meant these two states.
    "status" = CASE WHEN "used" THEN 'CHECKED_IN'::"AppointmentStatus"
                    ELSE 'PENDING'::"AppointmentStatus" END;

ALTER TABLE "appointment"
    ALTER COLUMN "qrToken" SET NOT NULL,
    ALTER COLUMN "visitorEmail" SET NOT NULL,
    ALTER COLUMN "scheduledFor" SET NOT NULL,
    ALTER COLUMN "expiresAt" SET NOT NULL;

-- DropColumn: superseded by `status`, whose PENDING/CHECKED_IN pair carries
-- everything this said.
ALTER TABLE "appointment" DROP COLUMN "used";

-- AlterTable: who checked a visitor in, when it was not the visitor themselves.
ALTER TABLE "visit" ADD COLUMN     "checkedInBy" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "appointment_qrToken_key" ON "appointment"("qrToken");

-- CreateIndex
CREATE INDEX "appointment_status_idx" ON "appointment"("status");

-- CreateIndex
CREATE INDEX "visit_checkedInBy_idx" ON "visit"("checkedInBy");

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_checkedInBy_fkey" FOREIGN KEY ("checkedInBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
