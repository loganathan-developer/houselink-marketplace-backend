import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client.js";

type Login = { cookie: string };
type Send = (path: string, cookie?: string, body?: unknown, method?: string) => Promise<Response>;

export function registerBrandTests(deps: {
  prisma: PrismaClient;
  login: () => Promise<Login>;
  send: Send;
  sendWithoutCsrf: Send;
}) {
  const { prisma, send } = deps;
  const scenario = (name: string, run: () => Promise<void>) => test(`brands: ${name}`, async () => {
    await prisma.brand.deleteMany();
    await run();
  });
  const accountFixture = async (roleCode: "ADMIN" | "SELLER", context: "STAFF" | "CUSTOMER" = "STAFF", mfa = true) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await prisma.user.create({ data: { roles: { create: { roleId: role.id } } } });
    const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
    const session = await prisma.authSession.create({ data: { userId: user.id, context, mfaVerifiedAt: mfa ? now : null, lastSeenAt: now, idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt } });
    const { signAccessToken } = await import("../src/modules/auth/token.service.js");
    return { userId: user.id, sessionId: session.id, cookie: `access_token=${await signAccessToken(user.id, session.id, expiresAt)}` };
  };

  scenario("admin protection rejects guests, sellers, customer admin sessions and missing CSRF", async () => {
    const admin = await accountFixture("ADMIN");
    const seller = await accountFixture("SELLER");
    const customerAdmin = await accountFixture("ADMIN", "CUSTOMER");
    assert.equal((await send("/admin/brands")).status, 401);
    assert.equal((await send("/admin/brands", seller.cookie)).status, 403);
    assert.equal((await send("/admin/brands", customerAdmin.cookie)).status, 403);
    assert.equal((await deps.sendWithoutCsrf("/admin/brands", admin.cookie, { name: "Nike" })).status, 403);
  });

  scenario("create normalizes names, detects duplicates and supports direct approval", async () => {
    const admin = await accountFixture("ADMIN");
    const created = await send("/admin/brands", admin.cookie, { name: "  NIKE   Air  " });
    assert.equal(created.status, 201, await created.clone().text());
    const brand = (await created.json()).data.brand;
    assert.equal(brand.name, "NIKE Air");
    assert.equal(brand.normalizedName, "nike air");
    assert.equal(brand.slug, "nike-air");
    assert.equal(brand.status, "PENDING");
    assert.equal((await send("/admin/brands", admin.cookie, { name: "nike air" })).status, 409);
    assert.equal((await send("/admin/brands", admin.cookie, { name: "Other", slug: "nike-air" })).status, 409);
    const approved = await send("/admin/brands", admin.cookie, { name: "Adidas", status: "APPROVED", isActive: false });
    assert.equal(approved.status, 201);
    const approvedBrand = (await approved.json()).data.brand;
    assert.equal(approvedBrand.status, "APPROVED");
    assert(approvedBrand.approvedAt);
    assert.equal(approvedBrand.isActive, false);
    assert.equal((await send("/admin/brands", admin.cookie, { name: "Bad", status: "REJECTED" })).status, 400);
  });

  scenario("update preserves slug unless supplied and rejects protected or empty bodies", async () => {
    const admin = await accountFixture("ADMIN");
    const created = (await (await send("/admin/brands", admin.cookie, { name: "Puma Shoes" })).json()).data.brand;
    assert.equal((await send(`/admin/brands/${created.id}`, admin.cookie, {}, "PATCH")).status, 400);
    assert.equal((await send(`/admin/brands/${created.id}`, admin.cookie, { status: "APPROVED" }, "PATCH")).status, 400);
    const renamed = (await (await send(`/admin/brands/${created.id}`, admin.cookie, { name: "  PUMA  " }, "PATCH")).json()).data.brand;
    assert.equal(renamed.normalizedName, "puma");
    assert.equal(renamed.slug, "puma-shoes");
    const reslugged = (await (await send(`/admin/brands/${created.id}`, admin.cookie, { slug: "puma" }, "PATCH")).json()).data.brand;
    assert.equal(reslugged.slug, "puma");
    assert.equal((await send(`/admin/brands/${randomUUID()}`, admin.cookie, { name: "Missing" }, "PATCH")).status, 404);
    assert.equal((await send("/admin/brands/not-a-uuid", admin.cookie, { name: "Missing" }, "PATCH")).status, 400);
  });

  scenario("approval and rejection are atomic pending-only decisions", async () => {
    const admin = await accountFixture("ADMIN");
    const pending = (await (await send("/admin/brands", admin.cookie, { name: "Roadster", isActive: false })).json()).data.brand;
    const approved = (await (await send(`/admin/brands/${pending.id}/approve`, admin.cookie, {}, "PATCH")).json()).data.brand;
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.isActive, false);
    assert(approved.approvedAt);
    assert.equal(approved.rejectedAt, null);
    assert.equal((await send(`/admin/brands/${pending.id}/reject`, admin.cookie, { reason: "No" }, "PATCH")).status, 409);
    const rejectedTarget = (await (await send("/admin/brands", admin.cookie, { name: "H&M" })).json()).data.brand;
    assert.equal((await send(`/admin/brands/${rejectedTarget.id}/reject`, admin.cookie, { reason: "   " }, "PATCH")).status, 400);
    const rejected = (await (await send(`/admin/brands/${rejectedTarget.id}/reject`, admin.cookie, { reason: " Brand information could not be verified. " }, "PATCH")).json()).data.brand;
    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.rejectionReason, "Brand information could not be verified.");
    assert(rejected.rejectedAt);
    assert.equal(rejected.approvedAt, null);
    assert.equal((await send(`/admin/brands/${rejectedTarget.id}/approve`, admin.cookie, {}, "PATCH")).status, 409);
  });

  scenario("public visibility hides internal metadata and list filters are accurate", async () => {
    const admin = await accountFixture("ADMIN");
    const nike = (await (await send("/admin/brands", admin.cookie, { name: "Nike", status: "APPROVED" })).json()).data.brand;
    await send("/admin/brands", admin.cookie, { name: "Nike Kids", status: "APPROVED", isActive: false });
    const rejected = (await (await send("/admin/brands", admin.cookie, { name: "Puma" })).json()).data.brand;
    await send(`/admin/brands/${rejected.id}/reject`, admin.cookie, { reason: "No verified source" }, "PATCH");
    const listResponse = await send("/brands?q=nike&limit=1");
    assert.equal(listResponse.status, 200, await listResponse.clone().text());
    const list = (await listResponse.json()).data;
    assert.equal(list.pagination.total, 1);
    assert.equal(list.brands[0].id, nike.id);
    assert.equal("approvedAt" in list.brands[0], false);
    assert.equal("rejectionReason" in list.brands[0], false);
    assert.equal((await send(`/brands/slug/${nike.slug}`)).status, 200);
    assert.equal((await send("/brands/slug/puma")).status, 404);
    const adminList = (await (await send("/admin/brands?status=REJECTED&isActive=true", admin.cookie)).json()).data;
    assert.equal(adminList.pagination.total, 1);
    assert.equal(adminList.brands[0].name, "Puma");
    assert.equal((await send("/brands?isActive=false")).status, 400);
  });

  scenario("development seed is repeatable and preserves edited records", async () => {
    const { seedDevelopmentBrands } = await import("../prisma/seed-brands.js");
    await seedDevelopmentBrands();
    const before = await prisma.brand.count();
    await seedDevelopmentBrands();
    assert.equal(await prisma.brand.count(), before);
    const nike = await prisma.brand.findUniqueOrThrow({ where: { normalizedName: "nike" } });
    await prisma.brand.update({ where: { id: nike.id }, data: { name: "Nike Edited" } });
    await seedDevelopmentBrands();
    assert.equal((await prisma.brand.findUniqueOrThrow({ where: { normalizedName: "nike" } })).name, "Nike Edited");
  });
}
