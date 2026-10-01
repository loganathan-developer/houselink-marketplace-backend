import { prisma } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import { HttpError } from "../../shared/errors/http-error.js";

const variantInclude = { inventory: true, product: { include: { brand: { select: { name: true } } } } } satisfies Prisma.ProductVariantInclude;

function availability(variant: Prisma.ProductVariantGetPayload<{ include: typeof variantInclude }>) {
  const product = variant.product;
  const available = variant.isActive && product.status === "PUBLISHED" && product.publishedAt !== null && product.publishedAt <= new Date();
  return { available, stock: available ? Math.max(0, variant.inventory?.quantity ?? 0) : 0 };
}

async function snapshot(tx: Prisma.TransactionClient, userId: string) {
  const cart = await tx.cart.findUnique({ where: { userId }, include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { variant: { include: variantInclude } } } } });
  let subtotal = new Prisma.Decimal(0);
  let itemCount = 0;
  const items = (cart?.items ?? []).map((item) => {
    const { variant } = item;
    const { product } = variant;
    const { available, stock } = availability(variant);
    const salePrice = product.salePrice !== null && product.salePrice.lessThan(product.basePrice) ? product.salePrice : null;
    const unitPrice = variant.price ?? salePrice ?? product.basePrice;
    const lineTotal = available ? unitPrice.mul(item.quantity) : new Prisma.Decimal(0);
    subtotal = subtotal.add(lineTotal);
    itemCount += item.quantity;
    return {
      id: item.id, variantId: variant.id, quantity: item.quantity, sku: variant.sku, size: variant.size, color: variant.color,
      product: { name: product.name, slug: product.slug, imageUrl: product.imageUrl, brand: product.brand.name },
      basePrice: Number(product.basePrice), salePrice: salePrice === null ? null : Number(salePrice), unitPrice: Number(unitPrice),
      lineTotal: Number(lineTotal), stock, available,
      warning: !available ? "This variant is no longer available." : stock === 0 ? "Out of stock." : item.quantity > stock ? `Only ${stock} available. Reduce the quantity.` : null,
    };
  });
  return { id: cart?.id ?? null, items, itemCount, subtotal: Number(subtotal), total: Number(subtotal), currency: "INR", hasWarnings: items.some((item) => item.warning !== null) };
}

export function getCart(userId: string) {
  return prisma.$transaction((tx) => snapshot(tx, userId), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function mutateCart(userId: string, action: "add" | "update" | "remove", input: { variantId?: string; itemId?: string; quantity?: number }) {
  return prisma.$transaction(async (tx) => {
    // Serialize mutations so simultaneous additions of one variant stay idempotent.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cart:${userId}`}, 0))`;
    let cart = await tx.cart.findUnique({ where: { userId } });
    if (!cart && action === "add") cart = await tx.cart.create({ data: { userId } });
    if (!cart) throw new HttpError(404, "CART_ITEM_NOT_FOUND", "Bag item not found.");
    const existing = action === "add"
      ? await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId! } } })
      : await tx.cartItem.findFirst({ where: { id: input.itemId!, cartId: cart.id } });
    if (action !== "add" && !existing) throw new HttpError(404, "CART_ITEM_NOT_FOUND", "Bag item not found.");
    if (action === "remove") {
      await tx.cartItem.delete({ where: { id: existing!.id } });
    } else {
      const variantId = action === "add" ? input.variantId! : existing!.variantId;
      await tx.$queryRaw`SELECT "id" FROM "ProductVariant" WHERE "id" = ${variantId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "Inventory" WHERE "variantId" = ${variantId}::uuid FOR SHARE`;
      const variant = await tx.productVariant.findUnique({ where: { id: variantId }, include: variantInclude });
      if (!variant) throw new HttpError(404, "VARIANT_NOT_FOUND", "Product variant not found.");
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${variant.productId}::uuid FOR SHARE`;
      const current = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId }, include: variantInclude });
      const { available, stock } = availability(current);
      if (!available) throw new HttpError(409, "VARIANT_UNAVAILABLE", "This product variant is no longer available.");
      if (stock === 0) throw new HttpError(409, "INSUFFICIENT_STOCK", "Out of stock for this variant.");
      if (action === "add" && existing) return snapshot(tx, userId);
      const quantity = input.quantity!;
      if (quantity < 1 || !Number.isSafeInteger(quantity)) throw new HttpError(400, "INVALID_QUANTITY", "Quantity must be at least 1.");
      if (quantity > stock) throw new HttpError(409, "INSUFFICIENT_STOCK", `Only ${stock} available for this variant.`);
      if (existing) await tx.cartItem.update({ where: { id: existing.id }, data: { quantity } });
      else await tx.cartItem.create({ data: { cartId: cart.id, variantId, quantity } });
    }
    await tx.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
    return snapshot(tx, userId);
  });
}
