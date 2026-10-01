import { Router } from "express";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { getProductBySlug, listProducts } from "./product.service.js";
import { z } from "zod";
import { productListQuery, type ProductListQuery } from "./product.schema.js";

const router = Router();
router.get("/", validateRequest({ query: productListQuery }), async (_req, res) => {
  res.json({ success: true, data: await listProducts(res.locals.validated.query as ProductListQuery) });
});
router.get("/:slug", validateRequest({ params: z.strictObject({ slug: z.string().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }) }), async (_req, res) => {
  res.json({ success: true, data: { product: await getProductBySlug(res.locals.validated.params.slug) } });
});
export default router;
