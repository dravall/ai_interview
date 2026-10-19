-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "Interview_ownerId_idx" ON "Interview"("ownerId");

-- CreateIndex
CREATE INDEX "Message_interviewId_createdAt_idx" ON "Message"("interviewId", "createdAt");
