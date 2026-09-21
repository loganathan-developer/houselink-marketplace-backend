import { prisma } from "../src/config/database.js";

const roles = [
  "BUYER",
  "SELLER",
  "ADMIN",
] as const;

async function main() {
  for (const code of roles) {
    await prisma.role.upsert({
      where: {
        code,
      },

      update: {},

      create: {
        code,
      },
    });
  }

  console.log("Roles seeded successfully");
}

main()
  .catch(() => {
    console.error("Role seeding failed; check database configuration and migrations.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
