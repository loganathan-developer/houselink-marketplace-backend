import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { lockUser } from "../auth/session.service.js";
import { advisoryLockKey } from "../auth/otp/otp.utils.js";
import { adminEmailSchema, adminPasswordSchema } from "./admin-auth.schema.js";
import { hashPassword } from "./admin-auth.crypto.js";

export async function provisionDevelopmentAdmin(input: {
  email: string;
  password: string;
}) {
  if (env.NODE_ENV !== "development")
    throw new Error("Admin provisioning requires NODE_ENV=development.");
  const email = adminEmailSchema.parse(input.email);
  const password = adminPasswordSchema.parse(input.password);
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    // Serialize provisioning and destination-bound OTP login. The identity unique
    // constraint also prevents a competing identity creation from promoting a buyer.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey(`otp:EMAIL:LOGIN:${email}`)})`;
    const identity = await tx.authIdentity.findUnique({
      where: { provider_identifier: { provider: "EMAIL", identifier: email } },
    });
    if (identity) {
      await lockUser(tx, identity.userId);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: identity.userId },
        include: {
          roles: { include: { role: true } },
          passwordCredential: true,
        },
      });
      if (
        user.status !== "ACTIVE" ||
        !user.roles.some(({ role }) => role.code === "ADMIN")
      )
        throw new Error(
          "Refusing to promote or reactivate an existing account.",
        );
      // Repeat runs never rotate credentials or reset MFA; missing credentials may be provisioned.
      if (!user.passwordCredential)
        await tx.passwordCredential.create({
          data: {
            userId: user.id,
            passwordHash,
            passwordChangedAt: new Date(),
          },
        });
      return { userId: user.id, created: false };
    }
    const role = await tx.role.upsert({
      where: { code: "ADMIN" },
      create: { code: "ADMIN" },
      update: {},
    });
    const user = await tx.user.create({
      data: {
        identities: {
          create: {
            provider: "EMAIL",
            identifier: email,
            verifiedAt: new Date(),
          },
        },
        roles: { create: { roleId: role.id } },
        passwordCredential: {
          create: { passwordHash, passwordChangedAt: new Date() },
        },
      },
    });
    return { userId: user.id, created: true };
  });
}
