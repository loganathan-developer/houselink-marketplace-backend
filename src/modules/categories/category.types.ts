import type { z } from "zod";
import type { Category } from "../../generated/prisma/client.js";
import type { publicListQuery } from "./category.schema.js";

export type CategoryQuery = z.infer<typeof publicListQuery>;
export type CategoryNode = Category & { children: CategoryNode[] };
export type Breadcrumb = Pick<Category, "id" | "name" | "slug">;
