-- AlterTable
ALTER TABLE "appointment" ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "appointment_scheduledFor_idx" ON "appointment"("scheduledFor");
