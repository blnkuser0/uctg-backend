import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { channelService } from "../services/channel.service";
import { emitToUser } from "../utils/socketEmitter";

export const listChannels = asyncHandler(async (req: Request, res: Response) => {
  const channels = await channelService.listMyChannels(req.orgId!, req.user!.id);
  res.json(new ApiResponse(200, channels, "Channels"));
});

export const createDm = asyncHandler(async (req: Request, res: Response) => {
  const channel = await channelService.getOrCreateDm(req.orgId!, req.user!.id, req.body.userId);
  emitToUser(req.body.userId, "chat:channel:created", { channel });
  res.status(201).json(new ApiResponse(201, channel, "Direct message ready"));
});

export const createGroup = asyncHandler(async (req: Request, res: Response) => {
  const channel = await channelService.createGroup(req.orgId!, req.user!.id, req.body);
  channel.memberIds.forEach((memberId) => {
    if (memberId.toString() !== req.user!.id) emitToUser(memberId.toString(), "chat:channel:created", { channel });
  });
  res.status(201).json(new ApiResponse(201, channel, "Group created"));
});

export const updateGroup = asyncHandler(async (req: Request, res: Response) => {
  const channel = await channelService.updateGroup(req.orgId!, req.params.id, req.user!.id, req.body);
  channel.memberIds.forEach((memberId) => emitToUser(memberId.toString(), "chat:channel:updated", { channel }));
  res.json(new ApiResponse(200, channel, "Channel updated"));
});

export const deleteGroup = asyncHandler(async (req: Request, res: Response) => {
  await channelService.deleteGroup(req.orgId!, req.params.id, req.user!.id);
  res.json(new ApiResponse(200, null, "Channel deleted"));
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  await channelService.markRead(req.orgId!, req.params.id, req.user!.id, req.isSuperAdmin!);
  res.json(new ApiResponse(200, null, "Marked read"));
});

export const markUnread = asyncHandler(async (req: Request, res: Response) => {
  await channelService.markUnread(req.orgId!, req.params.id, req.user!.id, req.isSuperAdmin!);
  res.json(new ApiResponse(200, null, "Marked unread"));
});

export const setPinned = asyncHandler(async (req: Request, res: Response) => {
  await channelService.setPinned(req.params.id, req.user!.id, req.isSuperAdmin!, req.body.pinned);
  res.json(new ApiResponse(200, null, req.body.pinned ? "Pinned" : "Unpinned"));
});

export const setMuted = asyncHandler(async (req: Request, res: Response) => {
  await channelService.setMuted(req.params.id, req.user!.id, req.isSuperAdmin!, req.body.muted);
  res.json(new ApiResponse(200, null, req.body.muted ? "Muted" : "Unmuted"));
});

export const hideDm = asyncHandler(async (req: Request, res: Response) => {
  await channelService.hideDm(req.params.id, req.user!.id, req.isSuperAdmin!);
  res.json(new ApiResponse(200, null, "Conversation removed"));
});
