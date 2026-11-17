-- Migrate PaymentStatus to ACCEPT | DECLINE

CREATE TYPE "PaymentStatus_new" AS ENUM ('ACCEPT', 'DECLINE');

ALTER TABLE "Payment" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Payment"
  ALTER COLUMN "status" TYPE "PaymentStatus_new"
  USING (
    CASE
      WHEN "status"::text IN ('CONFIRMED', 'PAID', 'DRAFT') THEN 'ACCEPT'::"PaymentStatus_new"
      WHEN "status"::text = 'CANCELLED' THEN 'DECLINE'::"PaymentStatus_new"
      ELSE 'ACCEPT'::"PaymentStatus_new"
    END
  );

DROP TYPE "PaymentStatus";

ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";

ALTER TABLE "Payment" ALTER COLUMN "status" SET DEFAULT 'ACCEPT'::"PaymentStatus";
