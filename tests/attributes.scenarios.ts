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
  const adminLogin = async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
    const user = await prisma.user.create({ data: { roles: { create: { roleId: role.id } } } });
    const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
    const session = await prisma.authSession.create({ data: { userId: user.id, context: "STAFF", mfaVerifiedAt: now, lastSeenAt: now, idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt } });
    const { signAccessToken } = await import("../src/modules/auth/token.service.js");
    return { userId: user.id, cookie: `access_token=${await signAccessToken(user.id, session.id, expiresAt)}` };
  };
  const sellerLogin = async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: "SELLER" } });
    const user = await prisma.user.create({ data: { roles: { create: { roleId: role.id } } } });
    const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
    const session = await prisma.authSession.create({ data: { userId: user.id, context: "STAFF", mfaVerifiedAt: now, lastSeenAt: now, idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt } });
    const { signAccessToken } = await import("../src/modules/auth/token.service.js");
    return { userId: user.id, cookie: `access_token=${await signAccessToken(user.id, session.id, expiresAt)}` };
  };
  const createCategory = () => prisma.category.create({ data: { name: "T-Shirts", slug: `tshirts-${randomUUID()}` } });
  const createAttribute = async (cookie: string, code = `attr_${randomUUID().replaceAll("-", "_")}`) => {
    const response = await send("/admin/attributes", cookie, { name: "Material", code, type: "SELECT" });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).data.attribute as { id: string; code: string };
  };
  const createValue = async (cookie: string, attributeId: string, value = `v_${randomUUID().replaceAll("-", "_")}`) => {
    const response = await send(`/admin/attributes/${attributeId}/values`, cookie, { value, label: "Value", sortOrder: 2 });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).data.value as { id: string; value: string };
  };

  scenario("admin attribute APIs validate duplicates, types, empty patches and deactivation", async () => {
    const admin = await adminLogin();
    const attribute = await createAttribute(admin.cookie, "fabric");
    assert.equal((await send("/admin/attributes", admin.cookie)).status, 200);
    assert.equal((await send("/admin/attributes", admin.cookie, { name: "Fabric", code: "fabric", type: "SELECT" })).status, 409);
    assert.equal((await send("/admin/attributes", admin.cookie, { name: "Bad", code: "bad", type: "BAD" })).status, 400);
    assert.equal((await send(`/admin/attributes/${attribute.id}`, admin.cookie, {}, "PATCH")).status, 400);
    const deactivated = await send(`/admin/attributes/${attribute.id}`, admin.cookie, { isActive: false }, "PATCH");
    assert.equal(deactivated.status, 200);
    assert.equal((await prisma.attribute.findUniqueOrThrow({ where: { id: attribute.id } })).isActive, false);
  });

  scenario("attribute values enforce parent ownership, uniqueness, updates and public hiding", async () => {
    const admin = await adminLogin();
    const category = await createCategory();
    const first = await createAttribute(admin.cookie, "size");
    const second = await createAttribute(admin.cookie, "color");
    const value = await createValue(admin.cookie, first.id, "m");
    assert.equal((await send(`/admin/attributes/${first.id}/values`, admin.cookie, { value: "m", label: "M" })).status, 409);
    assert.equal((await send(`/admin/attributes/${randomUUID()}/values`, admin.cookie, { value: "x", label: "X" })).status, 404);
    assert.equal((await send("/admin/attributes/not-a-uuid/values", admin.cookie, { value: "x", label: "X" })).status, 400);
    assert.equal((await send(`/admin/attributes/${second.id}/values/${value.id}`, admin.cookie, { label: "Wrong" }, "PATCH")).status, 404);
    assert.equal((await send(`/admin/attributes/${first.id}/values/${value.id}`, admin.cookie, { label: "Medium", sortOrder: 1 }, "PATCH")).status, 200);
    await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: first.id, isFilterable: true }, "POST");
    assert.equal((await (await send(`/categories/${category.id}/attributes`)).json()).data.attributes[0].values.length, 1);
    assert.equal((await send(`/admin/attributes/${first.id}/values/${value.id}`, admin.cookie, { isActive: false }, "PATCH")).status, 200);
    assert.equal((await (await send(`/categories/${category.id}/attributes`)).json()).data.attributes[0].values.length, 0);
  });

  scenario("category mappings enforce active entities, reactivate inactive mappings and preserve shared data", async () => {
    const admin = await adminLogin();
    const category = await createCategory();
    const inactiveCategory = await prisma.category.create({ data: { name: "Inactive", slug: `inactive-${randomUUID()}`, isActive: false } });
    const first = await createAttribute(admin.cookie, "size");
    const second = await createAttribute(admin.cookie, "color");
    await createValue(admin.cookie, first.id, "s");
    await createValue(admin.cookie, second.id, "black");
    assert.equal((await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: first.id, isRequired: true, isFilterable: true, isVariantOption: true, sortOrder: 2 })).status, 201);
    assert.equal((await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: first.id })).status, 409);
    assert.equal((await send(`/admin/categories/${category.id}/attributes/${first.id}`, admin.cookie, { sortOrder: 5, isRequired: false }, "PATCH")).status, 200);
    assert.equal((await send(`/admin/categories/${category.id}/attributes/${first.id}`, admin.cookie, undefined, "DELETE")).status, 204);
    assert(await prisma.attribute.findUnique({ where: { id: first.id } }));
    assert.equal(await prisma.attributeValue.count({ where: { attributeId: first.id } }), 1);
    assert.equal((await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: first.id, sortOrder: 1 })).status, 201);
    await send(`/admin/attributes/${second.id}`, admin.cookie, { isActive: false }, "PATCH");
    assert.equal((await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: second.id })).status, 400);
    assert.equal((await send(`/admin/categories/${inactiveCategory.id}/attributes`, admin.cookie, { attributeId: first.id })).status, 400);
  });

  scenario("public API exposes active attributes and values in configured order", async () => {
    const admin = await adminLogin();
    const buyer = await deps.login();
    const category = await createCategory();
    const size = await createAttribute(admin.cookie, "size");
    const color = await createAttribute(admin.cookie, "color");
    const hidden = await createAttribute(admin.cookie, "hidden");
    await send(`/admin/attributes/${size.id}/values`, admin.cookie, { value: "m", label: "M", sortOrder: 2 });
    await send(`/admin/attributes/${size.id}/values`, admin.cookie, { value: "s", label: "S", sortOrder: 1 });
    const inactiveValue = await createValue(admin.cookie, size.id, "xl");
    await send(`/admin/attributes/${size.id}/values/${inactiveValue.id}`, admin.cookie, { isActive: false }, "PATCH");
    await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: color.id, sortOrder: 2 });
    await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: size.id, sortOrder: 1 });
    await send(`/admin/categories/${category.id}/attributes`, admin.cookie, { attributeId: hidden.id, sortOrder: 3 });
    await send(`/admin/categories/${category.id}/attributes/${hidden.id}`, admin.cookie, undefined, "DELETE");
    for (const cookie of ["", buyer.cookie]) {
      const response = await send(`/categories/${category.id}/attributes`, cookie);
      assert.equal(response.status, 200);
      const attributes = (await response.json()).data.attributes;
      assert.deepEqual(attributes.map((attribute: { code: string }) => attribute.code), ["size", "color"]);
      assert.deepEqual(attributes[0].values.map((value: { value: string }) => value.value), ["s", "m"]);
    }
    await send(`/admin/attributes/${size.id}`, admin.cookie, { isActive: false }, "PATCH");
    assert.deepEqual((await (await send(`/categories/${category.id}/attributes`)).json()).data.attributes.map((attribute: { code: string }) => attribute.code), ["color"]);
    await send(`/admin/categories/${category.id}`, admin.cookie, { isActive: false }, "PATCH");
    assert.equal((await send(`/categories/${category.id}/attributes`)).status, 404);
  });

  scenario("admin authorization allows only real admin sessions", async () => {
    const admin = await adminLogin();
    const buyer = await deps.login();
    const seller = await sellerLogin();
    assert.equal((await deps.sendWithoutCsrf("/admin/attributes", "", undefined, "GET")).status, 401);
    assert.equal((await send("/admin/attributes", buyer.cookie)).status, 403);
    assert.equal((await send("/admin/attributes", seller.cookie)).status, 403);
    assert.equal((await send("/admin/attributes", admin.cookie)).status, 200);
  });
}
