import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";

export const requireSuperAdmin = () => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.isSuperAdmin) {
      next(ApiError.forbidden("Super Admin access required"));
      return;
    }
    next();
  };
};
