-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('UPCOMING', 'ONGOING', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "status" "EventStatus" NOT NULL DEFAULT 'UPCOMING';

-- CreateIndex
CREATE INDEX "Event_status_idx" ON "Event"("status");

-- BackfillStatus: compute status for all existing rows based on current timestamps
UPDATE "Event"
SET "status" = CASE
  WHEN "endDate" < NOW()                         THEN 'EXPIRED'::"EventStatus"
  WHEN "startDate" <= NOW() AND "endDate" >= NOW() THEN 'ONGOING'::"EventStatus"
  ELSE 'UPCOMING'::"EventStatus"
END;
