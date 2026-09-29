import { mkdirSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import type { StorageAdapter } from "./media.types.js";

const allowedKey = /^(categories|brands)\/[0-9a-f-]+\.webp$/;

export class LocalStorageAdapter implements StorageAdapter {
  readonly root = path.resolve(process.cwd(), env.UPLOAD_DIR);

  constructor() {
    mkdirSync(this.directory("categories"), { recursive: true });
    mkdirSync(this.directory("brands"), { recursive: true });
  }

  async initialize() {
    await Promise.all([
      mkdir(path.join(this.root, "categories"), { recursive: true }),
      mkdir(path.join(this.root, "brands"), { recursive: true }),
    ]);
  }

  directory(folder: "categories" | "brands") {
    return path.join(this.root, folder);
  }

  private resolve(storageKey: string) {
    if (!allowedKey.test(storageKey)) throw new Error("Invalid media storage key");
    const target = path.resolve(this.root, storageKey);
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error("Invalid media storage path");
    return target;
  }

  async save(storageKey: string, data: Buffer) {
    await this.initialize();
    await writeFile(this.resolve(storageKey), data, { flag: "wx" });
  }

  async delete(storageKey: string) {
    try {
      await unlink(this.resolve(storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  getPublicUrl(storageKey: string) {
    const pathname = storageKey.split("/").map(encodeURIComponent).join("/");
    return new URL(`/uploads/${pathname}`, env.PUBLIC_BASE_URL).toString();
  }
}

export const localStorage = new LocalStorageAdapter();
