-- CreateEnum
CREATE TYPE "MemberPostMediaPostType" AS ENUM ('SOCIAL', 'SHOP');

-- CreateTable
CREATE TABLE "MemberPostMediaHistory" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "postId" INTEGER,
    "postType" "MemberPostMediaPostType" NOT NULL,
    "image" TEXT,
    "video" TEXT,
    "thumbnailUrl" TEXT,
    "videoDuration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberPostMediaHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberPostMediaHistory_memberId_postType_createdAt_idx" ON "MemberPostMediaHistory"("memberId", "postType", "createdAt");

-- AddForeignKey
ALTER TABLE "MemberPostMediaHistory" ADD CONSTRAINT "MemberPostMediaHistory_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPostMediaHistory" ADD CONSTRAINT "MemberPostMediaHistory_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
