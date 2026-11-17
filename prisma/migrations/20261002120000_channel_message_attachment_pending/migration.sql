-- AlterTable: pending attachments + media metadata
ALTER TABLE "ChannelMessageAttachment" ALTER COLUMN "messageId" DROP NOT NULL;
ALTER TABLE "ChannelMessageAttachment" ADD COLUMN "channelId" INTEGER;
ALTER TABLE "ChannelMessageAttachment" ADD COLUMN "memberId" INTEGER;
ALTER TABLE "ChannelMessageAttachment" ADD COLUMN "filename" TEXT;
ALTER TABLE "ChannelMessageAttachment" ADD COLUMN "mimetype" TEXT;
ALTER TABLE "ChannelMessageAttachment" ADD COLUMN "voiceMinutes" TEXT;

-- CreateIndex
CREATE INDEX "ChannelMessageAttachment_channelId_memberId_idx" ON "ChannelMessageAttachment"("channelId", "memberId");

-- AddForeignKey
ALTER TABLE "ChannelMessageAttachment" ADD CONSTRAINT "ChannelMessageAttachment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelMessageAttachment" ADD CONSTRAINT "ChannelMessageAttachment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
