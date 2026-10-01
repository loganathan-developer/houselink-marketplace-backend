import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client.js";

type Send = (path: string, cookie?: string, body?: unknown, method?: string) => Promise<Response>;
export function registerCartTests({ prisma, login, send, sendWithoutCsrf }: {
  prisma: PrismaClient; login: () => Promise<{ cookie: string; userId: string }>; send: Send; sendWithoutCsrf: Send;
}) {
  test("cart: authenticated CRUD, idempotent additions, stock limits, totals, ownership and availability", async () => {
    const buyer = await login();
    const other = await login();
    const suffix = randomUUID();
    const category = await prisma.category.create({ data: { name: "Cart test category", slug: `cart-${suffix}` } });
    const brand = await prisma.brand.create({ data: { name: `Cart test ${suffix}`, normalizedName: `cart-${suffix}`, slug: `cart-${suffix}`, status: "APPROVED", approvedAt: new Date() } });
    const product = await prisma.product.create({ data: { name: "Cart test product", slug: `cart-${suffix}`, categoryId: category.id, brandId: brand.id, basePrice: 100, salePrice: 75.25, status: "PUBLISHED", publishedAt: new Date(), variants: { create: [
      { sku: `CART-A-${suffix}`, size: "M", color: "Black", inventory: { create: { quantity: 5 } } },
      { sku: `CART-B-${suffix}`, size: "L", color: "White", price: 80.15, inventory: { create: { quantity: 3 } } },
    ] } }, include: { variants: { orderBy: { sku: "asc" } } } });
    const [first, second] = product.variants;
    const read = async () => (await (await send("/cart", buyer.cookie)).json()).data.cart;
    assert.equal((await send("/cart")).status, 401);
    assert.equal((await read()).itemCount, 0);
    assert.equal((await sendWithoutCsrf("/cart/items", buyer.cookie, { variantId: first.id, quantity: 1 }, "POST")).status, 403);
    for (const quantity of [0, -1, 1.5]) assert.equal((await send("/cart/items", buyer.cookie, { variantId: first.id, quantity })).status, 400);
    assert.equal((await send("/cart/items", buyer.cookie, { variantId: first.id, quantity: 1 })).status, 201);
    assert.equal((await send("/cart/items", buyer.cookie, { variantId: first.id, quantity: 1 })).status, 201);
    let cart = await read();
    assert.equal(cart.items.length, 1); assert.equal(cart.items[0].quantity, 1); assert.equal(cart.total, 75.25);
    assert.equal((await send("/cart/items", buyer.cookie, { variantId: second.id, quantity: 1 })).status, 201);
    cart = await read(); assert.equal(cart.items.length, 2); assert.equal(cart.itemCount, 2); assert.equal(cart.total, 155.4);
    const item = cart.items.find((entry: { variantId: string }) => entry.variantId === first.id);
    assert.equal((await send(`/cart/items/${item.id}`, other.cookie, { quantity: 1 }, "PATCH")).status, 404);
    assert.equal((await send(`/cart/items/${item.id}`, other.cookie, undefined, "DELETE")).status, 404);
    assert.equal((await send(`/cart/items/${item.id}`, buyer.cookie, { quantity: 3 }, "PATCH")).status, 200);
    assert.equal((await send(`/cart/items/${item.id}`, buyer.cookie, { quantity: 1 }, "PATCH")).status, 200);
    assert.equal((await send(`/cart/items/${item.id}`, buyer.cookie, { quantity: 6 }, "PATCH")).status, 409);
    assert.equal((await send("/cart/items", buyer.cookie, { variantId: first.id, quantity: 5 })).status, 201);
    assert.equal((await read()).items.find((entry: { variantId: string }) => entry.variantId === first.id).quantity, 1);
    await prisma.product.update({ where: { id: product.id }, data: { salePrice: 60.10 } });
    assert.equal((await read()).total, 140.25);
    const concurrent = await Promise.all([send("/cart/items", buyer.cookie, { variantId: first.id, quantity: 1 }), send("/cart/items", buyer.cookie, { variantId: first.id, quantity: 1 })]);
    assert(concurrent.every((response) => response.status === 201));
    cart = await read(); assert.equal(cart.items.find((entry: { variantId: string }) => entry.variantId === first.id).quantity, 1);
    assert.equal((await send(`/cart/items/${item.id}`, buyer.cookie, { quantity: 3 }, "PATCH")).status, 200);
    await prisma.inventory.update({ where: { variantId: first.id }, data: { quantity: 2 } });
    assert.equal((await read()).hasWarnings, true);
    assert.equal((await send(`/cart/items/${item.id}`, buyer.cookie, { quantity: 2 }, "PATCH")).status, 200);
    await prisma.inventory.update({ where: { variantId: first.id }, data: { quantity: 0 } });
    assert.equal((await send("/cart/items", buyer.cookie, { variantId: first.id, quantity: 1 })).status, 409);
    assert.match((await read()).items.find((entry: { variantId: string }) => entry.variantId === first.id).warning, /Out of stock/);
    await prisma.productVariant.update({ where: { id: second.id }, data: { isActive: false } });
    cart = await read(); const unavailable = cart.items.find((entry: { variantId: string }) => entry.variantId === second.id);
    assert.equal(unavailable.available, false); assert.equal(unavailable.lineTotal, 0);
    assert.equal((await send("/cart/items", buyer.cookie, { variantId: second.id, quantity: 1 })).status, 409);
    for (const entry of cart.items) assert.equal((await send(`/cart/items/${entry.id}`, buyer.cookie, undefined, "DELETE")).status, 200);
    cart = await read(); assert.equal(cart.items.length, 0); assert.equal(cart.itemCount, 0); assert.equal(cart.total, 0);
    assert.equal(await prisma.cart.count({ where: { userId: buyer.userId } }), 1);
  });

  test("cart: simultaneous first additions create one item without increasing its quantity", async () => {
    const buyer = await login();
    const suffix = randomUUID();
    const category = await prisma.category.create({ data: { name: "Concurrent cart", slug: `concurrent-${suffix}` } });
    const brand = await prisma.brand.create({ data: { name: suffix, normalizedName: suffix, slug: suffix, status: "APPROVED", approvedAt: new Date() } });
    const product = await prisma.product.create({ data: { name: "Concurrent product", slug: suffix, categoryId: category.id, brandId: brand.id, basePrice: 100, status: "PUBLISHED", publishedAt: new Date(), variants: { create: { sku: suffix, inventory: { create: { quantity: 5 } } } } }, include: { variants: true } });
    const responses = await Promise.all([1, 2].map(() => send("/cart/items", buyer.cookie, { variantId: product.variants[0].id, quantity: 2 })));
    assert(responses.every((response) => response.status === 201));
    const cart = (await (await send("/cart", buyer.cookie)).json()).data.cart;
    assert.equal(cart.items.length, 1); assert.equal(cart.items[0].quantity, 2); assert.equal(cart.itemCount, 2);
  });
}
