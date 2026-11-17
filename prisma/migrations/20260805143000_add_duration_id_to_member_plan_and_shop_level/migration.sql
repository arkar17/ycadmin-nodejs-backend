-- Ensure PlanDuration.value is unique for FK lookups
CREATE UNIQUE INDEX IF NOT EXISTS "PlanDuration_value_key" ON "PlanDuration"("value");

-- Seed default plan durations if missing (needed for backfill)
INSERT INTO "PlanDuration" ("name", "value", "createdAt", "updatedAt")
SELECT v.name, v.value, NOW(), NOW()
FROM (
  VALUES
    ('1 Month', 1),
    ('2 Months', 2),
    ('3 Months', 3),
    ('6 Months', 6)
) AS v(name, value)
WHERE NOT EXISTS (
  SELECT 1 FROM "PlanDuration" pd WHERE pd.value = v.value
);

-- Add durationId columns
ALTER TABLE "MemberPlan" ADD COLUMN IF NOT EXISTS "durationId" INTEGER;
ALTER TABLE "ShopLevel" ADD COLUMN IF NOT EXISTS "durationId" INTEGER;

-- Backfill MemberPlan.durationId
-- duration may be months (3) or days (90 → 3 months)
UPDATE "MemberPlan" mp
SET "durationId" = pd.id
FROM "PlanDuration" pd
WHERE mp."durationId" IS NULL
  AND (
    mp.duration = pd.value
    OR (
      mp.duration >= 30
      AND mp.duration % 30 = 0
      AND (mp.duration / 30) = pd.value
    )
  );

-- Backfill ShopLevel.durationId (duration stored as months)
UPDATE "ShopLevel" sl
SET "durationId" = pd.id
FROM "PlanDuration" pd
WHERE sl."durationId" IS NULL
  AND (
    sl.duration = pd.value
    OR (
      sl.duration >= 30
      AND sl.duration % 30 = 0
      AND (sl.duration / 30) = pd.value
    )
  );

-- Add foreign keys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MemberPlan_durationId_fkey'
  ) THEN
    ALTER TABLE "MemberPlan"
      ADD CONSTRAINT "MemberPlan_durationId_fkey"
      FOREIGN KEY ("durationId") REFERENCES "PlanDuration"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ShopLevel_durationId_fkey'
  ) THEN
    ALTER TABLE "ShopLevel"
      ADD CONSTRAINT "ShopLevel_durationId_fkey"
      FOREIGN KEY ("durationId") REFERENCES "PlanDuration"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
