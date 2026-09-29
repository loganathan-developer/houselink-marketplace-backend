import { z } from "zod";

const slug = z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const categoryParams = z.strictObject({ categoryId: z.uuid() });
export const slugParams = z.strictObject({ slug });
const integerQuery = (max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(max));
const booleanQuery = z.enum(["true", "false"]).transform(value => value === "true");
const queryFields = {
  page: integerQuery(1000000).default(1),
  limit: integerQuery(100).default(20),
  rootOnly: booleanQuery.optional(),
  parentId: z.uuid().optional(),
};
const categoryFields = {
  name: z.string().trim().min(1).max(120),
  slug,
  description: z.string().trim().max(500).nullable().optional(),
  imageUrl: z.url().nullable().optional(),
  imageMediaId: z.uuid().nullable().optional(),
  parentId: z.uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(2147483647).optional(),
  isActive: z.boolean().optional(),
};
const noImageConflict = (value: { imageUrl?: string | null | undefined; imageMediaId?: string | null | undefined }) =>
  !(Object.hasOwn(value, "imageUrl") && Object.hasOwn(value, "imageMediaId"));
const compatible = (value: { rootOnly?: boolean | undefined; parentId?: string | undefined }) => !(value.rootOnly && value.parentId);
export const publicListQuery = z.strictObject(queryFields).refine(compatible, "rootOnly=true conflicts with parentId");
export const adminListQuery = z.strictObject({ ...queryFields, isActive: booleanQuery.optional() }).refine(compatible, "rootOnly=true conflicts with parentId");
export const createCategoryBody = z.strictObject(categoryFields).refine(noImageConflict, "imageUrl conflicts with imageMediaId");
export const updateCategoryBody = z.strictObject({
  name: categoryFields.name.optional(),
  slug: categoryFields.slug.optional(),
  description: categoryFields.description,
  imageUrl: categoryFields.imageUrl,
  imageMediaId: categoryFields.imageMediaId,
  parentId: categoryFields.parentId,
  sortOrder: categoryFields.sortOrder,
  isActive: categoryFields.isActive,
}).refine(value => Object.keys(value).length > 0, "Provide at least one field")
  .refine(noImageConflict, "imageUrl conflicts with imageMediaId");
export const noQuery = z.strictObject({});
