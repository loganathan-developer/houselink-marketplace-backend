import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const code = z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
const sortOrder = z.number().int().min(0).max(2147483647);
const attributeType = z.enum(["SELECT", "MULTI_SELECT", "TEXT", "NUMBER", "BOOLEAN"]);

export const attributeParams = z.strictObject({ attributeId: z.uuid() });
export const attributeValueParams = z.strictObject({ attributeId: z.uuid(), valueId: z.uuid() });
export const categoryParams = z.strictObject({ categoryId: z.uuid() });
export const categoryAttributeParams = z.strictObject({ categoryId: z.uuid(), attributeId: z.uuid() });
export const listQuery = z.strictObject({
  page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(1000000)).default(1),
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(100)).default(20),
  isActive: z.enum(["true", "false"]).transform(value => value === "true").optional(),
});
export const createAttributeBody = z.strictObject({ name: text(120), code, type: attributeType, isActive: z.boolean().optional() });
export const updateAttributeBody = createAttributeBody.partial().refine(value => Object.keys(value).length > 0, "Provide at least one field");
export const createValueBody = z.strictObject({ value: code, label: text(120), sortOrder: sortOrder.default(0), isActive: z.boolean().optional() });
export const updateValueBody = createValueBody.partial().refine(value => Object.keys(value).length > 0, "Provide at least one field");
export const createMappingBody = z.strictObject({
  attributeId: z.uuid(),
  isRequired: z.boolean().default(false),
  isFilterable: z.boolean().default(true),
  isVariantOption: z.boolean().default(false),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().optional(),
});
export const updateMappingBody = z.strictObject({
  isRequired: z.boolean().optional(),
  isFilterable: z.boolean().optional(),
  isVariantOption: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
}).refine(value => Object.keys(value).length > 0, "Provide at least one field");
export const noQuery = z.strictObject({});
