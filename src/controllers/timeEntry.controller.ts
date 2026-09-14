import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { timeEntryService } from "../services/timeEntry.service";
import { emitToProject } from "../utils/socketEmitter";

export const startTimer = asyncHandler(async (req: Request, res: Response) => {
  const entry = await timeEntryService.startTimer(req.orgId!, req.params.id, req.user!.id, req.permissions!);
  emitToProject(entry.projectId.toString(), "pm:timer:started", { taskId: req.params.id, userId: req.user!.id });
  res.status(201).json(new ApiResponse(201, entry, "Timer started"));
});

export const stopTimer = asyncHandler(async (req: Request, res: Response) => {
  const entry = await timeEntryService.stopTimer(req.orgId!, req.params.id, req.user!.id, req.permissions!);
  emitToProject(entry.projectId.toString(), "pm:timer:stopped", {
    taskId: req.params.id,
    userId: req.user!.id,
    durationMinutes: entry.durationMinutes,
  });
  res.json(new ApiResponse(200, entry, "Timer stopped"));
});

export const createManualEntry = asyncHandler(async (req: Request, res: Response) => {
  const entry = await timeEntryService.createManualEntry(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.body
  );
  res.status(201).json(new ApiResponse(201, entry, "Time entry added"));
});

export const listForTask = asyncHandler(async (req: Request, res: Response) => {
  const entries = await timeEntryService.listForTask(req.orgId!, req.params.id, req.user!.id, req.permissions!);
  res.json(new ApiResponse(200, entries, "Time entries"));
});

export const deleteEntry = asyncHandler(async (req: Request, res: Response) => {
  await timeEntryService.deleteEntry(req.orgId!, req.params.id, req.user!.id);
  res.json(new ApiResponse(200, null, "Time entry deleted"));
});
