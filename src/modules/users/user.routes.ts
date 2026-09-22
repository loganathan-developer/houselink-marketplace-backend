import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { prisma } from "../../config/database.js";
import { addressBody, addressParams, addressPatch, emptyBody, profileBody } from "./user.schema.js";
import { mutateAddress, profileSelect } from "./user.service.js";

const router = Router();
router.use(authenticate);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/me", async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: profileSelect });
  res.json({ success: true, data: { user } });
});
router.patch("/me", validateRequest({ body: profileBody }), async (req, res) => {
  const user = await prisma.user.update({ where: { id: req.auth!.userId }, data: res.locals.validated.body, select: profileSelect });
  res.json({ success: true, data: { user } });
});
router.get("/me/addresses", async (req, res) => {
  const addresses = await prisma.userAddress.findMany({ where: { userId: req.auth!.userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }, { id: "asc" }] });
  res.json({ success: true, data: { addresses } });
});
router.post("/me/addresses", validateRequest({ body: addressBody }), async (req, res) => {
  const address = await mutateAddress(req.auth!.userId, "create", undefined, res.locals.validated.body);
  res.status(201).json({ success: true, data: { address } });
});
router.patch("/me/addresses/:addressId", validateRequest({ params: addressParams, body: addressPatch }), async (req, res) => {
  const address = await mutateAddress(req.auth!.userId, "update", res.locals.validated.params.addressId, res.locals.validated.body);
  res.json({ success: true, data: { address } });
});
router.delete("/me/addresses/:addressId", validateRequest({ params: addressParams, body: emptyBody }), async (req, res) => {
  await mutateAddress(req.auth!.userId, "delete", res.locals.validated.params.addressId);
  res.status(204).end();
});
router.patch("/me/addresses/:addressId/default", validateRequest({ params: addressParams, body: emptyBody }), async (req, res) => {
  const address = await mutateAddress(req.auth!.userId, "default", res.locals.validated.params.addressId);
  res.json({ success: true, data: { address } });
});
export default router;
