-- REVIEW PROPOSAL ONLY. The shared mobile-backend owner must choose the final
-- migration folder/timestamp and apply this once through its normal process.
-- It consolidates the Admin-local prototype and its timestamp fixes. It has
-- no local test-clock hook and must not be applied to an unreviewed database.

CREATE TYPE "AttendanceSource" AS ENUM ('LEGACY', 'QR', 'MANUAL');
CREATE TYPE "AttendanceQrCredentialStatus" AS ENUM ('ACTIVE', 'REPLACED', 'REVOKED');

-- Do not infer origins from qrToken or createdById. Existing history remains
-- readable and deterministically becomes LEGACY.
ALTER TABLE "Attendance" ADD COLUMN "source" "AttendanceSource";
UPDATE "Attendance" SET "source" = 'LEGACY' WHERE "source" IS NULL;
ALTER TABLE "Attendance"
  ALTER COLUMN "source" SET DEFAULT 'LEGACY',
  ALTER COLUMN "source" SET NOT NULL;

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
  ON "AttendanceQrCredential" ("payloadFingerprint");

-- PostgreSQL partial indexes are not expressible as a standard Prisma @unique.
-- It prevents races while retaining revoked/replaced audit rows.
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

-- The reference schema uses TIMESTAMP(3) WITHOUT TIME ZONE. Store a UTC-naive
-- value consistently, then attach UTC before deriving the Yangon legacy date.
CREATE OR REPLACE FUNCTION "attendance_enforce_rolling_window"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Namespace 807421 is reserved for Attendance. memberId is the positive
  -- existing Int primary key, yielding a collision-safe two-int lock pair.
  PERFORM pg_advisory_xact_lock(807421, NEW."memberId");

  -- This overwrites caller time/date after lock acquisition. clock_timestamp()
  -- is required: now() is transaction-start time rather than event time.
  NEW."createdAt" := timezone('UTC', clock_timestamp());
  NEW."updatedAt" := NEW."createdAt";
  NEW."date" := to_char(
    (NEW."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Yangon',
    'YYYY-MM-DD'
  );

  -- Strict bounds deliberately permit exactly 60:00.000. Existing close
  -- LEGACY rows are not rewritten/deleted; only future insertions are blocked.
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

DROP TRIGGER IF EXISTS "attendance_enforce_rolling_window_trigger" ON "Attendance";
CREATE TRIGGER "attendance_enforce_rolling_window_trigger"
BEFORE INSERT ON "Attendance"
FOR EACH ROW
EXECUTE FUNCTION "attendance_enforce_rolling_window"();

-- Rollback policy: application rollback is preferred. Do not issue an
-- automatic destructive down migration: source/credential audit data and
-- shared duplicate protection must remain until an owner approves a plan.
