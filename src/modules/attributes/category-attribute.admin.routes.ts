import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { adminCreateMapping, adminDeleteMapping, adminUpdateMapping, categoryAttributes } from "./attribute.controller.js";
import { categoryAttributeParams, categoryParams, createMappingBody, noQuery, updateMappingBody } from "./attribute.schema.js";

const router = Router({ mergeParams: true });
router.use(authenticate, requireRole("ADMIN"));
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/", validateRequest({ params: categoryParams, query: noQuery }), categoryAttributes(true));
router.post("/", validateRequest({ params: categoryParams, body: createMappingBody, query: noQuery }), adminCreateMapping);
router.patch("/:attributeId", validateRequest({ params: categoryAttributeParams, body: updateMappingBody, query: noQuery }), adminUpdateMapping);
router.delete("/:attributeId", validateRequest({ params: categoryAttributeParams, query: noQuery }), adminDeleteMapping);
export default router;
