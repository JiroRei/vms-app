-- AlterTable
ALTER TABLE "appointment" ADD COLUMN     "consentAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "visitorProfileId" TEXT;

-- CreateTable
CREATE TABLE "visitor_profile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_verification" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitor_verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visitor_profile_email_key" ON "visitor_profile"("email");

-- CreateIndex
CREATE INDEX "visitor_verification_email_createdAt_idx" ON "visitor_verification"("email", "createdAt");

-- CreateIndex
CREATE INDEX "visitor_verification_createdAt_idx" ON "visitor_verification"("createdAt");

-- CreateIndex
CREATE INDEX "appointment_visitorProfileId_idx" ON "appointment"("visitorProfileId");

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_visitorProfileId_fkey" FOREIGN KEY ("visitorProfileId") REFERENCES "visitor_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
