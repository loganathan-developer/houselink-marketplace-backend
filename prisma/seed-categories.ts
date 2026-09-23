import { prisma } from "../src/config/database.js";
import { seedCategorySamples } from "./category-samples.js";

seedCategorySamples()
  .then(() => console.log("Development category samples seeded"))
  .catch(() => { console.error("Category seeding failed; check environment, migrations and hierarchy."); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
