import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client.js";

type Send = (path: string, cookie?: string, body?: unknown, method?: string) => Promise<Response>;
export function registerWishlistTests({ prisma, login, send, sendWithoutCsrf }: { prisma: PrismaClient; login: () => Promise<{ cookie: string; userId: string }>; send: Send; sendWithoutCsrf: Send }) {
  test("wishlist: real persisted products, duplicate safety, ownership, availability, validation and CSRF", async () => {
    const buyer = await login(), other = await login();
    const suffix = randomUUID();
    const category = await prisma.category.create({ data: { name: "Wishlist category", slug: `wishlist-${suffix}` } });
    const brand = await prisma.brand.create({ data: { name: suffix, normalizedName: suffix, slug: suffix, status: "APPROVED", approvedAt: new Date() } });
    const product = await prisma.product.create({ data: { name: "Wishlist product", slug: suffix, categoryId: category.id, brandId: brand.id, basePrice: 100, salePrice: 80, status: "PUBLISHED", publishedAt: new Date() } });
    const read = async (cookie = buyer.cookie) => (await (await send("/wishlist", cookie)).json()).data.wishlist;
    assert.equal((await send("/wishlist")).status, 401);
    assert.equal((await send("/wishlist/items", "", { productId: product.id })).status, 401);
    assert.equal((await sendWithoutCsrf("/wishlist/items", buyer.cookie, { productId: product.id })).status, 403);
    assert.equal((await send("/wishlist/items", buyer.cookie, { productId: "invalid" })).status, 400);
    assert.equal((await send("/wishlist/items", buyer.cookie, { productId: randomUUID() })).status, 404);
    assert.equal((await read()).count, 0);
    const responses = await Promise.all([1, 2].map(() => send("/wishlist/items", buyer.cookie, { productId: product.id })));
    assert(responses.every((response) => response.status === 201));
    let wishlist = await read();
    assert.equal(wishlist.count, 1); assert.equal(wishlist.items[0].product.name, product.name); assert.equal(wishlist.items[0].product.salePrice, 80);
    assert.equal(await prisma.wishlistItem.count({ where: { userId: buyer.userId, productId: product.id } }), 1);
    assert.equal((await read(other.cookie)).count, 0);
    assert.equal((await send(`/wishlist/items/${product.id}`, other.cookie, undefined, "DELETE")).status, 200);
    assert.equal((await read()).count, 1);
    await prisma.product.update({ where: { id: product.id }, data: { status: "ARCHIVED" } });
    wishlist = await read(); assert.equal(wishlist.items[0].available, false);
    assert.equal((await send("/wishlist/items", buyer.cookie, { productId: product.id })).status, 404);
    assert.equal((await send(`/wishlist/items/${product.id}`, buyer.cookie, undefined, "DELETE")).status, 200);
    assert.equal((await send(`/wishlist/items/${product.id}`, buyer.cookie, undefined, "DELETE")).status, 200);
    assert.equal((await read()).count, 0);
    await prisma.userRole.deleteMany({ where: { userId: buyer.userId } });
    assert.equal((await send("/wishlist", buyer.cookie)).status, 403);
  });
}
