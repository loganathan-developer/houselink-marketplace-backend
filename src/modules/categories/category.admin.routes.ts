import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { adminListQuery, categoryParams, createCategoryBody, updateCategoryBody, noQuery } from "./category.schema.js";
import { create, detail, list, update } from "./category.controller.js";

const router = Router();
router.use(authenticate, requireRole("ADMIN"));
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/", validateRequest({ query: adminListQuery }), list(true));
router.get("/:categoryId", validateRequest({ params: categoryParams, query: noQuery }), detail(true));
router.post("/", validateRequest({ body: createCategoryBody, query: noQuery }), create);
router.patch("/:categoryId", validateRequest({ params: categoryParams, body: updateCategoryBody, query: noQuery }), update);
export default router;
