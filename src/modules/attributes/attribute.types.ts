import type { z } from "zod";
import type { createAttributeBody, createMappingBody, createValueBody, listQuery, updateAttributeBody, updateMappingBody, updateValueBody } from "./attribute.schema.js";

export type AttributeListQuery = z.infer<typeof listQuery>;
export type AttributeCreate = z.infer<typeof createAttributeBody>;
export type AttributeUpdate = z.infer<typeof updateAttributeBody>;
export type AttributeValueCreate = z.infer<typeof createValueBody>;
export type AttributeValueUpdate = z.infer<typeof updateValueBody>;
export type CategoryAttributeCreate = z.infer<typeof createMappingBody>;
export type CategoryAttributeUpdate = z.infer<typeof updateMappingBody>;
