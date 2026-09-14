import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { Permission } from "../constants/permissions";

export const requirePermission = (permission: Permission) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.permissions?.includes(permission)) {
      next(ApiError.forbidden("You do not have permission to perform this action"));
      return;
    }
    next();
  };
};
