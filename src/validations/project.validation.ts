import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, "2-10 letters/numbers")
    .optional(),
  description: z.string().trim().max(2000).optional(),
  color: z.string().trim().max(20).optional(),
  organizationId: objectId.optional(),
  memberIds: z.array(objectId).max(50).optional(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  color: z.string().trim().max(20).optional(),
  status: z.enum(["active", "archived"]).optional(),
});

export const addMemberSchema = z.object({
  userId: objectId,
});
