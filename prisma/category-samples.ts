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
  }, { timeout: 15000 });
}
