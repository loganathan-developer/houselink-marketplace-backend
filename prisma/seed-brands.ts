import { prisma } from "../src/config/database.js";
import { normalizeBrandName, slugFromName } from "../src/modules/brands/brand.schema.js";

const brandNames = ["Nike", "Puma", "Adidas", "Roadster", "H&M"] as const;

export async function seedDevelopmentBrands() {
  const now = new Date();
  for (const name of brandNames) {
    const normalizedName = normalizeBrandName(name);
    const slug = slugFromName(name);
    const existingByName = await prisma.brand.findUnique({ where: { normalizedName } });
    const existingBySlug = await prisma.brand.findUnique({ where: { slug } });
    if (existingByName && existingByName.slug !== slug) {
      throw new Error(`Seed brand conflict: ${name} normalized name exists with slug ${existingByName.slug}`);
    }
    if (existingBySlug && existingBySlug.normalizedName !== normalizedName) {
      throw new Error(`Seed brand conflict: ${name} slug belongs to ${existingBySlug.name}`);
    }
    if (existingByName) continue;
    await prisma.brand.create({
      data: {
        name,
        normalizedName,
        slug,
        status: "APPROVED",
        isActive: true,
        approvedAt: now,
      },
    });
  }
}

if (process.argv[1]?.endsWith("seed-brands.ts") || process.argv[1]?.endsWith("seed-brands.js")) {
  seedDevelopmentBrands()
    .then(() => console.log("Development brands seeded"))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Brand seeding failed; check environment and migrations.");
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
