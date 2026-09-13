import pino from "pino";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import { config } from "../config";

export const logger = pino({
  level: config.env === "test" ? "silent" : config.isProduction ? "info" : "debug",
  transport: config.isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
      },
  redact: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash"],
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const existing = req.headers["x-correlation-id"];
    const id = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
    res.setHeader("x-correlation-id", id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});
