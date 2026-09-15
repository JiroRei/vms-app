-- CreateTable
CREATE TABLE "appointment" (
    "id" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_referenceNumber_key" ON "appointment"("referenceNumber");

-- CreateIndex
CREATE INDEX "appointment_hostId_idx" ON "appointment"("hostId");

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "host"("id") ON DELETE CASCADE ON UPDATE CASCADE;
