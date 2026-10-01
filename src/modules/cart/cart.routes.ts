import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { HttpError } from "../../shared/errors/http-error.js";
import { getCart, mutateCart } from "./cart.service.js";

const router = Router();
const quantity = z.number().int().min(1).max(2147483647);
const params = z.strictObject({ id: z.uuid() });
router.use(authenticate, requireRole("BUYER"), (req, res, next) => {
  if (req.auth!.context !== "CUSTOMER") throw new HttpError(403, "FORBIDDEN", "Buyer session required.");
  res.setHeader("Cache-Control", "no-store");
  next();
});
router.get("/", async (req, res) => res.json({ success: true, data: { cart: await getCart(req.auth!.userId) } }));
router.post("/items", validateRequest({ body: z.strictObject({ variantId: z.uuid(), quantity }) }), async (req, res) => {
  res.status(201).json({ success: true, data: { cart: await mutateCart(req.auth!.userId, "add", res.locals.validated.body) } });
});
router.patch("/items/:id", validateRequest({ params, body: z.strictObject({ quantity }) }), async (req, res) => {
  res.json({ success: true, data: { cart: await mutateCart(req.auth!.userId, "update", { itemId: res.locals.validated.params.id, quantity: res.locals.validated.body.quantity }) } });
});
router.delete("/items/:id", validateRequest({ params }), async (req, res) => {
  res.json({ success: true, data: { cart: await mutateCart(req.auth!.userId, "remove", { itemId: res.locals.validated.params.id }) } });
});
export default router;
