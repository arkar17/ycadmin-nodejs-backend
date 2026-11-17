-- PROVISIONAL LOCAL-ONLY FOLLOW-UP.
-- Ensure direct/shared SQL writers satisfy the existing NOT NULL updatedAt column.

CREATE OR REPLACE FUNCTION "attendance_enforce_rolling_window"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  test_clock TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(807421, NEW."memberId");

  IF current_database() = 'yc_fitness_admin_integration' THEN
    test_clock := current_setting('yc.attendance_test_clock', true);
  END IF;

  NEW."createdAt" := COALESCE(NULLIF(test_clock, '')::timestamptz, clock_timestamp());
  NEW."updatedAt" := NEW."createdAt";
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
