-- PROVISIONAL LOCAL-ONLY ATTENDANCE FOUNDATION.
-- This migration must be reviewed and re-authored by the shared mobile-backend owner
-- before it is ever considered for a shared environment.

CREATE TYPE "AttendanceSource" AS ENUM ('LEGACY', 'QR', 'MANUAL');
CREATE TYPE "AttendanceQrCredentialStatus" AS ENUM ('ACTIVE', 'REPLACED', 'REVOKED');

ALTER TABLE "Attendance"
  ADD COLUMN "source" "AttendanceSource" NOT NULL DEFAULT 'LEGACY';

CREATE TABLE "AttendanceQrCredential" (
  "id" SERIAL NOT NULL,
  "status" "AttendanceQrCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "payloadCiphertext" BYTEA NOT NULL,
  "payloadIv" BYTEA NOT NULL,
  "payloadAuthTag" BYTEA NOT NULL,
  "payloadFingerprint" BYTEA NOT NULL,
  "createdById" INTEGER NOT NULL,
  "replacedById" INTEGER,
  "revokedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "replacedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AttendanceQrCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceQrCredential_payloadFingerprint_key"
  ON "AttendanceQrCredential"("payloadFingerprint");
CREATE UNIQUE INDEX "AttendanceQrCredential_one_active_key"
  ON "AttendanceQrCredential" ((1))
  WHERE "status" = 'ACTIVE';

ALTER TABLE "AttendanceQrCredential"
  ADD CONSTRAINT "AttendanceQrCredential_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AttendanceQrCredential_replacedById_fkey"
  FOREIGN KEY ("replacedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AttendanceQrCredential_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "attendance_enforce_rolling_window"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  test_clock TEXT;
BEGIN
  -- 807421 is reserved for the attendance lock namespace. Member IDs are positive Int values.
  PERFORM pg_advisory_xact_lock(807421, NEW."memberId");

  -- The test hook can only apply to the exact isolated integration database.
  -- It is intentionally unreachable in production/staging databases.
  IF current_database() = 'yc_fitness_admin_integration' THEN
    test_clock := current_setting('yc.attendance_test_clock', true);
  END IF;

  NEW."createdAt" := COALESCE(NULLIF(test_clock, '')::timestamptz, clock_timestamp());
  NEW."date" := to_char(NEW."createdAt" AT TIME ZONE 'Asia/Yangon', 'YYYY-MM-DD');

  IF EXISTS (
    SELECT 1
    FROM "Attendance" AS existing
    WHERE existing."memberId" = NEW."memberId"
      AND existing."createdAt" > NEW."createdAt" - interval '60 minutes'
      AND existing."createdAt" < NEW."createdAt" + interval '60 minutes'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      CONSTRAINT = 'attendance_rolling_60m',
      MESSAGE = 'ATTENDANCE_RECENTLY_RECORDED';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "attendance_enforce_rolling_window_trigger"
BEFORE INSERT ON "Attendance"
FOR EACH ROW
EXECUTE FUNCTION "attendance_enforce_rolling_window"();
