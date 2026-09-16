import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { User } from "../models/User.model";
import { IRole } from "../models/Role.model";

export async function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await User.findById(req.user!.id).populate<{ roleId: IRole }>("roleId").lean();
    if (!user || user.roleId?.name !== "SUPER_ADMIN") {
      next(ApiError.forbidden("Only a Super Admin can provision accounts or organizations"));
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
