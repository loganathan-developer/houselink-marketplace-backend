import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.middleware.js";
import { validateRequest } from "../../middleware/validate.middleware.js";
import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../../shared/errors/http-error.js";

const router = Router();
router.use(authenticate, requireRole("BUYER"), (req, res, next) => {
  if (req.auth!.context !== "CUSTOMER") throw new HttpError(403, "FORBIDDEN", "Buyer session required.");
  res.setHeader("Cache-Control", "no-store");
  next();
});

async function snapshot(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.wishlistItem.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], include: { product: { include: { brand: { select: { name: true } } } } } });
  const items = rows.map(({ id, product }) => ({
    id, productId: product.id,
    available: product.status === "PUBLISHED" && product.publishedAt !== null && product.publishedAt <= new Date(),
    product: { id: product.id, name: product.name, slug: product.slug, imageUrl: product.imageUrl, brand: product.brand.name, basePrice: Number(product.basePrice), salePrice: product.salePrice !== null && product.salePrice.lessThan(product.basePrice) ? Number(product.salePrice) : null },
  }));
  return { items, count: items.length };
}

router.get("/", async (req, res) => {
  const wishlist = await prisma.$transaction((tx) => snapshot(tx, req.auth!.userId), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  res.json({ success: true, data: { wishlist } });
});

async function mutate(userId: string, productId: string, remove: boolean) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wishlist:${userId}`}, 0))`;
    if (remove) {
      await tx.wishlistItem.deleteMany({ where: { userId, productId } });
    } else {
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId}::uuid FOR SHARE`;
      const product = await tx.product.findFirst({ where: { id: productId, status: "PUBLISHED", publishedAt: { lte: new Date() } }, select: { id: true } });
      if (!product) throw new HttpError(404, "PRODUCT_NOT_FOUND", "This product is no longer available.");
      await tx.wishlistItem.upsert({ where: { userId_productId: { userId, productId } }, create: { userId, productId }, update: {} });
    }
    return snapshot(tx, userId);
  });
}

router.post("/items", validateRequest({ body: z.strictObject({ productId: z.uuid() }) }), async (req, res) => {
  const wishlist = await mutate(req.auth!.userId, res.locals.validated.body.productId, false);
  res.status(201).json({ success: true, data: { wishlist } });
});
router.delete("/items/:productId", validateRequest({ params: z.strictObject({ productId: z.uuid() }) }), async (req, res) => {
  const wishlist = await mutate(req.auth!.userId, res.locals.validated.params.productId, true);
  res.json({ success: true, data: { wishlist } });
});

export default router;
