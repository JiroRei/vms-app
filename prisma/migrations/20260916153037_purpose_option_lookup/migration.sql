-- Converts the free-text `purpose` on `visitor` and `appointment` into a
-- reference to an admin-managed lookup table.
--
-- Hand-written because the interesting part is the backfill: every existing
-- purpose string has to become a row in `purpose_option` and every visitor and
-- appointment has to end up pointing at the right one. The old columns are
-- dropped only after a check confirms that happened — see the DO block below.

-- CreateTable
CREATE TABLE "purpose_option" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purpose_option_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purpose_option_label_key" ON "purpose_option"("label");

-- CreateIndex
CREATE INDEX "purpose_option_isActive_sortOrder_idx" ON "purpose_option"("isActive", "sortOrder");

-- Backfill 1/3: one option per distinct purpose already in use, across both
-- tables. Ordered by how often each was used, so the most common purposes sort
-- to the top of the dropdown; the range starts at 1000 to leave room for the
-- seeded defaults, which `prisma/seed.ts` places at 10..50.
--
-- Blank and whitespace-only values are skipped rather than becoming an option
-- with an empty label. Those rows keep a NULL `purposeId`, which the column
-- allows, and the check below excludes them for the same reason.
INSERT INTO "purpose_option" ("id", "label", "isActive", "sortOrder")
SELECT
    gen_random_uuid()::text,
    t."purpose",
    true,
    1000 + (row_number() OVER (ORDER BY count(*) DESC, t."purpose"))::int * 10
FROM (
    SELECT "purpose" FROM "visitor"
    UNION ALL
    SELECT "purpose" FROM "appointment"
) t
WHERE t."purpose" IS NOT NULL AND btrim(t."purpose") <> ''
GROUP BY t."purpose";

-- AlterTable: the new foreign keys go on nullable, which is also their final
-- state — a delivery collects no purpose, and neither did some historical rows.
ALTER TABLE "visitor" ADD COLUMN     "purposeId" TEXT;
ALTER TABLE "appointment" ADD COLUMN     "purposeId" TEXT;

-- Backfill 2/3: point every row at the option matching the string it held.
UPDATE "visitor" v
   SET "purposeId" = p."id"
  FROM "purpose_option" p
 WHERE p."label" = v."purpose";

UPDATE "appointment" a
   SET "purposeId" = p."id"
  FROM "purpose_option" p
 WHERE p."label" = a."purpose";

-- Backfill 3/3: verify before anything is dropped.
--
-- Migrations run in a transaction, so raising here rolls back the whole thing
-- and leaves the original columns untouched. That is the point: a partial
-- backfill must not be allowed to destroy the only copy of the data it failed
-- to convert.
DO $$
DECLARE
    orphaned_visitors bigint;
    orphaned_appointments bigint;
BEGIN
    SELECT count(*) INTO orphaned_visitors
      FROM "visitor"
     WHERE "purpose" IS NOT NULL AND btrim("purpose") <> '' AND "purposeId" IS NULL;

    SELECT count(*) INTO orphaned_appointments
      FROM "appointment"
     WHERE "purpose" IS NOT NULL AND btrim("purpose") <> '' AND "purposeId" IS NULL;

    IF orphaned_visitors > 0 OR orphaned_appointments > 0 THEN
        RAISE EXCEPTION
            'Purpose backfill incomplete: % visitor row(s) and % appointment row(s) still have no purposeId. Refusing to drop the purpose columns.',
            orphaned_visitors, orphaned_appointments;
    END IF;
END $$;

-- DropColumn: superseded by the foreign key above.
ALTER TABLE "visitor" DROP COLUMN "purpose";
ALTER TABLE "appointment" DROP COLUMN "purpose";

-- CreateIndex
CREATE INDEX "visitor_purposeId_idx" ON "visitor"("purposeId");

-- CreateIndex
CREATE INDEX "appointment_purposeId_idx" ON "appointment"("purposeId");

-- AddForeignKey
-- RESTRICT, not SET NULL: an option that historical visits point at must not be
-- removable, or those visits would silently lose what they were recorded as.
-- Retirement is `isActive = false`, which leaves the link intact.
ALTER TABLE "visitor" ADD CONSTRAINT "visitor_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "purpose_option"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "purpose_option"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
