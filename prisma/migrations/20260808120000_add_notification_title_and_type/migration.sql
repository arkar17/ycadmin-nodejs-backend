-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NOTIFICATION', 'ACTIVITY');

-- AlterTable: add title (nullable first for backfill) and type
ALTER TABLE "Notification"
ADD COLUMN "title" TEXT,
ADD COLUMN "type" "NotificationType" NOT NULL DEFAULT 'NOTIFICATION';

-- Backfill existing rows: title matches message, type is NOTIFICATION
UPDATE "Notification"
SET "title" = "message",
    "type" = 'NOTIFICATION'
WHERE "title" IS NULL;

-- Make title required
ALTER TABLE "Notification"
ALTER COLUMN "title" SET NOT NULL;
