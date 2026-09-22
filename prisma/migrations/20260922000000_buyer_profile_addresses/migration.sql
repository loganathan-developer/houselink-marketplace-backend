ALTER TABLE "User" ADD COLUMN "profileImage" TEXT;

CREATE TABLE "UserAddress" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "recipientName" TEXT NOT NULL,
  "contactPhone" TEXT NOT NULL,
  "addressLine1" TEXT NOT NULL,
  "addressLine2" TEXT,
  "city" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "postalCode" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "UserAddress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "UserAddress_userId_idx" ON "UserAddress"("userId");
-- Enforce the default invariant even for writers outside the API.
CREATE UNIQUE INDEX "UserAddress_one_default_per_user" ON "UserAddress"("userId") WHERE "isDefault" = true;
