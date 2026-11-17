-- CreateTable
CREATE TABLE "ChannelMessageHidden" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMessageHidden_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMessageHidden_messageId_memberId_key" ON "ChannelMessageHidden"("messageId", "memberId");

-- CreateIndex
CREATE INDEX "ChannelMessageHidden_memberId_idx" ON "ChannelMessageHidden"("memberId");

-- AddForeignKey
ALTER TABLE "ChannelMessageHidden" ADD CONSTRAINT "ChannelMessageHidden_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChannelMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMessageHidden" ADD CONSTRAINT "ChannelMessageHidden_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
