import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createMessageSchema = z.object({
  message: z.string().trim().min(1).max(10000),
  mentions: z.array(objectId).optional(),
});

export const updateMessageSchema = z.object({
  message: z.string().trim().min(1).max(10000),
});

export const listMessagesQuerySchema = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
