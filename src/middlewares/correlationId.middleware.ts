import { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existing = req.headers["x-correlation-id"];
  const id = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
  req.correlationId = id;
  res.setHeader("x-correlation-id", id);
  next();
}
