import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createStageSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().trim().max(20).optional(),
  wipLimit: z.number().int().positive().nullable().optional(),
});

export const updateStageSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().trim().max(20).optional(),
  isDoneStage: z.boolean().optional(),
  wipLimit: z.number().int().positive().nullable().optional(),
});

export const reorderStagesSchema = z.object({
  orderedIds: z.array(objectId).min(1),
});

export const deleteStageSchema = z.object({
  reassignToStageId: objectId.optional(),
});
