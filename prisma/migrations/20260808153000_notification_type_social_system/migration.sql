-- Rename NOTIFICATION -> SOCIAL and add SYSTEM
ALTER TYPE "NotificationType" RENAME VALUE 'NOTIFICATION' TO 'SOCIAL';
ALTER TYPE "NotificationType" ADD VALUE 'SYSTEM';

-- Update column default
ALTER TABLE "Notification" ALTER COLUMN "type" SET DEFAULT 'SOCIAL'::"NotificationType";
