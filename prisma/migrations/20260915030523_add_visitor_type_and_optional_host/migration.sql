-- CreateEnum
CREATE TYPE "VisitorType" AS ENUM ('GUEST', 'DELIVERY');

-- AlterTable
ALTER TABLE "visitor" ADD COLUMN     "type" "VisitorType" NOT NULL DEFAULT 'GUEST',
ALTER COLUMN "hostId" DROP NOT NULL;
