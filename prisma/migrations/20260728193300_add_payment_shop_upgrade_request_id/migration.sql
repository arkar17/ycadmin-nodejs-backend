-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "shopUpgradeRequestId" INTEGER;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shopUpgradeRequestId_fkey" FOREIGN KEY ("shopUpgradeRequestId") REFERENCES "ShopUpgradeRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
