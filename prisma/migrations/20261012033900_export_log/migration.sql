-- CreateTable
CREATE TABLE "export_log" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_log_userId_createdAt_idx" ON "export_log"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "visit_checkInTime_id_idx" ON "visit"("checkInTime", "id");
