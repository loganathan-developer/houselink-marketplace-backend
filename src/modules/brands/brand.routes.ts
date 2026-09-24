import { Router } from "express";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { detail, list } from "./brand.controller.js";
import { noQuery, publicListQuery, slugParams } from "./brand.schema.js";

const router = Router();
router.get("/", validateRequest({ query: publicListQuery }), list(false));
router.get("/slug/:slug", validateRequest({ params: slugParams, query: noQuery }), detail(false));
export default router;
