-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('VISITOR', 'STAFF');

-- CreateEnum
CREATE TYPE "AppointmentEventType" AS ENUM ('CREATED', 'RESCHEDULED', 'CANCELLED', 'QR_REGENERATED', 'CHECKED_IN');

-- CreateEnum
CREATE TYPE "AppointmentActorType" AS ENUM ('VISITOR', 'STAFF', 'SYSTEM');

-- AlterTable
ALTER TABLE "appointment" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledBy" "CancelledBy",
ADD COLUMN     "visitId" TEXT;

-- CreateTable
CREATE TABLE "appointment_event" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "type" "AppointmentEventType" NOT NULL,
    "actorType" "AppointmentActorType" NOT NULL,
    "actorUserId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_event_appointmentId_createdAt_idx" ON "appointment_event"("appointmentId", "createdAt");

-- CreateIndex
CREATE INDEX "appointment_event_actorUserId_idx" ON "appointment_event"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_visitId_key" ON "appointment"("visitId");

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_event" ADD CONSTRAINT "appointment_event_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_event" ADD CONSTRAINT "appointment_event_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: every appointment that already exists predates the log, so it gets
-- its CREATED entry at its own `createdAt`. SYSTEM rather than VISITOR/STAFF
-- because who booked it was never recorded; `detail` says it was reconstructed.
-- Check-ins and cancellations before this migration carry no timestamp, so
-- they are not reconstructed.
INSERT INTO "appointment_event" ("id", "appointmentId", "type", "actorType", "detail", "createdAt")
SELECT gen_random_uuid()::text, "id", 'CREATED', 'SYSTEM',
       jsonb_build_object('backfilled', true, 'scheduledFor', to_jsonb("scheduledFor")),
       "createdAt"
FROM "appointment";
