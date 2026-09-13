import express from "express";
import http from "http";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import mongoSanitize from "express-mongo-sanitize";

import { config } from "./config";
import { connectDB, disconnectDB } from "./config/db";
import { logger, httpLogger } from "./utils/logger";
import { globalLimiter } from "./middlewares/rateLimit.middleware";
import { correlationIdMiddleware } from "./middlewares/correlationId.middleware";
import { errorHandler } from "./middlewares/error.middleware";
import { createSocketServer } from "./socket";
import healthRoute from "./routes/health.route";
import routes from "./routes";

const app = express();

app.set("trust proxy", 1);

app.use(globalLimiter);
app.use(correlationIdMiddleware);
app.use(httpLogger);
app.use(helmet());

const httpServer = http.createServer(app);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());
app.use(
  cors({
    origin: config.server.clientUrl,
    credentials: true,
  })
);

createSocketServer(httpServer);

app.use(cookieParser());

app.use("/api/health", healthRoute);
app.use("/api", routes);

app.use(errorHandler);

async function start(): Promise<void> {
  await connectDB();

  httpServer.listen(config.server.port, () => {
    logger.info(`Server listening on port ${config.server.port} [${config.env}]`);
  });
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  httpServer.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
}

if (require.main === module) {
  start().catch((err) => {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  });

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception");
    void shutdown("uncaughtException");
  });
}

export { app, httpServer };
