import type { Request, Response } from "express";
import { createAttribute, createAttributeValue, createCategoryAttribute, deactivateCategoryAttribute, listAttributes, listCategoryAttributes, updateAttribute, updateAttributeValue, updateCategoryAttribute } from "./attribute.service.js";

export const categoryAttributes = (admin = false) => async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listCategoryAttributes(res.locals.validated.params.categoryId, admin) });
};
export async function adminListAttributes(_req: Request, res: Response) {
  res.json({ success: true, data: await listAttributes(res.locals.validated.query) });
}
export async function adminCreateAttribute(_req: Request, res: Response) {
  res.status(201).json({ success: true, data: { attribute: await createAttribute(res.locals.validated.body) } });
}
export async function adminUpdateAttribute(_req: Request, res: Response) {
  res.json({ success: true, data: { attribute: await updateAttribute(res.locals.validated.params.attributeId, res.locals.validated.body) } });
}
export async function adminCreateValue(_req: Request, res: Response) {
  res.status(201).json({ success: true, data: { value: await createAttributeValue(res.locals.validated.params.attributeId, res.locals.validated.body) } });
}
export async function adminUpdateValue(_req: Request, res: Response) {
  res.json({ success: true, data: { value: await updateAttributeValue(res.locals.validated.params.attributeId, res.locals.validated.params.valueId, res.locals.validated.body) } });
}
export async function adminCreateMapping(_req: Request, res: Response) {
  res.status(201).json({ success: true, data: { mapping: await createCategoryAttribute(res.locals.validated.params.categoryId, res.locals.validated.body) } });
}
export async function adminUpdateMapping(_req: Request, res: Response) {
  res.json({ success: true, data: { mapping: await updateCategoryAttribute(res.locals.validated.params.categoryId, res.locals.validated.params.attributeId, res.locals.validated.body) } });
}
export async function adminDeleteMapping(_req: Request, res: Response) {
  await deactivateCategoryAttribute(res.locals.validated.params.categoryId, res.locals.validated.params.attributeId);
  res.status(204).send();
}
