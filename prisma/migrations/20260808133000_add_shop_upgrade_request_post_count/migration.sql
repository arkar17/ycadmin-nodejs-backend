-- AlterTable
ALTER TABLE "ShopUpgradeRequest" ADD COLUMN "postCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill remaining posts for latest approved request per member:
-- max(0, ShopLevel.postLimit - current shop post count)
UPDATE "ShopUpgradeRequest" AS sur
SET "postCount" = GREATEST(
  0,
  COALESCE(sl."postLimit", 10) - COALESCE(
    (
      SELECT COUNT(*)::INT
      FROM "Post" p
      INNER JOIN "Shop" s ON s.id = p."shopId"
      WHERE s."memberId" = sur."memberId"
    ),
    0
  )
)
FROM "ShopLevel" sl
WHERE sur."shopLevelId" = sl.id
  AND sur.status = 'APPROVED'
  AND sur.id = (
    SELECT sur2.id
    FROM "ShopUpgradeRequest" sur2
    WHERE sur2."memberId" = sur."memberId"
      AND sur2.status = 'APPROVED'
    ORDER BY sur2."approvedAt" DESC NULLS LAST, sur2.id DESC
    LIMIT 1
  );

-- Seed Free allotment for shops that have no approved upgrade request yet
INSERT INTO "ShopUpgradeRequest" (
  "memberId",
  "shopLevelId",
  "postCount",
  "status",
  "approvedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  s."memberId",
  COALESCE(s."shopLevelId", free_level.id),
  GREATEST(
    0,
    COALESCE(sl."postLimit", free_level."postLimit", 10) - COALESCE(
      (
        SELECT COUNT(*)::INT
        FROM "Post" p
        WHERE p."shopId" = s.id
      ),
      0
    )
  ),
  'APPROVED',
  NOW(),
  NOW(),
  NOW()
FROM "Shop" s
CROSS JOIN LATERAL (
  SELECT id, "postLimit"
  FROM "ShopLevel"
  WHERE name = 'Free'
  LIMIT 1
) AS free_level
LEFT JOIN "ShopLevel" sl ON sl.id = COALESCE(s."shopLevelId", free_level.id)
WHERE s."memberId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "ShopUpgradeRequest" sur
    WHERE sur."memberId" = s."memberId"
      AND sur.status = 'APPROVED'
  );
