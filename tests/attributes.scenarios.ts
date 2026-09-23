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
    assert.deepEqual(attributes.map((attribute: { code: string }) => attribute.code), ["size", "color", "fabric", "fit", "pattern", "sleeve_length"]);
    assert.deepEqual(attributes[0].values.map((value: { label: string }) => value.label), ["S", "M", "L", "XL"]);
  });
}
