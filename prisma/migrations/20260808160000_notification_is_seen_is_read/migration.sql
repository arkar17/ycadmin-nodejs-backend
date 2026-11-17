-- AlterTable
ALTER TABLE "Notification"
ADD COLUMN "isSeen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isRead" BOOLEAN NOT NULL DEFAULT false;

-- Existing notifications should not inflate badge/highlight after deploy
UPDATE "Notification"
SET "isSeen" = true,
    "isRead" = true;
