-- CreateEnum
CREATE TYPE "ChannelCategory" AS ENUM ('SOCIAL', 'FITNESS');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('ONE_TO_ONE', 'GROUP');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChannelChatAction" AS ENUM ('REQUEST', 'CANCEL', 'ACCEPT', 'ARCHIVE', 'DISABLE');

-- CreateEnum
CREATE TYPE "ChannelMessageType" AS ENUM ('TEXT', 'PHOTOS', 'VIDEOS', 'AUDIO');

-- CreateTable
CREATE TABLE "Channel" (
    "id" SERIAL NOT NULL,
    "channelCategory" "ChannelCategory" NOT NULL DEFAULT 'SOCIAL',
    "channelType" "ChannelType" NOT NULL DEFAULT 'ONE_TO_ONE',
    "channelName" TEXT,
    "status" "ChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "memberPlanId" INTEGER,
    "proficientLevelId" INTEGER,
    "gender" "Gender",
    "bodyGoalType" "BodyGoalType",
    "channelImage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMessage" (
    "id" SERIAL NOT NULL,
    "channelId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "type" "ChannelMessageType" NOT NULL DEFAULT 'TEXT',
    "text" TEXT,
    "isDelete" BOOLEAN NOT NULL DEFAULT false,
    "parentMessageId" INTEGER,
    "seenMemberIds" JSONB,
    "mentionMemberIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelParticipant" (
    "id" SERIAL NOT NULL,
    "channelId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "chatAction" "ChannelChatAction" NOT NULL DEFAULT 'REQUEST',
    "lastMessageId" INTEGER,
    "lastSeenMessageId" INTEGER,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "addedByMemberId" INTEGER,
    "removedByMemberId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMessageAttachment" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "type" "ChannelMessageType" NOT NULL,
    "url" TEXT NOT NULL,
    "videoDuration" TEXT,
    "thumbnails" TEXT,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelMessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatReact" (
    "id" SERIAL NOT NULL,
    "react" TEXT NOT NULL,
    "reactCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatReact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMessageReact" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "reactId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelMessageReact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelParticipant_memberId_idx" ON "ChannelParticipant"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelParticipant_channelId_memberId_key" ON "ChannelParticipant"("channelId", "memberId");

-- CreateIndex
CREATE INDEX "ChannelMessage_channelId_createdAt_idx" ON "ChannelMessage"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelMessage_memberId_idx" ON "ChannelMessage"("memberId");

-- CreateIndex
CREATE INDEX "ChannelMessageAttachment_messageId_idx" ON "ChannelMessageAttachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatReact_reactCode_key" ON "ChatReact"("reactCode");

-- CreateIndex
CREATE INDEX "ChannelMessageReact_messageId_idx" ON "ChannelMessageReact"("messageId");

-- CreateIndex
CREATE INDEX "ChannelMessageReact_memberId_idx" ON "ChannelMessageReact"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMessageReact_messageId_memberId_reactId_key" ON "ChannelMessageReact"("messageId", "memberId", "reactId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_memberPlanId_fkey" FOREIGN KEY ("memberPlanId") REFERENCES "MemberPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_proficientLevelId_fkey" FOREIGN KEY ("proficientLevelId") REFERENCES "ProficientLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessage" ADD CONSTRAINT "ChannelMessage_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "ChannelMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelParticipant" ADD CONSTRAINT "ChannelParticipant_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelParticipant" ADD CONSTRAINT "ChannelParticipant_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelParticipant" ADD CONSTRAINT "ChannelParticipant_lastMessageId_fkey" FOREIGN KEY ("lastMessageId") REFERENCES "ChannelMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelParticipant" ADD CONSTRAINT "ChannelParticipant_lastSeenMessageId_fkey" FOREIGN KEY ("lastSeenMessageId") REFERENCES "ChannelMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelParticipant" ADD CONSTRAINT "ChannelParticipant_addedByMemberId_fkey" FOREIGN KEY ("addedByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelParticipant" ADD CONSTRAINT "ChannelParticipant_removedByMemberId_fkey" FOREIGN KEY ("removedByMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessageAttachment" ADD CONSTRAINT "ChannelMessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChannelMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessageReact" ADD CONSTRAINT "ChannelMessageReact_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChannelMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessageReact" ADD CONSTRAINT "ChannelMessageReact_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessageReact" ADD CONSTRAINT "ChannelMessageReact_reactId_fkey" FOREIGN KEY ("reactId") REFERENCES "ChatReact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
