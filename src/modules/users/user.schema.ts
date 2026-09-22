import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
export const profileBody = z.strictObject({
  name: text(100).optional(),
  profileImage: z.url().max(2048).refine(value => URL.canParse(value) && new URL(value).protocol === "https:", "Use an HTTPS image URL").nullable().optional(),
}).refine(value => Object.keys(value).length > 0, "Provide at least one field");

export const addressBody = z.strictObject({
  recipientName: text(100),
  contactPhone: z.string().regex(/^\+[1-9]\d{7,14}$/, "Use an international phone number"),
  addressLine1: text(200),
  addressLine2: text(200).nullable().optional(),
  city: text(100),
  state: text(100),
  postalCode: text(20).regex(/^[A-Za-z0-9 -]+$/),
  country: z.string().regex(/^[A-Za-z]{2}$/, "Use a two-letter country code").transform(value => value.toUpperCase()),
  isDefault: z.boolean().optional(),
});
export const addressPatch = addressBody.partial().refine(value => Object.keys(value).length > 0, "Provide at least one field");
export const addressParams = z.strictObject({ addressId: z.uuid() });
export const emptyBody = z.strictObject({}).optional();
export type AddressInput = z.infer<typeof addressBody>;
