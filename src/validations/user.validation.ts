import { z } from "zod";
import { SYSTEM_ROLES } from "../constants/roles";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  role: z.enum(SYSTEM_ROLES),
  organizationId: objectId.optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(SYSTEM_ROLES).optional(),
  organizationId: objectId.optional(),
  isActive: z.boolean().optional(),
});

export const searchUsersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
});
