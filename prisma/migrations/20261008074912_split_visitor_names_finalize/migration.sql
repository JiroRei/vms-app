-- Step two of two: verify the backfill from `split_visitor_names_backfill`,
-- then drop the single-name columns and make the split ones required.
--
-- The check runs first and inside the migration's transaction, so a gap in the
-- backfill aborts here with the original columns still intact rather than
-- dropping the only copy of a name. "Gap" means a null part, or parts that do
-- not recombine to the original (whitespace-collapsed) name.
DO $$
DECLARE
  bad_visitors     INTEGER;
  bad_appointments INTEGER;
  bad_profiles     INTEGER;
BEGIN
  SELECT count(*) INTO bad_visitors FROM "visitor"
  WHERE "firstName" IS NULL OR "lastName" IS NULL
     OR btrim("firstName" || ' ' || "lastName")
        <> regexp_replace(btrim("name"), '\s+', ' ', 'g');

  SELECT count(*) INTO bad_appointments FROM "appointment"
  WHERE "firstName" IS NULL OR "lastName" IS NULL
     OR btrim("firstName" || ' ' || "lastName")
        <> regexp_replace(btrim("visitorName"), '\s+', ' ', 'g');

  SELECT count(*) INTO bad_profiles FROM "visitor_profile"
  WHERE "firstName" IS NULL OR "lastName" IS NULL OR "nameKey" IS NULL
     OR btrim("firstName" || ' ' || "lastName")
        <> regexp_replace(btrim("name"), '\s+', ' ', 'g');

  IF bad_visitors + bad_appointments + bad_profiles > 0 THEN
    RAISE EXCEPTION 'Name backfill incomplete: % visitor, % appointment, % profile rows; nothing dropped',
      bad_visitors, bad_appointments, bad_profiles;
  END IF;

  IF EXISTS (SELECT 1 FROM "visitor_verification" WHERE "nameKey" IS NULL) THEN
    DELETE FROM "visitor_verification" WHERE "nameKey" IS NULL;
  END IF;
END $$;

-- DropIndex
DROP INDEX "visitor_profile_email_key";

-- AlterTable
ALTER TABLE "appointment" DROP COLUMN "visitorName",
ALTER COLUMN "firstName" SET NOT NULL,
ALTER COLUMN "lastName" SET NOT NULL;

-- AlterTable
ALTER TABLE "visitor" DROP COLUMN "name",
ALTER COLUMN "firstName" SET NOT NULL,
ALTER COLUMN "lastName" SET NOT NULL;

-- AlterTable
ALTER TABLE "visitor_profile" DROP COLUMN "name",
ALTER COLUMN "firstName" SET NOT NULL,
ALTER COLUMN "lastName" SET NOT NULL,
ALTER COLUMN "nameKey" SET NOT NULL;

-- AlterTable
ALTER TABLE "visitor_verification" ALTER COLUMN "nameKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "visitor_profile_email_nameKey_key" ON "visitor_profile"("email", "nameKey");

-- CreateIndex
CREATE INDEX "visitor_verification_email_nameKey_createdAt_idx" ON "visitor_verification"("email", "nameKey", "createdAt");

