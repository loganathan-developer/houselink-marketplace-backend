import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import sharp from "sharp";
import type { PrismaClient } from "../src/generated/prisma/client.js";

type Send = (path: string, cookie?: string, body?: unknown, method?: string) => Promise<Response>;

export function registerMediaTests(deps: {
  prisma: PrismaClient;
  base: () => string;
  csrf: Record<string, string>;
  send: Send;
  sendWithoutCsrf: Send;
}) {
  const { prisma, send } = deps;
  const scenario = (name: string, run: (context: TestContext) => Promise<void>) => test(`media: ${name}`, async (context) => {
    await prisma.categoryAttribute.deleteMany();
    await prisma.category.deleteMany();
    await prisma.brand.deleteMany();
    await prisma.media.deleteMany();
    await run(context);
  });

  const account = async (mfa = true, roleCode = "ADMIN") => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await prisma.user.create({ data: { roles: { create: { roleId: role.id } } } });
    const now = new Date(), expiresAt = new Date(now.getTime() + 600000);
    const session = await prisma.authSession.create({ data: {
      userId: user.id, context: "STAFF", mfaVerifiedAt: mfa ? now : null,
      lastSeenAt: now, idleExpiresAt: expiresAt, absoluteExpiresAt: expiresAt,
    } });
    const { signAccessToken } = await import("../src/modules/auth/token.service.js");
    return { userId: user.id, cookie: `admin_access_token=${await signAccessToken(user.id, session.id, expiresAt)}` };
  };

  const image = (width = 3, height = 2, format: "png" | "jpeg" | "webp" = "png") =>
    sharp({ create: { width, height, channels: 4, background: { r: 10, g: 120, b: 220, alpha: 1 } } })[format]().toBuffer();

  const upload = async (cookie: string, purpose: string, bytes: Buffer, headers = deps.csrf, field = "file") => {
    const form = new FormData();
    form.set("purpose", purpose);
    form.set(field, new Blob([bytes], { type: "image/png" }), "sample.png");
    return fetch(`${deps.base()}/api/admin/media`, { method: "POST", headers: { ...headers, Cookie: cookie }, body: form });
  };

  scenario("requires admin MFA and CSRF, processes real images, and serves only generated WebP", async () => {
    const admin = await account(), noMfa = await account(false), seller = await account(true, "SELLER");
    const bytes = await image();
    assert.equal((await upload("", "CATEGORY_IMAGE", bytes)).status, 401);
    assert.equal((await upload(noMfa.cookie, "CATEGORY_IMAGE", bytes)).status, 403);
    assert.equal((await upload(seller.cookie, "CATEGORY_IMAGE", bytes)).status, 403);
    assert.equal((await upload(admin.cookie, "CATEGORY_IMAGE", bytes, { Origin: deps.csrf.Origin! })).status, 403);
    const response = await upload(admin.cookie, "CATEGORY_IMAGE", bytes);
    assert.equal(response.status, 201, await response.clone().text());
    const media = (await response.json()).data.media;
    assert.equal(media.mimeType, "image/webp");
    assert.equal(media.width, 3);
    assert.equal(media.height, 2);
    assert.equal(media.storageKey, undefined);
    const served = await fetch(`${deps.base()}${new URL(media.url).pathname}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/webp");
    assert.equal((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).format, "webp");
    assert.equal((await fetch(`${deps.base()}/uploads/categories/../brands/missing.webp`)).status, 404);
  });

  scenario("rejects invalid purpose, fake images, extra fields, excessive pixels, and oversized bodies", async () => {
    const admin = await account();
    assert.equal((await upload(admin.cookie, "PRODUCT_IMAGE", await image())).status, 400);
    assert.equal((await upload(admin.cookie, "CATEGORY_IMAGE", Buffer.from("not-an-image"))).status, 400);
    const hugePixels = await image(5000, 4001);
    assert.equal((await upload(admin.cookie, "CATEGORY_IMAGE", hugePixels)).status, 413);

    const another = await account();
    assert.equal((await upload(another.cookie, "CATEGORY_IMAGE", Buffer.alloc(5_242_881))).status, 413);
    const wrongField = await upload(await account().then((value) => value.cookie), "CATEGORY_IMAGE", await image(), deps.csrf, "photo");
    assert.equal(wrongField.status, 400);
  });

  scenario("attaches by purpose, resolves public URLs, detaches to direct URLs, and protects referenced media", async () => {
    const admin = await account();
    const categoryMedia = (await (await upload(admin.cookie, "CATEGORY_IMAGE", await image())).json()).data.media;
    const brandMedia = (await (await upload(admin.cookie, "BRAND_LOGO", await image(4, 4, "jpeg"))).json()).data.media;
    const direct = "https://example.test/original.png";
    const category = (await (await send("/admin/categories", admin.cookie, {
      name: "Media Category", slug: `media-${randomUUID()}`, imageUrl: direct,
    })).json()).data.category;
    assert.equal((await send(`/admin/categories/${category.id}`, admin.cookie, { imageUrl: direct, imageMediaId: categoryMedia.id }, "PATCH")).status, 400);
    assert.equal((await send(`/admin/categories/${category.id}`, admin.cookie, { imageMediaId: brandMedia.id }, "PATCH")).status, 400);
    const attached = (await (await send(`/admin/categories/${category.id}`, admin.cookie, { imageMediaId: categoryMedia.id }, "PATCH")).json()).data.category;
    assert.equal(attached.imageUrl, categoryMedia.url);
    assert.equal((await send(`/admin/media/${categoryMedia.id}`, admin.cookie, undefined, "DELETE")).status, 409);
    const publicCategory = (await (await send(`/categories/${category.id}`)).json()).data.category;
    assert.equal(publicCategory.imageUrl, categoryMedia.url);
    assert.equal(publicCategory.imageMediaId, undefined);
    const detached = (await (await send(`/admin/categories/${category.id}`, admin.cookie, { imageMediaId: null }, "PATCH")).json()).data.category;
    assert.equal(detached.imageUrl, direct);
    assert.equal((await send(`/admin/media/${categoryMedia.id}`, admin.cookie, undefined, "DELETE")).status, 204);

    const brand = (await (await send("/admin/brands", admin.cookie, { name: `Brand ${randomUUID()}`, status: "APPROVED", logoMediaId: brandMedia.id })).json()).data.brand;
    assert.equal(brand.logoUrl, brandMedia.url);
    const publicBrand = (await (await send(`/brands/slug/${brand.slug}`)).json()).data.brand;
    assert.equal(publicBrand.logoUrl, brandMedia.url);
    assert.equal(publicBrand.logoMediaId, undefined);
  });

  scenario("rate limits uploads per authenticated admin", async () => {
    const admin = await account(), bytes = await image();
    for (let index = 0; index < 3; index++) assert.equal((await upload(admin.cookie, "CATEGORY_IMAGE", bytes)).status, 201);
    assert.equal((await upload(admin.cookie, "CATEGORY_IMAGE", bytes)).status, 429);
  });

  scenario("storage and database failures do not leave inconsistent media records", async (context) => {
    const admin = await account();
    const { createMedia, deleteMedia } = await import("../src/modules/media/media.service.js");
    const { localStorage } = await import("../src/modules/media/local-storage.adapter.js");
    const buffer = await image();
    const file = { buffer } as Express.Multer.File;

    const saveFailure = context.mock.method(localStorage, "save", async () => { throw new Error("storage unavailable"); });
    await assert.rejects(createMedia(file, "CATEGORY_IMAGE", admin.userId), /storage unavailable/);
    assert.equal(await prisma.media.count(), 0);
    saveFailure.mock.restore();

    const deleteSpy = context.mock.method(localStorage, "delete", async () => undefined);
    await assert.rejects(createMedia(file, "CATEGORY_IMAGE", randomUUID()));
    assert.equal(deleteSpy.mock.callCount(), 1);
    deleteSpy.mock.restore();

    const media = await prisma.media.create({ data: {
      storageKey: `categories/${randomUUID()}.webp`, mimeType: "image/webp", sizeBytes: 10,
      width: 1, height: 1, purpose: "CATEGORY_IMAGE", uploadedById: admin.userId,
    } });
    const deleteFailure = context.mock.method(localStorage, "delete", async () => { throw new Error("delete unavailable"); });
    await assert.rejects(deleteMedia(media.id), /delete unavailable/);
    assert(await prisma.media.findUnique({ where: { id: media.id } }));
    deleteFailure.mock.restore();
  });
}
