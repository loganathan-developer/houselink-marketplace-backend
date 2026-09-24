import { z } from "zod";

export const normalizeBrandName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
export const displayBrandName = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ");
export const slugFromName = (value: string) => displayBrandName(value).toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .replace(/-{2,}/g, "-");

const slug = z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const integerQuery = (max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(max));
const booleanQuery = z.enum(["true", "false"]).transform(value => value === "true");
const name = z.string().transform(displayBrandName).pipe(z.string().min(1).max(120)).refine(value => normalizeBrandName(value).length <= 120);
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const logoUrl = z.url({ protocol: /^https?$/ }).max(2048).nullable().optional();

export const brandParams = z.strictObject({ brandId: z.uuid() });
export const slugParams = z.strictObject({ slug });
export const noQuery = z.strictObject({});
export const emptyBody = z.strictObject({}).optional();
export const rejectBrandBody = z.strictObject({ reason: z.string().trim().min(1).max(1000) });
export const publicListQuery = z.strictObject({
  page: integerQuery(1000000).default(1),
  limit: integerQuery(100).default(20),
  q: z.string().trim().max(120).optional(),
});
export const adminListQuery = publicListQuery.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  isActive: booleanQuery.optional(),
});
export const createBrandBody = z.strictObject({
  name,
  slug: slug.optional(),
  description: nullableText(2000),
  logoUrl,
  status: z.enum(["PENDING", "APPROVED"]).optional(),
  isActive: z.boolean().optional(),
});
export const updateBrandBody = z.strictObject({
  name: name.optional(),
  slug: slug.optional(),
  description: nullableText(2000),
  logoUrl,
  isActive: z.boolean().optional(),
}).refine(value => Object.keys(value).length > 0, "Provide at least one field");
