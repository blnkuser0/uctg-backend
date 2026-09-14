import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { messageService } from "../services/message.service";
import { storageService } from "../services/storage.service";
import { emitToChannel } from "../utils/socketEmitter";

export const listForChannel = asyncHandler(async (req: Request, res: Response) => {
  const messages = await messageService.listForChannel(req.orgId!, req.params.id, req.user!.id, {
    before: req.query.before as Date | undefined,
    limit: req.query.limit as number | undefined,
  });
  res.json(new ApiResponse(200, messages, "Messages"));
});

export const createMessage = asyncHandler(async (req: Request, res: Response) => {
  const message = await messageService.createMessage(req.orgId!, req.params.id, req.user!.id, req.body);
  emitToChannel(req.params.id, "chat:message:created", { channelId: req.params.id, message });
  res.status(201).json(new ApiResponse(201, message, "Message sent"));
});

export const addAttachments = asyncHandler(async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) throw ApiError.badRequest("No files uploaded");

  const attachments = [];
  for (const file of files) {
    const stored = await storageService.upload(file, `channels/${req.params.id}`);
    attachments.push({ ...stored, uploadedBy: req.user!.id as unknown as never, createdAt: new Date() });
  }

  const message = await messageService.createMessage(req.orgId!, req.params.id, req.user!.id, {
    message: req.body.message ?? "",
    attachments,
  });
  emitToChannel(req.params.id, "chat:message:created", { channelId: req.params.id, message });
  res.status(201).json(new ApiResponse(201, message, "Attachment sent"));
});

export const updateMessage = asyncHandler(async (req: Request, res: Response) => {
  const message = await messageService.updateMessage(req.orgId!, req.params.id, req.user!.id, req.body.message);
  emitToChannel(message.channelId.toString(), "chat:message:updated", { channelId: message.channelId, message });
  res.json(new ApiResponse(200, message, "Message updated"));
});

export const deleteMessage = asyncHandler(async (req: Request, res: Response) => {
  const message = await messageService.deleteMessage(req.orgId!, req.params.id, req.user!.id);
  emitToChannel(message.channelId.toString(), "chat:message:deleted", {
    channelId: message.channelId,
    messageId: message._id,
  });
  res.json(new ApiResponse(200, null, "Message deleted"));
});
