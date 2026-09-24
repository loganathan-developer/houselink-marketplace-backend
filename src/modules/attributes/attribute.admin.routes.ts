import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { adminCreateAttribute, adminCreateValue, adminListAttributes, adminUpdateAttribute, adminUpdateValue } from "./attribute.controller.js";
import { attributeParams, attributeValueParams, createAttributeBody, createValueBody, listQuery, noQuery, updateAttributeBody, updateValueBody } from "./attribute.schema.js";

const router = Router();
router.use(authenticate, requireRole("ADMIN"));
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/", validateRequest({ query: listQuery }), adminListAttributes);
router.post("/", validateRequest({ body: createAttributeBody, query: noQuery }), adminCreateAttribute);
router.patch("/:attributeId", validateRequest({ params: attributeParams, body: updateAttributeBody, query: noQuery }), adminUpdateAttribute);
router.post("/:attributeId/values", validateRequest({ params: attributeParams, body: createValueBody, query: noQuery }), adminCreateValue);
router.patch("/:attributeId/values/:valueId", validateRequest({ params: attributeValueParams, body: updateValueBody, query: noQuery }), adminUpdateValue);
export default router;
