import { prisma } from "../src/config/database.js";
import { provisionDevelopmentAdmin } from "../src/modules/admin-auth/admin-auth.provision.js";

try {
  const email = process.env.DEV_ADMIN_EMAIL;
  const password = process.env.DEV_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Explicit DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD are required.");
  const result = await provisionDevelopmentAdmin({ email, password });
  console.log(result.created ? "Development admin provisioned." : "Development admin already exists; existing password and MFA preserved.");
} catch {
  console.error("Admin provisioning failed. Check development mode, explicit credentials (password 12-128 characters), account ownership and database migrations.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
