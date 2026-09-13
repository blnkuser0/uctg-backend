import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { UserRole } from "../models/User.model";

export const authorize = (roles: UserRole[], denialMessage = "You do not have permission to perform this action") => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(ApiError.forbidden(denialMessage));
      return;
    }
    next();
  };
};

export const requireAdmin = authorize(["admin"], "Admin access required");
