-- AlterEnum: convert FriendRequest.status from enum to nullable text
ALTER TABLE "FriendRequest" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "FriendRequest"
  ALTER COLUMN "status" TYPE TEXT
  USING (
    CASE "status"::text
      WHEN 'PENDING' THEN 'requesting'
      WHEN 'ACCEPTED' THEN 'done'
      WHEN 'DECLINED' THEN 'reject'
      ELSE "status"::text
    END
  );

ALTER TABLE "FriendRequest" ALTER COLUMN "status" DROP NOT NULL;

DROP TYPE "FriendRequestStatus";
