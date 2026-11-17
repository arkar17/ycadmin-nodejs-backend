-- CreateEnum
CREATE TYPE "memberProfilePhotoType" AS ENUM ('COVER', 'PROFILE');

-- CreateTable
CREATE TABLE "memberProfilePhoto" (
    "id" SERIAL NOT NULL,
    "memberProfileId" INTEGER NOT NULL,
    "photoUrl" TEXT,
    "photoType" "memberProfilePhotoType" NOT NULL DEFAULT 'PROFILE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberProfilePhoto_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "memberProfilePhoto" ADD CONSTRAINT "memberProfilePhoto_memberProfileId_fkey" FOREIGN KEY ("memberProfileId") REFERENCES "MemberProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
