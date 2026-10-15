-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('WALK_IN', 'APPOINTMENT', 'DELIVERY', 'PASS');

-- CreateEnum
CREATE TYPE "VisitorPassStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "PassIssueReason" AS ENUM ('RECURRING_AUTO', 'STAFF_ISSUED');

-- AlterTable
ALTER TABLE "visit" ADD COLUMN     "checkInMethod" "CheckInMethod",
ADD COLUMN     "visitorProfileId" TEXT;

-- AlterTable
ALTER TABLE "visitor_profile" ADD COLUMN     "recurringSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "visitor_pass" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "VisitorPassStatus" NOT NULL DEFAULT 'ACTIVE',
    "issueReason" "PassIssueReason" NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "visitor_pass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visitor_pass_profileId_idx" ON "visitor_pass"("profileId");

-- CreateIndex
CREATE INDEX "visitor_pass_revokedByUserId_idx" ON "visitor_pass"("revokedByUserId");

-- CreateIndex
CREATE INDEX "visit_visitorProfileId_checkInTime_idx" ON "visit"("visitorProfileId", "checkInTime");

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_visitorProfileId_fkey" FOREIGN KEY ("visitorProfileId") REFERENCES "visitor_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_pass" ADD CONSTRAINT "visitor_pass_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "visitor_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitor_pass" ADD CONSTRAINT "visitor_pass_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- At most one ACTIVE pass per profile. A partial unique index, which Prisma
-- cannot express in the schema; `issuePass()` relies on it to make concurrent
-- issuance (two check-ins finishing at once) produce exactly one pass.
CREATE UNIQUE INDEX "visitor_pass_one_active_per_profile"
  ON "visitor_pass" ("profileId")
  WHERE "status" = 'ACTIVE';

-- Backfill: a visit that redeemed an appointment belongs to that appointment's
-- profile (if it has one), and was an appointment check-in.
UPDATE "visit" v
SET "visitorProfileId" = a."visitorProfileId",
    "checkInMethod" = 'APPOINTMENT'
FROM "appointment" a
WHERE a."visitId" = v."id";

-- Deliveries are recognisable by their visitor's type. Every other existing
-- visit keeps a null method: a legacy walk-in and an appointment check-in from
-- before visits were linked look the same, and null says "not recorded" rather
-- than guessing.
UPDATE "visit" v
SET "checkInMethod" = 'DELIVERY'
FROM "visitor" vr
WHERE vr."id" = v."visitorId" AND vr."type" = 'DELIVERY' AND v."checkInMethod" IS NULL;
