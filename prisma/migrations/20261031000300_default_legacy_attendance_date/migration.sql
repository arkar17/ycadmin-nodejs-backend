-- PROVISIONAL LOCAL-ONLY FOLLOW-UP.
-- The rolling-window trigger is the sole writer of legacy Attendance.date for new records.
-- A database default lets ORM writers omit this compatibility column safely.
ALTER TABLE "Attendance" ALTER COLUMN "date" SET DEFAULT '';
