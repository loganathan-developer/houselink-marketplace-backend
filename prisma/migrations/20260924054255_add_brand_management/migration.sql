-- CreateEnum
CREATE TYPE "BrandStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Brand" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "normalizedName" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "logoUrl" VARCHAR(2048),
    "status" "BrandStatus" NOT NULL DEFAULT 'PENDING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rejectionReason" VARCHAR(1000),
    "approvedAt" TIMESTAMPTZ(3),
    "rejectedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Brand" ADD CONSTRAINT "Brand_review_state_check" CHECK (
    ("status" = 'PENDING' AND "approvedAt" IS NULL AND "rejectedAt" IS NULL AND "rejectionReason" IS NULL)
    OR ("status" = 'APPROVED' AND "approvedAt" IS NOT NULL AND "rejectedAt" IS NULL AND "rejectionReason" IS NULL)
    OR ("status" = 'REJECTED' AND "approvedAt" IS NULL AND "rejectedAt" IS NOT NULL AND length(btrim("rejectionReason")) > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_normalizedName_key" ON "Brand"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "Brand_status_isActive_name_id_idx" ON "Brand"("status", "isActive", "name", "id");
