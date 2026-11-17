-- AlterTable
ALTER TABLE "MemberRequest" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "MemberRequest" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "MemberRequest" ADD COLUMN IF NOT EXISTS "countryCode" TEXT;

-- Drop separate contact table if it was already created
DROP TABLE IF EXISTS "MemberRequestContact";
