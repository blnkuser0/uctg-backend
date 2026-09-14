import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { config } from "../config";

export interface UploadableFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface StoredFile {
  url: string;
  fileKey: string;
  originalName: string;
  mimeType: string;
  size: number;
}

const UPLOAD_ROOT = path.resolve(process.cwd(), config.uploads.dir);

function safeExt(originalName: string): string {
  const ext = path.extname(originalName);
  return /^\.[a-zA-Z0-9]{1,10}$/.test(ext) ? ext : "";
}

/**
 * Local-disk implementation behind a small, swappable interface — a future
 * cloud backend (S3/R2) can replace this module without touching callers.
 */
async function upload(file: UploadableFile, folder: string): Promise<StoredFile> {
  const dir = path.join(UPLOAD_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });

  const fileKey = `${folder}/${randomUUID()}${safeExt(file.originalname)}`;
  const fullPath = path.join(UPLOAD_ROOT, fileKey);
  await fs.writeFile(fullPath, file.buffer);

  return {
    url: `${config.server.backendUrl}/uploads/${fileKey}`,
    fileKey,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
}

async function remove(fileKey: string): Promise<void> {
  const fullPath = path.join(UPLOAD_ROOT, fileKey);
  await fs.unlink(fullPath).catch(() => undefined);
}

export const storageService = {
  upload,
  remove,
};
