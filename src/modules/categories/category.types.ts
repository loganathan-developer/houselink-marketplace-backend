import type { z } from "zod";
import type { Category } from "../../generated/prisma/client.js";
import type { adminListQuery, createCategoryBody, updateCategoryBody } from "./category.schema.js";

export type CategoryCreate = z.infer<typeof createCategoryBody>;
export type CategoryUpdate = z.infer<typeof updateCategoryBody>;
export type CategoryQuery = z.infer<typeof adminListQuery>;
export type CategoryNode = Category & { children: CategoryNode[] };
export type Breadcrumb = Pick<Category, "id" | "name" | "slug">;
