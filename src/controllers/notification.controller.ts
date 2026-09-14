import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { notificationService } from "../services/notification.service";

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const notifications = await notificationService.listForUser(req.orgId!, req.user!.id);
  res.json(new ApiResponse(200, notifications, "Notifications"));
});

export const countNotifications = asyncHandler(async (req: Request, res: Response) => {
  const count = await notificationService.countUnread(req.orgId!, req.user!.id);
  res.json(new ApiResponse(200, { count }, "Unread count"));
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  await notificationService.markRead(req.orgId!, req.user!.id, req.body.ids);
  res.json(new ApiResponse(200, null, "Notifications marked read"));
});
