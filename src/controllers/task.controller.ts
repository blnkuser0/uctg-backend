import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { taskService } from "../services/task.service";
import { storageService } from "../services/storage.service";
import { emitToProject } from "../utils/socketEmitter";

export const listTasks = asyncHandler(async (req: Request, res: Response) => {
  const tasks = await taskService.listTasks(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.query
  );
  res.json(new ApiResponse(200, tasks, "Tasks"));
});

export const listMyTasks = asyncHandler(async (req: Request, res: Response) => {
  const tasks = await taskService.listMyTasks(req.user!.id);
  res.json(new ApiResponse(200, tasks, "My tasks"));
});

export const createTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskService.createTask(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body
  );
  emitToProject(req.params.id, "pm:task:created", { task });
  res.status(201).json(new ApiResponse(201, task, "Task created"));
});

export const getTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskService.getTaskForAccess(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!
  );
  res.json(new ApiResponse(200, task, "Task"));
});

export const updateTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskService.updateTask(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body
  );
  emitToProject(task.projectId.toString(), "pm:task:updated", { task });
  res.json(new ApiResponse(200, task, "Task updated"));
});

export const deleteTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskService.deleteTask(req.orgId!, req.params.id, req.user!.id, req.permissions!, req.isSuperAdmin!);
  emitToProject(task.projectId.toString(), "pm:task:deleted", { taskId: task._id, projectId: task.projectId });
  res.json(new ApiResponse(200, null, "Task deleted"));
});

export const moveTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskService.moveTask(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body
  );
  emitToProject(task.projectId.toString(), "pm:task:moved", { task });
  res.json(new ApiResponse(200, task, "Task moved"));
});

export const createSubtask = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskService.createSubtask(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body
  );
  emitToProject(task.projectId.toString(), "pm:task:created", { task });
  res.status(201).json(new ApiResponse(201, task, "Subtask created"));
});

export const listSubtasks = asyncHandler(async (req: Request, res: Response) => {
  const subtasks = await taskService.listSubtasks(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!
  );
  res.json(new ApiResponse(200, subtasks, "Subtasks"));
});

export const addChecklistItem = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskService.addChecklistItem(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body.text
  );
  emitToProject(task.projectId.toString(), "pm:task:checklist:updated", {
    taskId: task._id,
    checklist: task.checklist,
    checklistProgress: task.checklistProgress,
  });
  res.status(201).json(new ApiResponse(201, task, "Checklist item added"));
});

export const updateChecklistItem = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskService.updateChecklistItem(
    req.orgId!,
    req.params.id,
    req.params.itemId,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body
  );
  emitToProject(task.projectId.toString(), "pm:task:checklist:updated", {
    taskId: task._id,
    checklist: task.checklist,
    checklistProgress: task.checklistProgress,
  });
  res.json(new ApiResponse(200, task, "Checklist item updated"));
});

export const deleteChecklistItem = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskService.deleteChecklistItem(
    req.orgId!,
    req.params.id,
    req.params.itemId,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!
  );
  emitToProject(task.projectId.toString(), "pm:task:checklist:updated", {
    taskId: task._id,
    checklist: task.checklist,
    checklistProgress: task.checklistProgress,
  });
  res.json(new ApiResponse(200, task, "Checklist item removed"));
});

export const reorderChecklistItems = asyncHandler(async (req: Request, res: Response) => {
  const task = await taskService.reorderChecklistItems(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!,
    req.body.orderedIds
  );
  emitToProject(task.projectId.toString(), "pm:task:checklist:updated", {
    taskId: task._id,
    checklist: task.checklist,
    checklistProgress: task.checklistProgress,
  });
  res.json(new ApiResponse(200, task, "Checklist reordered"));
});

export const addAttachment = asyncHandler(async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) throw ApiError.badRequest("No files uploaded");

  let task;
  for (const file of files) {
    const stored = await storageService.upload(file, `tasks/${req.params.id}`);
    task = await taskService.addAttachment(
      req.orgId!,
      req.params.id,
      req.user!.id,
      req.permissions!,
      req.isSuperAdmin!,
      {
        ...stored,
        uploadedBy: req.user!.id as unknown as never,
        createdAt: new Date(),
      }
    );
  }

  emitToProject(task!.projectId.toString(), "pm:task:updated", { task });
  res.status(201).json(new ApiResponse(201, task, "Attachment(s) uploaded"));
});

export const removeAttachment = asyncHandler(async (req: Request, res: Response) => {
  const { task, removedKey } = await taskService.removeAttachment(
    req.orgId!,
    req.params.id,
    req.params.attachmentId,
    req.user!.id,
    req.permissions!,
    req.isSuperAdmin!
  );
  if (removedKey) await storageService.remove(removedKey);
  emitToProject(task.projectId.toString(), "pm:task:updated", { task });
  res.json(new ApiResponse(200, task, "Attachment removed"));
});
