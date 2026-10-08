-- CreateEnum
CREATE TYPE "VisitEventType" AS ENUM ('CHECK_IN', 'STEP_OUT', 'RETURN', 'CHECK_OUT');

-- CreateTable
CREATE TABLE "visit_event" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "eventType" "VisitEventType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_event_visitId_timestamp_idx" ON "visit_event"("visitId", "timestamp");

-- AddForeignKey
ALTER TABLE "visit_event" ADD CONSTRAINT "visit_event_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every visit that already exists predates this log, so expanding one
-- would show an empty timeline. The three timestamps on `visit` are exactly the
-- events this table records, so they are replayed into it here.
--
-- Ids are uuids rather than cuids: the application generates cuids, but nothing
-- reads these ids beyond React keys, and a uuid is what Postgres can mint on its
-- own. On a fresh database there are no visits and all three inserts are no-ops.

-- CHECK_IN — every visit has one, including a delivery.
INSERT INTO "visit_event" ("id", "visitId", "eventType", "timestamp")
SELECT gen_random_uuid()::text, "id", 'CHECK_IN', "checkInTime"
FROM "visit";

-- STEP_OUT — only for visits still carrying an `exitTime`. A visit that stepped
-- out and came back had it cleared on return, so that round trip is genuinely
-- unrecoverable for historical rows; this reconstructs what the row still knows.
INSERT INTO "visit_event" ("id", "visitId", "eventType", "timestamp")
SELECT gen_random_uuid()::text, "id", 'STEP_OUT', "exitTime"
FROM "visit"
WHERE "exitTime" IS NOT NULL;

-- CHECK_OUT — finished visits only. For a delivery this lands on the same
-- instant as its CHECK_IN, which is the correct two-event pair for a drop-off.
INSERT INTO "visit_event" ("id", "visitId", "eventType", "timestamp")
SELECT gen_random_uuid()::text, "id", 'CHECK_OUT', "checkOutTime"
FROM "visit"
WHERE "checkOutTime" IS NOT NULL;
