import { prisma } from "../../config/database.js";
import { HttpError } from "../../shared/errors/http-error.js";
import type { AddressInput } from "./user.schema.js";

export const profileSelect = { id: true, name: true, profileImage: true, createdAt: true, updatedAt: true } as const;

export async function mutateAddress(userId: string, action: "create" | "update" | "delete" | "default", addressId?: string, data: Partial<AddressInput> = {}) {
  const updates = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as {
    [K in keyof AddressInput]?: Exclude<AddressInput[K], undefined>;
  };
  return prisma.$transaction(async tx => {
    // Serialize all address mutations for the same owner, including concurrent default changes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`addresses:${userId}`}, 0))`;
    if (action !== "create") {
      const address = await tx.userAddress.findFirst({ where: { id: addressId!, userId } });
      if (!address) throw new HttpError(404, "ADDRESS_NOT_FOUND", "Address not found.");
    }
    if (action === "delete") {
      await tx.userAddress.delete({ where: { id: addressId!, userId } });
      return null;
    }
    if (action === "default" || data.isDefault === true) {
      await tx.userAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    if (action === "create") {
      const input = data as AddressInput;
      return tx.userAddress.create({ data: { ...input, userId, addressLine2: input.addressLine2 ?? null, isDefault: input.isDefault ?? false } });
    }
    return tx.userAddress.update({ where: { id: addressId!, userId }, data: action === "default" ? { isDefault: true } : updates });
  });
}
