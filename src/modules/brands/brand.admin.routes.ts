import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { approve, create, detail, list, reject, update } from "./brand.controller.js";
import { adminListQuery, brandParams, createBrandBody, emptyBody, noQuery, rejectBrandBody, updateBrandBody } from "./brand.schema.js";

const router = Router();
router.use(authenticate, requireRole("ADMIN"));
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/", validateRequest({ query: adminListQuery }), list(true));
router.get("/:brandId", validateRequest({ params: brandParams, query: noQuery }), detail(true));
router.post("/", validateRequest({ body: createBrandBody, query: noQuery }), create);
router.patch("/:brandId", validateRequest({ params: brandParams, body: updateBrandBody, query: noQuery }), update);
router.patch("/:brandId/approve", validateRequest({ params: brandParams, body: emptyBody, query: noQuery }), approve);
router.patch("/:brandId/reject", validateRequest({ params: brandParams, body: rejectBrandBody, query: noQuery }), reject);
export default router;
