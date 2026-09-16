import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { labelService } from "../services/label.service";
import { emitToProject } from "../utils/socketEmitter";

export const listLabels = asyncHandler(async (req: Request, res: Response) => {
  const labels = await labelService.listLabels(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!
  );
  res.json(new ApiResponse(200, labels, "Labels"));
});

export const createLabel = asyncHandler(async (req: Request, res: Response) => {
  const label = await labelService.createLabel(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body
  );
  emitToProject(req.params.id, "pm:label:created", { label });
  res.status(201).json(new ApiResponse(201, label, "Label created"));
});

export const updateLabel = asyncHandler(async (req: Request, res: Response) => {
  const label = await labelService.updateLabel(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body
  );
  emitToProject(label.projectId.toString(), "pm:label:updated", { label });
  res.json(new ApiResponse(200, label, "Label updated"));
});

export const deleteLabel = asyncHandler(async (req: Request, res: Response) => {
  const label = await labelService.deleteLabel(req.orgId!, req.params.id, req.user!.id, req.permissions!, req.isSuperAdmin!);
  emitToProject(label.projectId.toString(), "pm:label:deleted", { labelId: label._id, projectId: label.projectId });
  res.json(new ApiResponse(200, null, "Label deleted"));
});
