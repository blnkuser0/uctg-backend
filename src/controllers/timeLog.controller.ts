import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { timeLogService } from "../services/timeLog.service";
import { parsePhDateKey } from "../utils/phTime";

export const clock = asyncHandler(async (req: Request, res: Response) => {
  const { log, state } = await timeLogService.clock(req.orgId!, req.user!.id, req.body.type, req.body.note);
  res.status(201).json(new ApiResponse(201, { log, state }, "Recorded"));
});

export const getToday = asyncHandler(async (req: Request, res: Response) => {
  const { logs, state } = await timeLogService.getTodayWithState(req.orgId!, req.user!.id);
  res.json(new ApiResponse(200, { logs, state }, "Today's time log"));
});

export const getMonthSummary = asyncHandler(async (req: Request, res: Response) => {
  const [year, month] = (req.query.month as string).split("-").map(Number);
  const viewedUserId = await timeLogService.resolveViewedUserId(
    req.orgId!,
    req.user!.id,
    req.permissions ?? [],
    req.query.userId as string | undefined
  );
  const summary = await timeLogService.getMonthSummary(req.orgId!, viewedUserId, year, month);
  res.json(new ApiResponse(200, summary, "Attendance calendar"));
});

export const getTeamDaySummary = asyncHandler(async (req: Request, res: Response) => {
  const date = parsePhDateKey(req.query.date as string);
  const entries = await timeLogService.getTeamDaySummary(req.orgId!, date);
  res.json(new ApiResponse(200, entries, "Team attendance"));
});

export const getPeriodSummary = asyncHandler(async (req: Request, res: Response) => {
  const viewedUserId = await timeLogService.resolveViewedUserId(
    req.orgId!,
    req.user!.id,
    req.permissions ?? [],
    req.query.userId as string | undefined
  );
  const summary = await timeLogService.getPeriodSummary(req.orgId!, viewedUserId, req.query.date as string);
  res.json(new ApiResponse(200, summary, "Attendance week and cut-off summary"));
});

export const getTeamPeriodSummary = asyncHandler(async (req: Request, res: Response) => {
  const entries = await timeLogService.getTeamPeriodSummary(req.orgId!, req.query.date as string);
  res.json(new ApiResponse(200, entries, "Team attendance week and cut-off summary"));
});
