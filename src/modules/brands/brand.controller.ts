import type { Request, Response } from "express";
import { approveBrand, brandDetail, createBrand, listBrands, rejectBrand, updateBrand } from "./brand.service.js";
import type { BrandCreate, BrandQuery, BrandUpdate } from "./brand.types.js";

export const list = (admin = false) => async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listBrands(res.locals.validated.query as BrandQuery, admin) });
};
export const detail = (admin = false) => async (_req: Request, res: Response) => {
  const params = res.locals.validated.params as { brandId?: string; slug?: string };
  const key = params.slug === undefined ? { id: params.brandId! } : { slug: params.slug };
  res.json({ success: true, data: { brand: await brandDetail(key, admin) } });
};
export async function create(_req: Request, res: Response) {
  res.status(201).json({ success: true, data: { brand: await createBrand(res.locals.validated.body as BrandCreate) } });
}
export async function update(_req: Request, res: Response) {
  res.json({ success: true, data: { brand: await updateBrand(res.locals.validated.params.brandId, res.locals.validated.body as BrandUpdate) } });
}
export async function approve(_req: Request, res: Response) {
  res.json({ success: true, data: { brand: await approveBrand(res.locals.validated.params.brandId) } });
}
export async function reject(_req: Request, res: Response) {
  res.json({ success: true, data: { brand: await rejectBrand(res.locals.validated.params.brandId, res.locals.validated.body.reason) } });
}
