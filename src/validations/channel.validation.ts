import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createDmSchema = z.object({
  userId: objectId,
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(objectId).default([]),
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  addMemberId: objectId.optional(),
  removeMemberId: objectId.optional(),
});
