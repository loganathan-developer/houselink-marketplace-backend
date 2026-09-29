import type { MediaPurpose } from "../../generated/prisma/client.js";

export interface StorageAdapter {
  save(storageKey: string, data: Buffer): Promise<void>;
  delete(storageKey: string): Promise<void>;
  getPublicUrl(storageKey: string): string;
}

export type UploadedMedia = {
  id: string;
  purpose: MediaPurpose;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  url: string;
  createdAt: Date;
};
