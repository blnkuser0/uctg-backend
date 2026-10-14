import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { storageService } from "../services/storage.service";

export const download = asyncHandler(async (req: Request, res: Response) => {
  const { file, stream } = await storageService.openDownload(`db:${req.params.id}`);
  res.setHeader("Content-Type", file.contentType || "application/octet-stream");
  res.setHeader("Content-Length", file.length.toString());
  // Browser <img>, <audio>, and <video> tags use the same bearer-free delivery model as legacy
  // attachment URLs. The random GridFS id is not an indexable application identifier.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "private, max-age=86400");
  stream.on("error", () => res.destroy());
  stream.pipe(res);
});
