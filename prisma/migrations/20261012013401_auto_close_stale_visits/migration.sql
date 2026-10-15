-- AlterEnum
ALTER TYPE "VisitEventType" ADD VALUE 'AUTO_CLOSE';

-- AlterTable
ALTER TABLE "visit" ADD COLUMN     "closedAutomatically" BOOLEAN NOT NULL DEFAULT false;
