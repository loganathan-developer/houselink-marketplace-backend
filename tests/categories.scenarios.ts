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
  race: (key: bigint, first: () => Promise<Response>, second: () => Promise<Response>) => Promise<Response[]>;
}) {
  const { prisma, send } = deps;
  const scenario = (name: string, run: () => Promise<void>) => test(`categories: ${name}`, async () => {
    // This client points at the unique isolated test schema created by auth.test.ts.
    await prisma.category.deleteMany();
    await run();
  });
  const accountFixture = async (roleCode: "ADMIN" | "SELLER", context: "STAFF" | "CUSTOMER" = "STAFF", mfa = true) => {
    // Provision an independent account only in the harness-owned test schema.
    // Never promote an OTP buyer or convert an existing customer session.
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await prisma.user.create({ data: { roles: { create: { roleId: role.id } } } });
    const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
    const session = await prisma.authSession.create({ data: {
      userId: user.id, context, mfaVerifiedAt: mfa ? now : null,
      lastSeenAt: now, idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt,
    } });
    const { signAccessToken } = await import("../src/modules/auth/token.service.js");
    const token = await signAccessToken(user.id, session.id, expiresAt);
    return { userId: user.id, sessionId: session.id, cookie: `access_token=${token}` };
  };
  const adminLogin = () => accountFixture("ADMIN");
  const create = async (cookie: string, data: Record<string, unknown> = {}) => {
    const response = await send("/admin/categories", cookie, { name: "Category", slug: `category-${randomUUID()}`, ...data });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).data.category as { id: string; slug: string; parentId: string | null };
  };
  const patch = (cookie: string, id: string, body: unknown) => send(`/admin/categories/${id}`, cookie, body, "PATCH");

  scenario("public reads need no login or CSRF token while admin reads require an authorized admin", async () => {
    const root = await prisma.category.create({ data: { name: "Public root", slug: "public-root" } });
    const child = await prisma.category.create({ data: { name: "Public child", slug: "public-child", parentId: root.id } });
    for (const path of ["/categories", "/categories/tree", `/categories/${child.id}`, `/categories/slug/${child.slug}`]) {
      const response = await deps.sendWithoutCsrf(path, "", undefined, "GET");
      assert.equal(response.status, 200, `${path}: ${await response.clone().text()}`);
      assert.equal((await response.json()).success, true);
      assert.deepEqual(response.headers.getSetCookie(), []);
    }
    const anonymous = await deps.sendWithoutCsrf("/admin/categories", "", undefined, "GET");
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).error.code, "UNAUTHENTICATED");
    const buyer = await deps.login();
    const forbidden = await send("/admin/categories", buyer.cookie);
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error.code, "FORBIDDEN");
    const admin = await adminLogin();
    const allowed = await send("/admin/categories", admin.cookie);
    assert.equal(allowed.status, 200);
    assert.equal((await allowed.json()).data.pagination.total, 2);
  });

  scenario("root, child and third level creation; relation, rename, order and explicit root move", async () => {
    const auth = await adminLogin();
    const root = await create(auth.cookie, { name: "Root", slug: "root" });
    const child = await create(auth.cookie, { name: "Child", parentId: root.id });
    const leaf = await create(auth.cookie, { name: "Leaf", parentId: child.id });
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: child.id }, include: { parent: true, children: true } })).children[0]!.id, leaf.id);
    const renamed = await patch(auth.cookie, child.id, { name: "Renamed", sortOrder: 9, description: "New", imageUrl: "https://example.com/image.png" });
    assert.equal(renamed.status, 200);
    const value = (await renamed.json()).data.category;
    assert.equal(value.slug, child.slug);
    assert.equal(value.parentId, root.id);
    assert.equal(value.sortOrder, 9);
    assert.equal(value.name, "Renamed");
    assert.equal((await patch(auth.cookie, leaf.id, { parentId: root.id, slug: "moved-leaf" })).status, 200);
    assert.equal((await patch(auth.cookie, child.id, { parentId: null, description: null, imageUrl: null })).status, 200);
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: child.id } })).parentId, null);
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: leaf.id } })).parentId, root.id);
    assert.equal((await send(`/admin/categories/${randomUUID()}`, auth.cookie)).status, 404);
    assert.equal((await patch(auth.cookie, randomUUID(), { name: "Missing" })).status, 404);
    assert.equal((await send(`/admin/categories/${root.id}`, auth.cookie, undefined, "DELETE")).status, 404);
  });

  scenario("duplicate slugs, invalid parents, self-parenting and descendant cycles rejected", async () => {
    const auth = await adminLogin();
    const root = await create(auth.cookie, { slug: "unique" });
    const child = await create(auth.cookie, { parentId: root.id });
    const leaf = await create(auth.cookie, { parentId: child.id });
    assert.equal((await send("/admin/categories", auth.cookie, { name: "Duplicate", slug: "unique" })).status, 409);
    assert.equal((await patch(auth.cookie, leaf.id, { slug: "unique" })).status, 409);
    assert.equal((await send("/admin/categories", auth.cookie, { name: "Invalid", slug: "invalid", parentId: randomUUID() })).status, 400);
    for (const parentId of [root.id, leaf.id, randomUUID()]) assert.equal((await patch(auth.cookie, root.id, { parentId })).status, 400);
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: root.id } })).parentId, null);
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: leaf.id } })).slug, leaf.slug);
  });

  scenario("concurrent opposing moves cannot create a cycle", async () => {
    const auth = await adminLogin();
    const first = await create(auth.cookie), second = await create(auth.cookie);
    const { CATEGORY_LOCK } = await import("../src/modules/categories/category.service.js");
    const responses = await deps.race(CATEGORY_LOCK,
      () => patch(auth.cookie, first.id, { parentId: second.id }),
      () => patch(auth.cookie, second.id, { parentId: first.id }));
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
    const rows = await prisma.category.findMany();
    assert.equal(rows.filter(row => row.parentId === null).length, 1);
    assert.equal((await send("/categories/tree")).status, 200);
  });

  scenario("inactive ancestors hide descendants before counting; reactivation preserves child flags", async () => {
    const auth = await adminLogin();
    const root = await create(auth.cookie), child = await create(auth.cookie, { parentId: root.id });
    const leaf = await create(auth.cookie, { parentId: child.id });
    const disabled = await create(auth.cookie, { parentId: root.id, isActive: false });
    assert.equal((await patch(auth.cookie, root.id, { isActive: false })).status, 200);
    const list = (await (await send("/categories?limit=1")).json()).data;
    assert.deepEqual(list.categories, []);
    assert.equal(list.pagination.total, 0);
    assert.deepEqual((await (await send("/categories/tree")).json()).data.categories, []);
    for (const category of [root, child, leaf, disabled]) {
      assert.equal((await send(`/categories/${category.id}`)).status, 404);
      assert.equal((await send(`/categories/slug/${category.slug}`)).status, 404);
      assert.equal((await send(`/admin/categories/${category.id}`, auth.cookie)).status, 200);
    }
    assert.equal((await (await send("/admin/categories?isActive=false", auth.cookie)).json()).data.pagination.total, 2);
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: leaf.id } })).isActive, true);
    assert.equal((await patch(auth.cookie, root.id, { isActive: true })).status, 200);
    assert.equal((await (await send("/categories")).json()).data.pagination.total, 3);
    assert.equal((await send(`/categories/${disabled.id}`)).status, 404);
    assert.equal((await send(`/categories/${leaf.id}`)).status, 200);
  });

  scenario("parent/root filters, pagination, stable ordering, tree, breadcrumbs and slug lookup", async () => {
    const auth = await adminLogin();
    const root = await create(auth.cookie, { name: "Root", sortOrder: 3 });
    const child = await create(auth.cookie, { name: "Child", parentId: root.id, sortOrder: 2 });
    const peer = await create(auth.cookie, { name: "Peer", parentId: root.id, sortOrder: 2 });
    const leaf = await create(auth.cookie, { name: "Leaf", parentId: child.id, sortOrder: 0 });
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
    assert.equal((await (await send(`/admin/categories?parentId=${root.id}`, auth.cookie)).json()).data.pagination.total, 2);
  });

  scenario("strict bodies, UUIDs, slugs and query filters reject invalid input", async () => {
    const auth = await adminLogin();
    const category = await create(auth.cookie);
    for (const body of [{}, { name: "" }, { slug: "Bad Slug" }, { parentId: "bad" }, { sortOrder: -1 }, { sortOrder: 1.5 }, { isActive: "false" }, { roles: ["ADMIN"] }, { imageUrl: "invalid-url" }]) {
      assert.equal((await patch(auth.cookie, category.id, body)).status, 400);
    }
    assert.equal((await send("/admin/categories", auth.cookie, { name: "Missing slug" })).status, 400);
    for (const query of ["page=0", "page=-1", "page=1.2", "limit=101", "limit=0", "rootOnly=yes", "parentId=bad", `rootOnly=true&parentId=${category.id}`, "unknown=true", "page=1&page=2"]) {
      assert.equal((await send(`/categories?${query}`)).status, 400, query);
      assert.equal((await send(`/admin/categories?${query}`, auth.cookie)).status, 400, query);
    }
    assert.equal((await send("/categories?isActive=false")).status, 400);
    assert.equal((await send("/admin/categories?isActive=maybe", auth.cookie)).status, 400);
    assert.equal((await send("/categories/bad-id")).status, 400);
    assert.equal((await send("/categories/slug/Bad_Slug")).status, 400);
    assert.equal((await send("/admin/categories/bad-id", auth.cookie)).status, 400);
    assert.equal((await patch(auth.cookie, "bad-id", { name: "Name" })).status, 400);
  });

  scenario("admin endpoints enforce session, role, staff MFA, blocked/deleted state and CSRF", async () => {
    const buyer = await deps.login();
    const seller = await accountFixture("SELLER", "CUSTOMER", false);
    const admin = await adminLogin();
    const category = await create(admin.cookie);
    const paths: [string, string, unknown?][] = [["/admin/categories", "GET"], [`/admin/categories/${category.id}`, "GET"], ["/admin/categories", "POST", { name: "New", slug: "new" }], [`/admin/categories/${category.id}`, "PATCH", { name: "Renamed" }]];
    for (const [path, method, body] of paths) {
      assert.equal((await send(path, "", body, method)).status, 401);
      assert.equal((await send(path, buyer.cookie, body, method)).status, 403);
      assert.equal((await send(path, seller.cookie, body, method)).status, 403);
    }
    const customerAdmin = await accountFixture("ADMIN", "CUSTOMER");
    const noMfaAdmin = await accountFixture("ADMIN", "STAFF", false);
    for (const [path, method, body] of paths) {
      assert.equal((await send(path, customerAdmin.cookie, body, method)).status, 403);
      assert.equal((await send(path, noMfaAdmin.cookie, body, method)).status, 403);
    }
    const buyerState = await prisma.user.findUniqueOrThrow({ where: { id: buyer.userId }, include: { roles: { include: { role: true } }, sessions: true } });
    assert.deepEqual(buyerState.roles.map(({ role }) => role.code), ["BUYER"]);
    assert(buyerState.sessions.every(session => session.context === "CUSTOMER" && session.mfaVerifiedAt === null));
    assert.equal((await send("/admin/categories", admin.cookie)).status, 200);
    for (const [path, method, body] of paths.filter(([, method]) => method !== "GET")) {
      assert.equal((await deps.sendWithoutCsrf(path, admin.cookie, body, method)).status, 403);
    }
    assert.equal((await prisma.category.findUniqueOrThrow({ where: { id: category.id } })).name, "Category");
    for (const status of ["BLOCKED", "DELETED"] as const) {
      await prisma.user.update({ where: { id: admin.userId }, data: { status } });
      for (const [path, method, body] of paths) assert.equal((await send(path, admin.cookie, body, method)).status, 401);
    }
  });

  scenario("depth limit accounts for a moved subtree and deep tree responses remain usable", async () => {
    const auth = await adminLogin();
    const { MAX_CATEGORY_DEPTH } = await import("../src/modules/categories/category.service.js");
    let parentId: string | null = null;
    for (let index = 0; index < MAX_CATEGORY_DEPTH; index++) {
      const category = await prisma.category.create({ data: { name: `Level ${index}`, slug: `level-${index}`, parentId } });
      parentId = category.id;
    }
    assert.equal((await send("/admin/categories", auth.cookie, { name: "Too deep", slug: "too-deep", parentId })).status, 400);
    const root = await create(auth.cookie);
    await create(auth.cookie, { parentId: root.id });
    assert.equal((await patch(auth.cookie, root.id, { parentId })).status, 400);
    assert.equal((await send("/categories/tree")).status, 200);
    assert.equal((await (await send(`/categories/${parentId}`)).json()).data.category.breadcrumbs.length, MAX_CATEGORY_DEPTH);
  });

  scenario("simultaneous duplicate slug creation returns one success and one conflict", async () => {
    const auth = await adminLogin();
    const responses = await Promise.all([1, 2].map(() => send("/admin/categories", auth.cookie, { name: "Duplicate", slug: "same-slug" })));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    assert.equal(await prisma.category.count({ where: { slug: "same-slug" } }), 1);
  });

  scenario("sample seed is repeatable and preserves administrator edits including slug changes", async () => {
    const { seedCategorySamples } = await import("../prisma/category-samples.js");
    const authState = async () => ({ users: await prisma.user.count(), roles: await prisma.role.count(), assignments: await prisma.userRole.count(), sessions: await prisma.authSession.count() });
    const before = await authState();
    await seedCategorySamples();
    assert.equal(await prisma.category.count(), 17);
    const root = await prisma.category.findUniqueOrThrow({ where: { slug: "men" } });
    await prisma.category.update({ where: { id: root.id }, data: { slug: "edited-men", name: "Edited", isActive: false, sortOrder: 99 } });
    await seedCategorySamples();
    assert.equal(await prisma.category.count(), 17);
    const preserved = await prisma.category.findUniqueOrThrow({ where: { id: root.id } });
    assert.equal(preserved.slug, "edited-men");
    assert.equal(preserved.name, "Edited");
    assert.equal(preserved.isActive, false);
    assert.equal(preserved.sortOrder, 99);
    assert.deepEqual(await authState(), before);
  });

  scenario("database indexes, root NULL and timestamps match the category contract", async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'Category'`;
    assert(indexes.some(row => row.indexname === "Category_slug_key" && row.indexdef.includes("UNIQUE")));
    assert(indexes.some(row => row.indexname === "Category_parentId_sortOrder_idx"));
    const admin = await adminLogin();
    const created = await create(admin.cookie);
    const before = await prisma.category.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(before.parentId, null);
    assert(before.createdAt instanceof Date && before.updatedAt instanceof Date);
    assert.equal((await patch(admin.cookie, created.id, { description: "Updated" })).status, 200);
    const after = await prisma.category.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
    assert(after.updatedAt > before.updatedAt);
  });
}
