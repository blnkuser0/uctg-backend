import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { jwtService } from "../services/jwt.service";
import { User } from "../models/User.model";

export const auth = () => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

      if (!token) {
        next(ApiError.unauthorized("Authentication token missing"));
        return;
      }

      const payload = jwtService.verifyAccessToken(token);

      const user = await User.findById(payload.sub).lean();
      if (!user) {
        next(ApiError.unauthorized("User no longer exists"));
        return;
      }
      if (!user.isActive) {
        next(ApiError.forbidden("Account is deactivated"));
        return;
      }

      req.user = {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      };

      next();
    } catch {
      next(ApiError.unauthorized("Invalid or expired token"));
    }
  };
};
