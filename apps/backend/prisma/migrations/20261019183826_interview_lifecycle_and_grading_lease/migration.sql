-- AlterEnum
ALTER TYPE "InterviewStatus" ADD VALUE 'Ended';

-- AlterTable
ALTER TABLE "Interview" ADD COLUMN     "gradingAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gradingStartedAt" TIMESTAMP(3);
