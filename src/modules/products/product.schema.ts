import { z } from "zod";

const integer = (max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(max));

export const productListQuery = z.strictObject({
  collection: z.enum(["new-arrivals", "sale"]).optional(),
  category: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  department: z.enum(["men", "women", "kids", "beauty", "footwear", "accessories"]).optional(),
  page: integer(1000000).default(1),
  limit: integer(100).default(20),
});

export type ProductListQuery = z.infer<typeof productListQuery>;
