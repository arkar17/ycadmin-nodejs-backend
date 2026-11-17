-- Clear unused stub notification rows before reshaping the table
DELETE FROM "Notification";

-- AlterTable Notification for Odoo-style yc.notification fields
ALTER TABLE "Notification" DROP COLUMN "title",
DROP COLUMN "type",
DROP COLUMN "status",
ADD COLUMN "createUidId" INTEGER,
ADD COLUMN "toUserId" INTEGER NOT NULL,
ADD COLUMN "model" TEXT,
ADD COLUMN "resId" INTEGER,
ADD COLUMN "isTrainerChat" BOOLEAN;

-- DropEnum
DROP TYPE "NotificationType";

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_createUidId_fkey" FOREIGN KEY ("createUidId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
