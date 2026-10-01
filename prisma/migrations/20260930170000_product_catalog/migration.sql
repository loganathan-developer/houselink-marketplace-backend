CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "Product" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" VARCHAR(180) NOT NULL,
  "slug" VARCHAR(200) NOT NULL, "description" VARCHAR(3000), "categoryId" UUID NOT NULL,
  "brandId" UUID NOT NULL, "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
  "basePrice" DECIMAL(12,2) NOT NULL, "salePrice" DECIMAL(12,2), "imageUrl" VARCHAR(2048),
  "publishedAt" TIMESTAMPTZ(6), "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProductVariant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "productId" UUID NOT NULL, "sku" VARCHAR(100) NOT NULL,
  "size" VARCHAR(40), "color" VARCHAR(80), "price" DECIMAL(12,2), "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Inventory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "variantId" UUID NOT NULL, "quantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");
CREATE INDEX "Product_status_publishedAt_idx" ON "Product"("status", "publishedAt");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");
CREATE INDEX "Product_salePrice_idx" ON "Product"("salePrice");
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE INDEX "ProductVariant_productId_isActive_idx" ON "ProductVariant"("productId", "isActive");
CREATE UNIQUE INDEX "Inventory_variantId_key" ON "Inventory"("variantId");
CREATE INDEX "Inventory_quantity_idx" ON "Inventory"("quantity");
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
