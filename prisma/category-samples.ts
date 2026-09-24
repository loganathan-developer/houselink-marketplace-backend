import { prisma } from "../src/config/database.js";
import { env } from "../src/config/env.js";
import { CATEGORY_LOCK, MAX_CATEGORY_DEPTH } from "../src/modules/categories/category.service.js";

// Stable IDs preserve seeded rows even when an administrator later renames their slug.
const samples: [string, string, number | null][] = [
  ["Men", "men", null], ["Topwear", "men-topwear", 0],
  ["T-Shirts", "men-topwear-tshirts", 1], ["Shirts", "men-topwear-shirts", 1],
  ["Women", "women", null], ["Western Wear", "women-western-wear", 4],
  ["Tops", "women-western-tops", 5], ["Dresses", "women-western-dresses", 5],
  ["Kids", "kids", null], ["Boys Clothing", "kids-boys-clothing", 8], ["T-Shirts", "kids-boys-tshirts", 9],
  ["Home", "home", null], ["Bath", "home-bath", 11], ["Bath Towels", "home-bath-towels", 12],
  ["Beauty", "beauty", null], ["Makeup", "beauty-makeup", 14], ["Lipstick", "beauty-makeup-lipstick", 15],
];

const tshirtAttributes = [
  { name: "Brand", code: "brand", sortOrder: 1, isRequired: true, isVariantOption: false, values: [["houselink", "HouseLink"], ["urban_stitch", "Urban Stitch"], ["dailywear", "Dailywear"]] },
  { name: "Size", code: "size", sortOrder: 2, isRequired: true, isVariantOption: true, values: [["s", "S"], ["m", "M"], ["l", "L"], ["xl", "XL"]] },
  { name: "Color", code: "color", sortOrder: 3, isRequired: true, isVariantOption: true, values: [["black", "Black"], ["white", "White"], ["blue", "Blue"], ["red", "Red"]] },
  { name: "Fabric", code: "fabric", sortOrder: 4, isRequired: false, isVariantOption: false, values: [["cotton", "Cotton"], ["polyester", "Polyester"], ["linen", "Linen"]] },
  { name: "Fit", code: "fit", sortOrder: 5, isRequired: false, isVariantOption: false, values: [["slim", "Slim"], ["regular", "Regular"], ["oversized", "Oversized"]] },
  { name: "Pattern", code: "pattern", sortOrder: 6, isRequired: false, isVariantOption: false, values: [["solid", "Solid"], ["printed", "Printed"], ["striped", "Striped"], ["checked", "Checked"]] },
  { name: "Sleeve Length", code: "sleeve_length", sortOrder: 7, isRequired: false, isVariantOption: false, values: [["half_sleeve", "Half Sleeve"], ["full_sleeve", "Full Sleeve"], ["sleeveless", "Sleeveless"]] },
] as const;

export async function seedCategorySamples() {
  if (env.NODE_ENV === "production") throw new Error("Sample categories are development data only");
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CATEGORY_LOCK})`;
    const ids: (string | null)[] = [];
    for (const [index, [name, slug, parentIndex]] of samples.entries()) {
      const id = `d5000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`;
      if (await tx.category.findUnique({ where: { id } })) { ids[index] = id; continue; }
      const parentId = parentIndex === null ? null : ids[parentIndex] ?? null;
      if ((parentIndex !== null && parentId === null) || await tx.category.findUnique({ where: { slug } })) {
        ids[index] = null;
        continue;
      }
      let ancestor = parentId, depth = 1;
      while (ancestor !== null) {
        if (++depth > MAX_CATEGORY_DEPTH) throw new Error("Sample parent exceeds safe hierarchy depth");
        ancestor = (await tx.category.findUniqueOrThrow({ where: { id: ancestor }, select: { parentId: true } })).parentId;
      }
      await tx.category.create({ data: { id, name, slug, parentId, sortOrder: index } });
      ids[index] = id;
    }
    const tshirts = await tx.category.findUnique({ where: { id: "d5000000-0000-4000-8000-000000000003" }, select: { id: true } }) ??
      await tx.category.findFirst({
        where: { slug: "men-topwear-tshirts", parent: { slug: "men-topwear", parent: { slug: "men" } } },
        select: { id: true },
      });
    if (!tshirts) throw new Error("Cannot seed T-Shirt attributes: expected Men > Topwear > T-Shirts category is missing");
    for (const item of tshirtAttributes) {
      const attribute = await tx.attribute.upsert({
        where: { code: item.code },
        update: {},
        create: { name: item.name, code: item.code, type: "SELECT", isActive: true },
      });
      for (const [index, [value, label]] of item.values.entries()) {
        await tx.attributeValue.upsert({
          where: { attributeId_value: { attributeId: attribute.id, value } },
          update: {},
          create: { attributeId: attribute.id, value, label, sortOrder: index + 1, isActive: true },
        });
      }
      await tx.categoryAttribute.upsert({
        where: { categoryId_attributeId: { categoryId: tshirts.id, attributeId: attribute.id } },
        update: {},
        create: {
          categoryId: tshirts.id,
          attributeId: attribute.id,
          isRequired: item.isRequired,
          isFilterable: true,
          isVariantOption: item.isVariantOption,
          sortOrder: item.sortOrder,
          isActive: true,
        },
      });
    }
  }, { timeout: 15000 });
}
