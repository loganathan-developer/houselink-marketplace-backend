import { z } from "zod";

export const mediaPurposeBody = z.strictObject({
  purpose: z.enum(["CATEGORY_IMAGE", "BRAND_LOGO"]),
});

export const mediaParams = z.strictObject({ mediaId: z.uuid() });
export const noQuery = z.strictObject({});
