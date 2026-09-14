import { z } from "zod";
import { TASK_PRIORITIES } from "../constants/taskEnums";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createTaskSchema = z.object({
  stageId: objectId,
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20000).optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  assigneeIds: z.array(objectId).optional(),
  labelIds: z.array(objectId).optional(),
  startDate: z.coerce.date().nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  parentTaskId: objectId.nullable().optional(),
  estimateMinutes: z.number().int().positive().nullable().optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(20000).optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  assigneeIds: z.array(objectId).optional(),
  labelIds: z.array(objectId).optional(),
  startDate: z.coerce.date().nullable().optional(),
  deadline: z.coerce.date().nullable().optional(),
  estimateMinutes: z.number().int().positive().nullable().optional(),
});

export const moveTaskSchema = z.object({
  stageId: objectId,
  order: z.number(),
});

export const listTasksQuerySchema = z.object({
  stageId: objectId.optional(),
  assigneeId: objectId.optional(),
  labelId: objectId.optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  q: z.string().trim().max(200).optional(),
  includeSubtasks: z.coerce.boolean().optional(),
});

export const createSubtaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(20000).optional(),
  priority: z.enum(TASK_PRIORITIES).nullable().optional(),
  assigneeIds: z.array(objectId).optional(),
});

export const createChecklistItemSchema = z.object({
  text: z.string().trim().min(1).max(300),
});

export const updateChecklistItemSchema = z.object({
  text: z.string().trim().min(1).max(300).optional(),
  isChecked: z.boolean().optional(),
});

export const reorderChecklistItemsSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});
