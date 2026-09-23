import { Router } from "express";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { categoryParams, slugParams, publicListQuery, noQuery } from "./category.schema.js";
import { detail, list, tree } from "./category.controller.js";
import { categoryAttributes } from "../attributes/attribute.controller.js";

const router = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/", validateRequest({ query: publicListQuery }), list());
router.get("/tree", validateRequest({ query: noQuery }), tree);
router.get("/slug/:slug", validateRequest({ params: slugParams, query: noQuery }), detail());
router.get("/:categoryId/attributes", validateRequest({ params: categoryParams, query: noQuery }), categoryAttributes());
router.get("/:categoryId", validateRequest({ params: categoryParams, query: noQuery }), detail());
export default router;
