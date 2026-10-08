-- AlterTable
ALTER TABLE "host" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "host_active_idx" ON "host"("active");
