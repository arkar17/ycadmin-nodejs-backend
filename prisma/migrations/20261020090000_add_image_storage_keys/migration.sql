-- Keep original image URLs for backward compatibility and store the object key
-- separately for the image resizing service.
ALTER TABLE "MemberProfile"
ADD COLUMN "profilePhotoKey" TEXT,
ADD COLUMN "coverPhotoKey" TEXT;

ALTER TABLE "Channel"
ADD COLUMN "channelImageKey" TEXT;

-- Backfill keys for existing DigitalOcean Spaces and local-upload URLs.
UPDATE "MemberProfile"
SET "profilePhotoKey" = CASE
  WHEN "profilePhoto" ~ '^https?://[^/]+/yc-fitness-uat/'
    THEN regexp_replace("profilePhoto", '^https?://[^/]+/yc-fitness-uat/', '')
  WHEN "profilePhoto" ~ '^https?://[^/]+/public/uploads/'
    THEN regexp_replace("profilePhoto", '^https?://[^/]+/public/uploads/', '')
  ELSE NULL
END
WHERE "profilePhoto" IS NOT NULL;

UPDATE "MemberProfile"
SET "coverPhotoKey" = CASE
  WHEN "coverPhoto" ~ '^https?://[^/]+/yc-fitness-uat/'
    THEN regexp_replace("coverPhoto", '^https?://[^/]+/yc-fitness-uat/', '')
  WHEN "coverPhoto" ~ '^https?://[^/]+/public/uploads/'
    THEN regexp_replace("coverPhoto", '^https?://[^/]+/public/uploads/', '')
  ELSE NULL
END
WHERE "coverPhoto" IS NOT NULL;

UPDATE "Channel"
SET "channelImageKey" = CASE
  WHEN "channelImage" ~ '^https?://[^/]+/yc-fitness-uat/'
    THEN regexp_replace("channelImage", '^https?://[^/]+/yc-fitness-uat/', '')
  WHEN "channelImage" ~ '^https?://[^/]+/public/uploads/'
    THEN regexp_replace("channelImage", '^https?://[^/]+/public/uploads/', '')
  ELSE NULL
END
WHERE "channelImage" IS NOT NULL;
