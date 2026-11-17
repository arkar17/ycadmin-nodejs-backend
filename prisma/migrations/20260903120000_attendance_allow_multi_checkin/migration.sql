-- DropUnique
DROP INDEX IF EXISTS "Attendance_memberId_date_key";

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "qrToken" TEXT;

-- CreateIndex
CREATE INDEX "Attendance_memberId_createdAt_idx" ON "Attendance"("memberId", "createdAt");
