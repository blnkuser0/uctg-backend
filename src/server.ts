import dns from "dns";

// Node's own DNS resolver (c-ares) sometimes picks a different, broken DNS
// server than the OS resolver on Windows — this breaks the `mongodb+srv://`
// SRV lookup Atlas connection strings rely on even when `nslookup`/Windows
// itself resolves fine. Force a known-good resolver and prefer IPv4 before
// any DNS lookup (e.g. mongoose.connect) happens.
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");

import express from "express";
import http from "http";
import path from "path";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import mongoSanitize from "express-mongo-sanitize";

import { config } from "./config";
import { connectDBWithRetry, disconnectDB } from "./config/db";
import { logger, httpLogger } from "./utils/logger";
import { globalLimiter } from "./middlewares/rateLimit.middleware";
import { correlationIdMiddleware } from "./middlewares/correlationId.middleware";
import { errorHandler } from "./middlewares/error.middleware";
import { createSocketServer } from "./socket";
import { deadlineReminderService } from "./services/deadlineReminder.service";
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

// Local-disk attachment storage — served cross-origin since the frontend
// runs on a different port/host. Helmet's default same-origin resource
// policy would otherwise block <img>/download requests from there.
app.use(
  "/uploads",
  (_req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.resolve(process.cwd(), config.uploads.dir))
);

app.use("/api/health", healthRoute);
app.use("/api", routes);

app.use(errorHandler);

async function start(): Promise<void> {
  // Listen first, then connect: a hosting platform's health check must find the server even while
  // the database is slow or briefly unreachable; /api/health reports `dbConnected` honestly.
  httpServer.listen(config.server.port, () => {
    logger.info(`Server listening on port ${config.server.port} [${config.env}]`);
  });

  await connectDBWithRetry();

  deadlineReminderService.startDeadlineReminderSweep();
}

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  deadlineReminderService.stopDeadlineReminderSweep();
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
