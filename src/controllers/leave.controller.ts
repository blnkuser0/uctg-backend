import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { leaveService } from "../services/leave.service";

export const createLeave = asyncHandler(async (req: Request, res: Response) => {
  const leave = await leaveService.createLeave(req.orgId!, req.user!.id, req.body);
  res.status(201).json(new ApiResponse(201, leave, "Leave request submitted"));
});

export const listAll = asyncHandler(async (req: Request, res: Response) => {
  const leaves = await leaveService.listAll(req.orgId!);
  res.json(new ApiResponse(200, leaves, "Leave requests"));
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const leaves = await leaveService.listMine(req.orgId!, req.user!.id);
  res.json(new ApiResponse(200, leaves, "Your leave requests"));
});

export const hrDecision = asyncHandler(async (req: Request, res: Response) => {
  const leave = await leaveService.setHrDecision(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.body.status,
    req.body.note
  );
  res.json(new ApiResponse(200, leave, "HR decision recorded"));
});

export const adminDecision = asyncHandler(async (req: Request, res: Response) => {
  const leave = await leaveService.setAdminDecision(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.body.status,
    req.body.note
  );
  res.json(new ApiResponse(200, leave, "Admin decision recorded"));
});

export const cancelLeave = asyncHandler(async (req: Request, res: Response) => {
  await leaveService.cancelOwn(req.orgId!, req.user!.id, req.params.id);
  res.json(new ApiResponse(200, null, "Leave request cancelled"));
});
