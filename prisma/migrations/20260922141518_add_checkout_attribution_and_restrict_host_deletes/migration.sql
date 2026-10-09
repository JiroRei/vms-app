-- DropForeignKey
ALTER TABLE "appointment" DROP CONSTRAINT "appointment_hostId_fkey";

-- DropForeignKey
ALTER TABLE "visitor" DROP CONSTRAINT "visitor_hostId_fkey";

-- AlterTable
ALTER TABLE "visit" ADD COLUMN     "checkedOutById" TEXT,
ADD COLUMN     "checkedOutByName" TEXT;

-- CreateIndex
CREATE INDEX "visit_checkedOutById_idx" ON "visit"("checkedOutById");

-- AddForeignKey
ALTER TABLE "visitor" ADD CONSTRAINT "visitor_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "host"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit" ADD CONSTRAINT "visit_checkedOutById_fkey" FOREIGN KEY ("checkedOutById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "host"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
