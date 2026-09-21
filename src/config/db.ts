import mongoose from "mongoose";
import { config } from "./index";
import { logger } from "../utils/logger";

let isConnected = false;
let listenersAttached = false;

function attachConnectionListeners() {
  // connectDB() can now run several times (see connectDBWithRetry); listen only once.
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on("connected", () => {
    isConnected = true;
    logger.info("MongoDB connected");
  });

  mongoose.connection.on("error", (err) => {
    logger.error({ err }, "MongoDB connection error");
  });

  mongoose.connection.on("disconnected", () => {
    isConnected = false;
    logger.warn("MongoDB disconnected");
  });
}

export async function connectDB(): Promise<void> {
  if (isConnected) return;

  mongoose.set("strictQuery", true);
  attachConnectionListeners();

  // Fail after 10s (default is 30s) so a wrong URI / blocked IP shows up quickly in the logs.
  await mongoose.connect(config.mongo.uri, { serverSelectionTimeoutMS: 10_000 });
}

const RETRY_DELAYS_MS = [3_000, 5_000, 10_000, 20_000, 30_000];

/** Keeps trying until MongoDB answers instead of giving up on the first failure. The HTTP server is
 *  already listening by then, so /api/health can report `dbConnected: false` and the logs say why. */
export async function connectDBWithRetry(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await connectDB();
      return;
    } catch (err) {
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      logger.error(
        { err },
        `MongoDB connection failed (attempt ${attempt + 1}) — retrying in ${delay / 1000}s. Check MONGO_URI (password, database), and that Atlas Network Access allows this server's IP (0.0.0.0/0).`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  isConnected = false;
}

export function isDbConnected(): boolean {
  return isConnected;
}
