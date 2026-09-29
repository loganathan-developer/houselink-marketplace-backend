import type { BrandStatus } from "../../generated/prisma/client.js";

export type BrandQuery = {
  page: number;
  limit: number;
  q?: string;
  status?: BrandStatus;
  isActive?: boolean;
};

export type BrandCreate = {
  name: string;
  slug?: string;
  description?: string | null;
  logoUrl?: string | null;
  logoMediaId?: string | null;
  status?: "PENDING" | "APPROVED";
  isActive?: boolean;
};

export type BrandUpdate = {
  name?: string;
  slug?: string;
  description?: string | null;
  logoUrl?: string | null;
  logoMediaId?: string | null;
  isActive?: boolean;
};
