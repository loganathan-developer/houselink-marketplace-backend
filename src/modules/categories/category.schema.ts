import { z } from "zod";

const slug = z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const fields = {
  name: z.string().trim().min(1).max(120),
  slug,
  description: z.string().trim().max(5000).nullable().optional(),
  imageUrl: z.url().max(2048).refine(value => URL.canParse(value) && new URL(value).protocol === "https:", "Use an HTTPS URL").nullable().optional(),
  parentId: z.uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(2147483647).optional(),
};
export const createCategoryBody = z.strictObject(fields);
export const updateCategoryBody = createCategoryBody.partial().refine(value => Object.keys(value).length > 0, "Provide at least one field");
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
const compatible = (value: { rootOnly?: boolean | undefined; parentId?: string | undefined }) => !(value.rootOnly && value.parentId);
export const publicListQuery = z.strictObject(queryFields).refine(compatible, "rootOnly=true conflicts with parentId");
export const adminListQuery = z.strictObject({ ...queryFields, isActive: booleanQuery.optional() }).refine(compatible, "rootOnly=true conflicts with parentId");
export const noQuery = z.strictObject({});
