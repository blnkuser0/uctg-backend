import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createCommentSchema = z.object({
  message: z.string().trim().min(1).max(10000),
  mentions: z.array(objectId).optional(),
});

export const updateCommentSchema = z.object({
  message: z.string().trim().min(1).max(10000),
});
