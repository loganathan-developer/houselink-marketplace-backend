import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { Prisma, type Media, type MediaPurpose } from "../../generated/prisma/client.js";
import { HttpError } from "../../shared/errors/http-error.js";
import { localStorage } from "./local-storage.adapter.js";
import type { UploadedMedia } from "./media.types.js";

const folders: Record<MediaPurpose, "categories" | "brands"> = {
  CATEGORY_IMAGE: "categories",
  BRAND_LOGO: "brands",
};

export const mediaPublicUrl = (storageKey: string) => localStorage.getPublicUrl(storageKey);

function present(media: Media): UploadedMedia {
  return {
    id: media.id,
    purpose: media.purpose,
    mimeType: media.mimeType,
    sizeBytes: media.sizeBytes,
    width: media.width,
    height: media.height,
    url: mediaPublicUrl(media.storageKey),
    createdAt: media.createdAt,
  };
}

export async function createMedia(file: Express.Multer.File | undefined, purpose: MediaPurpose, uploadedById: string) {
  if (!file) throw new HttpError(400, "MEDIA_FILE_REQUIRED", "One image file is required.");
  let metadata: Metadata;
  try {
    metadata = await sharp(file.buffer, { failOn: "error", limitInputPixels: false }).metadata();
  } catch {
    throw new HttpError(400, "INVALID_IMAGE", "The uploaded file is not a valid image.");
  }
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || !metadata.width || !metadata.height) {
    throw new HttpError(415, "UNSUPPORTED_IMAGE_TYPE", "Only JPEG, PNG, and WebP images are supported.");
  }
  if (metadata.width * metadata.height > env.MAX_IMAGE_PIXELS) {
    throw new HttpError(413, "IMAGE_PIXEL_LIMIT_EXCEEDED", "Image dimensions exceed the pixel limit.");
  }

  let output: Buffer;
  try {
    output = await sharp(file.buffer, { failOn: "error", limitInputPixels: env.MAX_IMAGE_PIXELS })
      .rotate()
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new HttpError(400, "INVALID_IMAGE", "The uploaded image could not be processed.");
  }
  const outputMetadata = await sharp(output).metadata();
  const storageKey = `${folders[purpose]}/${randomUUID()}.webp`;
  await localStorage.save(storageKey, output);
  try {
    const media = await prisma.media.create({ data: {
      storageKey,
      mimeType: "image/webp",
      sizeBytes: output.length,
      width: outputMetadata.width!,
      height: outputMetadata.height!,
      purpose,
      uploadedById,
    } });
    return present(media);
  } catch (error) {
    await localStorage.delete(storageKey);
    throw error;
  }
}

export async function requireMediaPurpose(id: string, purpose: MediaPurpose, tx: Prisma.TransactionClient = prisma) {
  const media = await tx.media.findUnique({ where: { id }, select: { purpose: true } });
  if (!media) throw new HttpError(400, "MEDIA_NOT_FOUND", "Media not found.");
  if (media.purpose !== purpose) throw new HttpError(400, "MEDIA_PURPOSE_MISMATCH", "Media has the wrong purpose.");
}

export async function deleteMedia(id: string) {
  const media = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
    const row = await tx.media.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, "MEDIA_NOT_FOUND", "Media not found.");
    const [categories, brands] = await Promise.all([
      tx.category.count({ where: { imageMediaId: id } }),
      tx.brand.count({ where: { logoMediaId: id } }),
    ]);
    if (categories + brands > 0) throw new HttpError(409, "MEDIA_IN_USE", "Media is attached and cannot be deleted.");
    await tx.media.delete({ where: { id } });
    return row;
  }, { isolationLevel: "Serializable" });

  try {
    await localStorage.delete(media.storageKey);
  } catch (error) {
    try { await prisma.media.create({ data: media }); } catch { /* Preserve the original storage error. */ }
    throw error;
  }
}
