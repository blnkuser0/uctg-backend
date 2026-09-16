import { NextFunction, Request, Response } from "express";
import { Project } from "../models/Project.model";
import { ApiError } from "../utils/ApiError";

/** Resolves a project member's client organization before nested project APIs run. */
export async function projectContext(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const project = await Project.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!project) return next(ApiError.notFound("Project not found"));
    const isMember = project.memberIds.some((memberId) => memberId.toString() === req.user!.id);
    const isClientAdmin = req.roleName === "CLIENT_ADMIN" && project.organizationId.toString() === req.orgId;
    if (!isMember && !isClientAdmin && req.roleName !== "SUPER_ADMIN") {
      return next(ApiError.forbidden("You are not assigned to this project"));
    }
    req.orgId = project.organizationId.toString();
    next();
  } catch (error) {
    next(error);
  }
}
