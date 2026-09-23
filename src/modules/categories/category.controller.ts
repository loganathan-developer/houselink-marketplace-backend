import type { Request, Response } from "express";
import { categoryDetail, categoryTree, listCategories } from "./category.service.js";
import type { CategoryQuery } from "./category.types.js";

export const list = () => async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listCategories(res.locals.validated.query as CategoryQuery) });
};
export async function tree(_req: Request, res: Response) {
  res.json({ success: true, data: { categories: await categoryTree() } });
}
export const detail = () => async (_req: Request, res: Response) => {
  const params = res.locals.validated.params as { categoryId?: string; slug?: string };
  const key = params.slug === undefined ? { id: params.categoryId! } : { slug: params.slug };
  res.json({ success: true, data: { category: await categoryDetail(key) } });
};
