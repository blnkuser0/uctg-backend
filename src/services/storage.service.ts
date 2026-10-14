import mongoose, { Types } from "mongoose";
import { config } from "../config";
import { ApiError } from "../utils/ApiError";

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

function bucket(): mongoose.mongo.GridFSBucket {
  if (!mongoose.connection.db) throw ApiError.badRequest("File storage is temporarily unavailable");
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "catalystUploads" });
}

function safeName(originalName: string): string {
  return originalName.replace(/[\\/\0]/g, "_").slice(0, 180) || "attachment";
}

/** New uploads live in GridFS; legacy /uploads links remain readable during transition. */
async function upload(file: UploadableFile, folder: string): Promise<StoredFile> {
  const uploadStream = bucket().openUploadStream(safeName(file.originalname), {
    contentType: file.mimetype || "application/octet-stream",
    metadata: { folder, originalName: safeName(file.originalname), uploadedAt: new Date() },
  });
  await new Promise<void>((resolve, reject) => {
    uploadStream.once("error", reject);
    uploadStream.once("finish", resolve);
    uploadStream.end(file.buffer);
  });
  const id = uploadStream.id.toString();
  return {
    url: `${config.server.backendUrl}/api/files/db-${id}`,
    fileKey: `db:${id}`,
    originalName: safeName(file.originalname),
    mimeType: file.mimetype || "application/octet-stream",
    size: file.size,
  };
}

async function remove(fileKey: string): Promise<void> {
  if (!fileKey.startsWith("db:")) return;
  const rawId = fileKey.slice(3);
  if (!Types.ObjectId.isValid(rawId)) return;
  await bucket().delete(new Types.ObjectId(rawId)).catch(() => undefined);
}

async function openDownload(fileKey: string) {
  if (!fileKey.startsWith("db:")) throw ApiError.notFound("File not found");
  const rawId = fileKey.slice(3);
  if (!Types.ObjectId.isValid(rawId)) throw ApiError.notFound("File not found");
  const id = new Types.ObjectId(rawId);
  const file = await bucket().find({ _id: id }).next();
  if (!file) throw ApiError.notFound("File not found");
  return { file, stream: bucket().openDownloadStream(id) };
}

export const storageService = { upload, remove, openDownload };
