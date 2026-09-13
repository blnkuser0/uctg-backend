import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { logger } from "../utils/logger";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let apiError: ApiError;

  if (err instanceof ApiError) {
    apiError = err;
  } else {
    const message = err instanceof Error ? err.message : "Internal server error";
    apiError = new ApiError(500, message);
  }

  if (apiError.statusCode >= 500) {
    logger.error({ err, correlationId: req.correlationId }, "Unhandled error");
  }

  res.status(apiError.statusCode).json({
    success: false,
    message: apiError.message,
    statusCode: apiError.statusCode,
    errors: apiError.errors,
    correlationId: req.correlationId,
  });
}
