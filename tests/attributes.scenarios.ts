import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client.js";

type Login = { cookie: string; userId: string };
type Send = (path: string, cookie?: string, body?: unknown, method?: string) => Promise<Response>;

export function registerAttributeTests(deps: {
  prisma: PrismaClient;
  login: () => Promise<Login>;
  send: Send;
  sendWithoutCsrf: Send;
}) {
  const { prisma, send } = deps;
  const scenario = (name: string, run: () => Promise<void>) => test(`attributes: ${name}`, async () => {
    await prisma.categoryAttribute.deleteMany();
    await prisma.attributeValue.deleteMany();
    await prisma.attribute.deleteMany();
    await prisma.category.deleteMany();
    await run();
  });
  const createCategory = () => prisma.category.create({ data: { name: "T-Shirts", slug: `tshirts-${randomUUID()}` } });
  const createAttribute = (code: string, isActive = true) => prisma.attribute.create({ data: { name: code, code, type: "SELECT", isActive } });
  const accountFixture = async (roleCode: "ADMIN" | "SELLER") => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await prisma.user.create({ data: { roles: { create: { roleId: role.id } } } });
    const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
    const session = await prisma.authSession.create({ data: { userId: user.id, context: "STAFF", mfaVerifiedAt: now, lastSeenAt: now, idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt } });
    const { signAccessToken } = await import("../src/modules/auth/token.service.js");
    return { userId: user.id, cookie: `access_token=${await signAccessToken(user.id, session.id, expiresAt)}` };
  };

  scenario("public API exposes active attributes and values in configured order for guests and buyers", async () => {
    const buyer = await deps.login();
    const category = await createCategory();
    const size = await createAttribute("size");
    const color = await createAttribute("color");
    const hidden = await createAttribute("hidden");
    await prisma.attributeValue.createMany({ data: [
      { attributeId: size.id, value: "m", label: "M", sortOrder: 2 },
      { attributeId: size.id, value: "s", label: "S", sortOrder: 1 },
      { attributeId: size.id, value: "xl", label: "XL", sortOrder: 3, isActive: false },
      { attributeId: color.id, value: "black", label: "Black", sortOrder: 1 },
    ] });
    await prisma.categoryAttribute.createMany({ data: [
      { categoryId: category.id, attributeId: color.id, sortOrder: 2 },
      { categoryId: category.id, attributeId: size.id, sortOrder: 1 },
      { categoryId: category.id, attributeId: hidden.id, sortOrder: 3, isActive: false },
    ] });
    for (const cookie of ["", buyer.cookie]) {
      const response = await send(`/categories/${category.id}/attributes`, cookie);
      assert.equal(response.status, 200);
      const attributes = (await response.json()).data.attributes;
      assert.deepEqual(attributes.map((attribute: { code: string }) => attribute.code), ["size", "color"]);
      assert.deepEqual(attributes[0].values.map((value: { value: string }) => value.value), ["s", "m"]);
    }
  });

  scenario("public API hides inactive attributes, mappings, values and inactive categories", async () => {
    const category = await createCategory();
    const active = await createAttribute("active");
    const inactive = await createAttribute("inactive", false);
    await prisma.attributeValue.createMany({ data: [
      { attributeId: active.id, value: "shown", label: "Shown", sortOrder: 1 },
      { attributeId: active.id, value: "hidden", label: "Hidden", sortOrder: 2, isActive: false },
      { attributeId: inactive.id, value: "inactive", label: "Inactive", sortOrder: 1 },
    ] });
    await prisma.categoryAttribute.createMany({ data: [
      { categoryId: category.id, attributeId: active.id, sortOrder: 1 },
      { categoryId: category.id, attributeId: inactive.id, sortOrder: 2 },
    ] });
    const attributes = (await (await send(`/categories/${category.id}/attributes`)).json()).data.attributes;
    assert.deepEqual(attributes.map((attribute: { code: string }) => attribute.code), ["active"]);
    assert.deepEqual(attributes[0].values.map((value: { value: string }) => value.value), ["shown"]);
    await prisma.category.update({ where: { id: category.id }, data: { isActive: false } });
    assert.equal((await send(`/categories/${category.id}/attributes`)).status, 404);
  });

  scenario("seeded T-Shirt attributes are returned by public API", async () => {
    const { seedCategorySamples } = await import("../prisma/category-samples.js");
    await seedCategorySamples();
    await seedCategorySamples();
    const category = await prisma.category.findUniqueOrThrow({ where: { id: "d5000000-0000-4000-8000-000000000003" } });
    const response = await send(`/categories/${category.id}/attributes`);
    assert.equal(response.status, 200);
    const attributes = (await response.json()).data.attributes;
    assert.deepEqual(attributes.map((attribute: { code: string }) => attribute.code), ["brand", "size", "color", "fabric", "fit", "pattern", "sleeve_length"]);
    assert.equal(attributes[0].isVariantOption, false);
    assert.deepEqual(attributes[1].values.map((value: { label: string }) => value.label), ["S", "M", "L", "XL"]);
  });

  scenario("admin attribute APIs enforce authorization and validation", async () => {
    const buyer = await deps.login();
    const seller = await accountFixture("SELLER");
    const admin = await accountFixture("ADMIN");
    assert.equal((await send("/admin/attributes")).status, 401);
    assert.equal((await send("/admin/attributes", buyer.cookie)).status, 403);
    assert.equal((await send("/admin/attributes", seller.cookie)).status, 403);
    assert.equal((await deps.sendWithoutCsrf("/admin/attributes", admin.cookie, { name: "No Csrf", code: "no_csrf", type: "SELECT" })).status, 403);
    const created = await send("/admin/attributes", admin.cookie, { name: "Material", code: "material", type: "SELECT" });
    assert.equal(created.status, 201, await created.clone().text());
    const attribute = (await created.json()).data.attribute as { id: string };
    assert.equal((await send("/admin/attributes", admin.cookie, { name: "Duplicate", code: "material", type: "SELECT" })).status, 409);
    assert.equal((await send("/admin/attributes", admin.cookie, { name: "Bad", code: "bad", type: "BAD" })).status, 400);
    assert.equal((await send(`/admin/attributes/${attribute.id}`, admin.cookie, {}, "PATCH")).status, 400);
    assert.equal((await send(`/admin/attributes/${attribute.id}`, admin.cookie, { isActive: false }, "PATCH")).status, 200);
  });

  scenario("admin value and category mapping APIs reject duplicates and inactive entities", async () => {
    const admin = await accountFixture("ADMIN");
    const category = await createCategory();
    const inactiveCategory = await prisma.category.create({ data: { name: "Inactive", slug: `inactive-${randomUUID()}`, isActive: false } });
    const active = await createAttribute("size");
    const inactive = await createAttribute("inactive", false);
    const value = await send(`/admin/attributes/${active.id}/values`, admin.cookie, { value: "m", label: "M", sortOrder: 2 });
    assert.equal(value.status, 201, await value.clone().text());
    const valueId = (await value.json()).data.value.id as string;
    assert.equal((await send(`/admin/attributes/${active.id}/values`, admin.cookie, { value: "m", label: "M" })).status, 409);
    assert.equal((await send(`/admin/attributes/${inactive.id}/values/${valueId}`, admin.cookie, { label: "Wrong" }, "PATCH")).status, 404);
    assert.equal((await send(`/admin/attributes/${active.id}/values/${valueId}`, admin.cookie, { isActive: false }, "PATCH")).status, 200);
    const mapping = await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: active.id, isRequired: true, isFilterable: true, isVariantOption: true, sortOrder: 1 });
    assert.equal(mapping.status, 201, await mapping.clone().text());
    assert.equal((await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: active.id })).status, 409);
    assert.equal((await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: inactive.id })).status, 400);
    assert.equal((await send(`/admin/categories/${inactiveCategory.id}/attributes`, admin.cookie, { attributeId: active.id })).status, 400);
    assert.equal((await send(`/admin/categories/${category.id}/attributes/${active.id}`, admin.cookie, { sortOrder: 3, isRequired: false }, "PATCH")).status, 200);
    assert.equal((await send(`/admin/categories/${category.id}/attributes/${active.id}`, admin.cookie, undefined, "DELETE")).status, 204);
    assert(await prisma.attribute.findUnique({ where: { id: active.id } }));
    assert.equal(await prisma.attributeValue.count({ where: { attributeId: active.id } }), 1);
  });
}
