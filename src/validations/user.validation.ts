import { z } from "zod";
import { config } from "../config";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().email(),
  // Omitted by the UI: every new account starts on the shared temporary password.
  password: z.string().min(8).max(128).default(config.auth.newUserTempPassword),
  roleId: objectId,
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  roleId: objectId.optional(),
  isActive: z.boolean().optional(),
});

export const searchUsersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
});
