import mongoose from "mongoose";
import { config } from "./index";
import { logger } from "../utils/logger";

let isConnected = false;

export async function connectDB(): Promise<void> {
  if (isConnected) return;

  mongoose.set("strictQuery", true);

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

  await mongoose.connect(config.mongo.uri);
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  isConnected = false;
}

export function isDbConnected(): boolean {
  return isConnected;
}
