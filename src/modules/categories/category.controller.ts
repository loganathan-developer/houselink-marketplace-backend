import type { Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { categoryDetail, categoryTree, listCategories, saveCategory } from "./category.service.js";
import type { CategoryQuery, CategoryCreate, CategoryUpdate } from "./category.types.js";

export const list = (admin = false) => async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listCategories(res.locals.validated.query as CategoryQuery, admin) });
};
export async function tree(_req: Request, res: Response) {
  res.json({ success: true, data: { categories: await categoryTree() } });
}
export const detail = (admin = false) => async (_req: Request, res: Response) => {
  const params = res.locals.validated.params as { categoryId?: string; slug?: string };
  const key = params.slug === undefined ? { id: params.categoryId! } : { slug: params.slug };
  res.json({ success: true, data: { category: await categoryDetail(key, admin) } });
};
export async function create(req: Request, res: Response) {
  const category = await saveCategory(res.locals.validated.body as CategoryCreate);
  logger.info({ event: "category_created", requestId: res.locals.requestId, userId: req.auth!.userId, categoryId: category.id }, "Category created");
  res.status(201).json({ success: true, data: { category } });
}
export async function update(req: Request, res: Response) {
  const category = await saveCategory(res.locals.validated.body as CategoryUpdate, res.locals.validated.params.categoryId);
  logger.info({ event: "category_updated", requestId: res.locals.requestId, userId: req.auth!.userId, categoryId: category.id }, "Category updated");
  res.json({ success: true, data: { category } });
}
