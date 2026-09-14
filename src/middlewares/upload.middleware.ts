import multer from "multer";
import { config } from "../config";

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploads.maxSizeMb * 1024 * 1024,
    files: 10,
  },
});
