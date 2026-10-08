-- AlterTable
ALTER TABLE "appointment" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- AlterTable
ALTER TABLE "visitor" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- AlterTable
ALTER TABLE "visitor_profile" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "nameKey" TEXT;

-- AlterTable
ALTER TABLE "visitor_verification" ADD COLUMN     "nameKey" TEXT;

-- ---------------------------------------------------------------------------
-- Backfill. Step one of two: the old single-name columns stay until the next
-- migration has verified every row below was filled.
--
-- Rule: trim and collapse whitespace, then split on the LAST space. Everything
-- before it is the first name, the last word is the last name. A one-word name
-- becomes the first name with an empty last name.
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.clean_name(value TEXT) RETURNS TEXT
  LANGUAGE SQL IMMUTABLE AS
  $$ SELECT regexp_replace(btrim(value), '\s+', ' ', 'g') $$;

CREATE FUNCTION pg_temp.first_part(value TEXT) RETURNS TEXT
  LANGUAGE SQL IMMUTABLE AS
  $$ SELECT CASE WHEN position(' ' IN pg_temp.clean_name(value)) = 0
                 THEN pg_temp.clean_name(value)
                 ELSE regexp_replace(pg_temp.clean_name(value), ' [^ ]*$', '')
            END $$;

CREATE FUNCTION pg_temp.last_part(value TEXT) RETURNS TEXT
  LANGUAGE SQL IMMUTABLE AS
  $$ SELECT CASE WHEN position(' ' IN pg_temp.clean_name(value)) = 0
                 THEN ''
                 ELSE regexp_replace(pg_temp.clean_name(value), '^.* ', '')
            END $$;

UPDATE "visitor"
SET "firstName" = pg_temp.first_part("name"),
    "lastName"  = pg_temp.last_part("name");

UPDATE "appointment"
SET "firstName" = pg_temp.first_part("visitorName"),
    "lastName"  = pg_temp.last_part("visitorName");

-- `nameKey` must equal what `makeNameKey()` in src/lib/names.ts computes, which
-- also strips accents. SQL here only lower-cases (the parts are already trimmed
-- and collapsed), so that is exact only for ASCII names — refuse anything else
-- rather than write keys the app would never match.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "visitor_profile" WHERE "name" ~ '[^\x01-\x7F]') THEN
    RAISE EXCEPTION 'visitor_profile has non-ASCII names; backfill nameKey with makeNameKey() instead';
  END IF;
END $$;

UPDATE "visitor_profile"
SET "firstName" = pg_temp.first_part("name"),
    "lastName"  = pg_temp.last_part("name");

UPDATE "visitor_profile"
SET "nameKey" = lower("firstName") || '|' || lower("lastName");

-- Verification codes live ten minutes and were issued for an email alone; a
-- code is now bound to email + name, so outstanding ones cannot carry over.
DELETE FROM "visitor_verification";
