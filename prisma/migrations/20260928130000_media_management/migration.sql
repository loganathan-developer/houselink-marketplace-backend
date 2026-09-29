CREATE TYPE "MediaPurpose" AS ENUM ('CATEGORY_IMAGE', 'BRAND_LOGO');

CREATE TABLE "Media" (
    "id" UUID NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Category" ADD COLUMN "imageMediaId" UUID;
ALTER TABLE "Brand" ADD COLUMN "logoMediaId" UUID;

CREATE UNIQUE INDEX "Media_storageKey_key" ON "Media"("storageKey");
CREATE INDEX "Media_purpose_idx" ON "Media"("purpose");
CREATE INDEX "Media_uploadedById_idx" ON "Media"("uploadedById");
CREATE INDEX "Category_imageMediaId_idx" ON "Category"("imageMediaId");
CREATE INDEX "Brand_logoMediaId_idx" ON "Brand"("logoMediaId");

ALTER TABLE "Media" ADD CONSTRAINT "Media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_logoMediaId_fkey" FOREIGN KEY ("logoMediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
