-- CreateEnum
CREATE TYPE "kyc_status" AS ENUM ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "kyc_submission_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "kyc_document_type" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'DRIVERS_LICENSE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "kyc_status" "kyc_status" NOT NULL DEFAULT 'NOT_STARTED';

-- CreateTable
CREATE TABLE "kyc_submissions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "country" TEXT NOT NULL,
    "document_type" "kyc_document_type" NOT NULL,
    "document_number" TEXT NOT NULL,
    "status" "kyc_submission_status" NOT NULL DEFAULT 'PENDING',
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "rejection_reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kyc_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kyc_submissions_user_id_idx" ON "kyc_submissions"("user_id");

-- CreateIndex
CREATE INDEX "kyc_submissions_status_createdAt_idx" ON "kyc_submissions"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

