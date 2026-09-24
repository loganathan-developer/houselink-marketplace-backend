import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client.js";

type Login = { cookie: string; userId: string; sessionId: string };
type Send = (path: string, cookie?: string, body?: unknown, method?: string) => Promise<Response>;

export function registerCategoryTests(deps: {
  prisma: PrismaClient;
  login: () => Promise<Login>;
  send: Send;
  sendWithoutCsrf: Send;
}) {
  const { prisma, send } = deps;
  const scenario = (name: string, run: () => Promise<void>) => test(`categories: ${name}`, async () => {
    await prisma.categoryAttribute.deleteMany();
    await prisma.attributeValue.deleteMany();
    await prisma.attribute.deleteMany();
    await prisma.category.deleteMany();
    await run();
  });
  const accountFixture = async (roleCode: "ADMIN" | "SELLER") => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await prisma.user.create({ data: { roles: { create: { roleId: role.id } } } });
    const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
    const session = await prisma.authSession.create({ data: { userId: user.id, context: "STAFF", mfaVerifiedAt: now, lastSeenAt: now, idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt } });
    const { signAccessToken } = await import("../src/modules/auth/token.service.js");
    return { userId: user.id, sessionId: session.id, cookie: `access_token=${await signAccessToken(user.id, session.id, expiresAt)}` };
  };

  scenario("public reads need no login or CSRF token", async () => {
    const root = await prisma.category.create({ data: { name: "Public root", slug: "public-root" } });
    const child = await prisma.category.create({ data: { name: "Public child", slug: "public-child", parentId: root.id } });
    for (const path of ["/categories", "/categories/tree", `/categories/${child.id}`, `/categories/slug/${child.slug}`]) {
      const response = await deps.sendWithoutCsrf(path, "", undefined, "GET");
      assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
      assert.equal((await response.json()).success, true);
      assert.deepEqual(response.headers.getSetCookie(), []);
    }
  });

  scenario("inactive ancestors hide descendants before counting", async () => {
    const root = await prisma.category.create({ data: { name: "Root", slug: "root", isActive: false } });
    const child = await prisma.category.create({ data: { name: "Child", slug: "child", parentId: root.id } });
    await prisma.category.create({ data: { name: "Disabled", slug: "disabled", isActive: false } });
    const list = (await (await send("/categories?limit=1")).json()).data;
    assert.deepEqual(list.categories, []);
    assert.equal(list.pagination.total, 0);
    assert.deepEqual((await (await send("/categories/tree")).json()).data.categories, []);
    assert.equal((await send(`/categories/${root.id}`)).status, 404);
    assert.equal((await send(`/categories/${child.id}`)).status, 404);
    assert.equal((await send("/categories/slug/root")).status, 404);
  });

  scenario("parent/root filters, pagination, stable ordering, tree, breadcrumbs and slug lookup", async () => {
    const root = await prisma.category.create({ data: { name: "Root", slug: "root", sortOrder: 3 } });
    const child = await prisma.category.create({ data: { name: "Child", slug: "child", parentId: root.id, sortOrder: 2 } });
    const peer = await prisma.category.create({ data: { name: "Peer", slug: "peer", parentId: root.id, sortOrder: 2 } });
    const leaf = await prisma.category.create({ data: { name: "Leaf", slug: "leaf", parentId: child.id, sortOrder: 0 } });
    const list = (await (await send(`/categories?parentId=${root.id}&limit=1`)).json()).data;
    assert.equal(list.pagination.total, 2);
    assert.equal(list.pagination.totalPages, 2);
    const ids = [child.id, peer.id].sort();
    assert.equal(list.categories[0].id, ids[0]);
    assert.equal((await (await send(`/categories?parentId=${root.id}&limit=1&page=2`)).json()).data.categories[0].id, ids[1]);
    assert.deepEqual((await (await send("/categories?rootOnly=true")).json()).data.categories.map((row: { id: string }) => row.id), [root.id]);
    const tree = (await (await send("/categories/tree")).json()).data.categories;
    assert.equal(tree[0].id, root.id);
    assert.deepEqual(tree[0].children.map((row: { id: string }) => row.id), ids);
    assert.equal(tree[0].children.find((row: { id: string }) => row.id === child.id).children[0].id, leaf.id);
    for (const path of [`/categories/${leaf.id}`, `/categories/slug/${leaf.slug}`]) {
      const response = await send(path);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data.category.breadcrumbs.map((row: { name: string }) => row.name), ["Root", "Child", "Leaf"]);
    }
    assert.equal((await send(`/categories/${randomUUID()}`)).status, 404);
    assert.equal((await send("/categories/slug/missing")).status, 404);
  });

  scenario("strict public UUIDs, slugs and query filters reject invalid input", async () => {
    const category = await prisma.category.create({ data: { name: "Root", slug: "root" } });
    for (const query of ["page=0", "page=-1", "page=1.2", "limit=101", "limit=0", "rootOnly=yes", "parentId=bad", `rootOnly=true&parentId=${category.id}`, "unknown=true", "page=1&page=2", "isActive=false"]) {
      assert.equal((await send(`/categories?${query}`)).status, 400, query);
    }
    assert.equal((await send("/categories/bad-id")).status, 400);
    assert.equal((await send("/categories/bad-id/attributes")).status, 400);
    assert.equal((await send("/categories/slug/Bad_Slug")).status, 400);
  });

  scenario("sample seed is repeatable and preserves auth data", async () => {
    const { seedCategorySamples } = await import("../prisma/category-samples.js");
    const authState = async () => ({ users: await prisma.user.count(), roles: await prisma.role.count(), assignments: await prisma.userRole.count(), sessions: await prisma.authSession.count() });
    const before = await authState();
    await seedCategorySamples();
    await seedCategorySamples();
    assert.equal(await prisma.category.count(), 17);
    assert.equal(await prisma.attribute.count({ where: { code: { in: ["brand", "size", "color", "fabric", "fit", "pattern", "sleeve_length"] } } }), 7);
    assert.deepEqual(await authState(), before);
  });

  scenario("database indexes, root NULL and timestamps match the category contract", async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'Category'`;
    assert(indexes.some(row => row.indexname === "Category_slug_key" && row.indexdef.includes("UNIQUE")));
    assert(indexes.some(row => row.indexname === "Category_parentId_sortOrder_idx"));
    const created = await prisma.category.create({ data: { name: "Root", slug: "root" } });
    const before = await prisma.category.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(before.parentId, null);
    assert(before.createdAt instanceof Date && before.updatedAt instanceof Date);
    await prisma.category.update({ where: { id: created.id }, data: { description: "Updated" } });
    const after = await prisma.category.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
    assert(after.updatedAt > before.updatedAt);
  });

  scenario("admin category APIs enforce authorization and support create/update/deactivate/move", async () => {
    const buyer = await deps.login();
    const seller = await accountFixture("SELLER");
    const admin = await accountFixture("ADMIN");
    assert.equal((await send("/admin/categories")).status, 401);
    assert.equal((await send("/admin/categories", buyer.cookie)).status, 403);
    assert.equal((await send("/admin/categories", seller.cookie)).status, 403);
    const rootResponse = await send("/admin/categories", admin.cookie, { name: "Root", slug: "admin-root", sortOrder: 2 });
    assert.equal(rootResponse.status, 201, await rootResponse.clone().text());
    const root = (await rootResponse.json()).data.category as { id: string };
    const childResponse = await send("/admin/categories", admin.cookie, { name: "Child", slug: "admin-child", parentId: root.id });
    assert.equal(childResponse.status, 201, await childResponse.clone().text());
    const child = (await childResponse.json()).data.category as { id: string };
    assert.equal((await send("/admin/categories", admin.cookie, { name: "Dup", slug: "admin-root" })).status, 409);
    assert.equal((await send(`/admin/categories/${root.id}`, admin.cookie, { parentId: child.id }, "PATCH")).status, 400);
    assert.equal((await send(`/admin/categories/${child.id}`, admin.cookie, { isActive: false, sortOrder: 4 }, "PATCH")).status, 200);
    assert.equal((await send(`/categories/${child.id}`)).status, 404);
    assert.equal((await send(`/admin/categories/${child.id}`, admin.cookie)).status, 200);
    assert.equal((await send("/admin/categories?isActive=false", admin.cookie)).status, 200);
  });
}
