import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { commentService } from "../services/comment.service";
import { emitToProject } from "../utils/socketEmitter";

export const listForTask = asyncHandler(async (req: Request, res: Response) => {
  const comments = await commentService.listForTask(req.orgId!, req.params.id, req.user!.id, req.permissions!);
  res.json(new ApiResponse(200, comments, "Comments"));
});

export const createComment = asyncHandler(async (req: Request, res: Response) => {
  const comment = await commentService.createComment(req.orgId!, req.params.id, req.user!.id, req.permissions!, req.body);
  emitToProject(comment.projectId.toString(), "pm:comment:created", { taskId: req.params.id, comment });
  res.status(201).json(new ApiResponse(201, comment, "Comment posted"));
});

export const updateComment = asyncHandler(async (req: Request, res: Response) => {
  const comment = await commentService.updateComment(req.orgId!, req.params.id, req.user!.id, req.body.message);
  emitToProject(comment.projectId.toString(), "pm:comment:updated", { taskId: comment.taskId, comment });
  res.json(new ApiResponse(200, comment, "Comment updated"));
});

export const deleteComment = asyncHandler(async (req: Request, res: Response) => {
  const comment = await commentService.deleteComment(req.orgId!, req.params.id, req.user!.id);
  emitToProject(comment.projectId.toString(), "pm:comment:deleted", { taskId: comment.taskId, commentId: comment._id });
  res.json(new ApiResponse(200, null, "Comment deleted"));
});
