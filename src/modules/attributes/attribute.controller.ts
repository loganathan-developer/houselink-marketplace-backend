import type { Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { createAttribute, createAttributeValue, createCategoryAttribute, deactivateCategoryAttribute, listAttributes, listCategoryAttributes, updateAttribute, updateAttributeValue, updateCategoryAttribute } from "./attribute.service.js";
import type { AttributeCreate, AttributeListQuery, AttributeUpdate, AttributeValueCreate, AttributeValueUpdate, CategoryAttributeCreate, CategoryAttributeUpdate } from "./attribute.types.js";

export async function adminListAttributes(_req: Request, res: Response) {
  res.json({ success: true, data: await listAttributes(res.locals.validated.query as AttributeListQuery) });
}
export async function adminCreateAttribute(req: Request, res: Response) {
  const attribute = await createAttribute(res.locals.validated.body as AttributeCreate);
  logger.info({ event: "attribute_created", requestId: res.locals.requestId, userId: req.auth!.userId, attributeId: attribute.id }, "Attribute created");
  res.status(201).json({ success: true, data: { attribute } });
}
export async function adminUpdateAttribute(req: Request, res: Response) {
  const attribute = await updateAttribute(res.locals.validated.params.attributeId, res.locals.validated.body as AttributeUpdate);
  logger.info({ event: "attribute_updated", requestId: res.locals.requestId, userId: req.auth!.userId, attributeId: attribute.id }, "Attribute updated");
  res.json({ success: true, data: { attribute } });
}
export async function adminCreateValue(req: Request, res: Response) {
  const value = await createAttributeValue(res.locals.validated.params.attributeId, res.locals.validated.body as AttributeValueCreate);
  logger.info({ event: "attribute_value_created", requestId: res.locals.requestId, userId: req.auth!.userId, attributeValueId: value.id }, "Attribute value created");
  res.status(201).json({ success: true, data: { value } });
}
export async function adminUpdateValue(req: Request, res: Response) {
  const value = await updateAttributeValue(res.locals.validated.params.attributeId, res.locals.validated.params.valueId, res.locals.validated.body as AttributeValueUpdate);
  logger.info({ event: "attribute_value_updated", requestId: res.locals.requestId, userId: req.auth!.userId, attributeValueId: value.id }, "Attribute value updated");
  res.json({ success: true, data: { value } });
}
export const categoryAttributes = (admin = false) => async (_req: Request, res: Response) => {
  res.json({ success: true, data: await listCategoryAttributes(res.locals.validated.params.categoryId, admin) });
};
export async function adminCreateMapping(req: Request, res: Response) {
  const mapping = await createCategoryAttribute(res.locals.validated.params.categoryId, res.locals.validated.body as CategoryAttributeCreate);
  logger.info({ event: "category_attribute_created", requestId: res.locals.requestId, userId: req.auth!.userId, categoryId: mapping.categoryId, attributeId: mapping.attributeId }, "Category attribute mapped");
  res.status(201).json({ success: true, data: { mapping } });
}
export async function adminUpdateMapping(req: Request, res: Response) {
  const mapping = await updateCategoryAttribute(res.locals.validated.params.categoryId, res.locals.validated.params.attributeId, res.locals.validated.body as CategoryAttributeUpdate);
  logger.info({ event: "category_attribute_updated", requestId: res.locals.requestId, userId: req.auth!.userId, categoryId: mapping.categoryId, attributeId: mapping.attributeId }, "Category attribute updated");
  res.json({ success: true, data: { mapping } });
}
export async function adminDeleteMapping(req: Request, res: Response) {
  const { categoryId, attributeId } = res.locals.validated.params;
  await deactivateCategoryAttribute(categoryId, attributeId);
  logger.info({ event: "category_attribute_deactivated", requestId: res.locals.requestId, userId: req.auth!.userId, categoryId, attributeId }, "Category attribute unmapped");
  res.status(204).send();
}
