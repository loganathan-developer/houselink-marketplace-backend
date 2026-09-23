CREATE TYPE "AttributeType" AS ENUM ('SELECT', 'MULTI_SELECT', 'TEXT', 'NUMBER', 'BOOLEAN');

CREATE TABLE "Attribute" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "type" "AttributeType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "Attribute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttributeValue" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "attributeId" UUID NOT NULL,
  "value" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "AttributeValue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CategoryAttribute" (
  "categoryId" UUID NOT NULL,
  "attributeId" UUID NOT NULL,
  "isRequired" BOOLEAN NOT NULL DEFAULT false,
  "isFilterable" BOOLEAN NOT NULL DEFAULT true,
  "isVariantOption" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "CategoryAttribute_pkey" PRIMARY KEY ("categoryId","attributeId")
);

CREATE UNIQUE INDEX "Attribute_code_key" ON "Attribute"("code");
CREATE UNIQUE INDEX "AttributeValue_attributeId_value_key" ON "AttributeValue"("attributeId", "value");
CREATE INDEX "Attribute_isActive_idx" ON "Attribute"("isActive");
CREATE INDEX "AttributeValue_attributeId_sortOrder_idx" ON "AttributeValue"("attributeId", "sortOrder");
CREATE INDEX "AttributeValue_isActive_idx" ON "AttributeValue"("isActive");
CREATE INDEX "CategoryAttribute_attributeId_idx" ON "CategoryAttribute"("attributeId");
CREATE INDEX "CategoryAttribute_categoryId_sortOrder_idx" ON "CategoryAttribute"("categoryId", "sortOrder");
CREATE INDEX "CategoryAttribute_isActive_idx" ON "CategoryAttribute"("isActive");

ALTER TABLE "AttributeValue" ADD CONSTRAINT "AttributeValue_attributeId_fkey"
  FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CategoryAttribute" ADD CONSTRAINT "CategoryAttribute_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CategoryAttribute" ADD CONSTRAINT "CategoryAttribute_attributeId_fkey"
  FOREIGN KEY ("attributeId") REFERENCES "Attribute"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
