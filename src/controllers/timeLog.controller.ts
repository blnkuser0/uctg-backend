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
  const summary = await timeLogService.getMonthSummary(req.orgId!, req.user!.id, year, month);
  res.json(new ApiResponse(200, summary, "Attendance calendar"));
});

export const getTeamDaySummary = asyncHandler(async (req: Request, res: Response) => {
  const date = parsePhDateKey(req.query.date as string);
  const entries = await timeLogService.getTeamDaySummary(req.orgId!, date);
  res.json(new ApiResponse(200, entries, "Team attendance"));
});
