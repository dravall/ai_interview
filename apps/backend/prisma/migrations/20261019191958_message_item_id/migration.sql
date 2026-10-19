-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "itemId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_itemId_key" ON "Message"("itemId");
