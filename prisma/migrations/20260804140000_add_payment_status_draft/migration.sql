-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'DRAFT';

-- New payments start as DRAFT until admin accepts/declines
ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"PaymentStatus";
