-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('ACTIVE', 'CHECKED_OUT', 'PENDING_RETURN');

-- AlterTable
ALTER TABLE "visit" ADD COLUMN     "exitTime" TIMESTAMP(3),
ADD COLUMN     "status" "VisitStatus" NOT NULL DEFAULT 'ACTIVE';

-- Backfill: the new column defaults every existing row to ACTIVE, but rows that
-- already carry a `checkOutTime` are finished visits. Without this, every past
-- visit in the table would read as ACTIVE and reappear in the live check-in
-- list. Visits with a null `checkOutTime` are correctly left ACTIVE — that is
-- exactly what the pre-existing `checkOutTime IS NULL` check meant.
UPDATE "visit" SET "status" = 'CHECKED_OUT' WHERE "checkOutTime" IS NOT NULL;

-- CreateIndex
CREATE INDEX "visit_status_idx" ON "visit"("status");
