-- Clean orphaned media history left behind by SetNull on post delete
DELETE FROM "MemberPostMediaHistory"
WHERE "postId" IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM "Post" p WHERE p.id = "MemberPostMediaHistory"."postId"
   );

-- Recreate FK: deleting a Post also deletes its media history rows
ALTER TABLE "MemberPostMediaHistory" DROP CONSTRAINT IF EXISTS "MemberPostMediaHistory_postId_fkey";

ALTER TABLE "MemberPostMediaHistory"
  ADD CONSTRAINT "MemberPostMediaHistory_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "Post"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
