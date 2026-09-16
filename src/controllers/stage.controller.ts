import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { stageService } from "../services/stage.service";
import { emitToProject } from "../utils/socketEmitter";

export const listStages = asyncHandler(async (req: Request, res: Response) => {
  const stages = await stageService.listStages(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!
  );
  res.json(new ApiResponse(200, stages, "Stages"));
});

export const createStage = asyncHandler(async (req: Request, res: Response) => {
  const stage = await stageService.createStage(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body
  );
  emitToProject(req.params.id, "pm:stage:created", { stage });
  res.status(201).json(new ApiResponse(201, stage, "Stage created"));
});

export const updateStage = asyncHandler(async (req: Request, res: Response) => {
  const stage = await stageService.updateStage(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body
  );
  emitToProject(stage.projectId.toString(), "pm:stage:updated", { stage });
  res.json(new ApiResponse(200, stage, "Stage updated"));
});

export const reorderStages = asyncHandler(async (req: Request, res: Response) => {
  await stageService.reorderStages(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body.orderedIds
  );
  emitToProject(req.params.id, "pm:stage:reordered", { projectId: req.params.id, orderedIds: req.body.orderedIds });
  res.json(new ApiResponse(200, null, "Stages reordered"));
});

export const deleteStage = asyncHandler(async (req: Request, res: Response) => {
  const stage = await stageService.deleteStage(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body.reassignToStageId
  );
  emitToProject(stage.projectId.toString(), "pm:stage:deleted", { stageId: stage._id, projectId: stage.projectId });
  res.json(new ApiResponse(200, null, "Stage deleted"));
});
