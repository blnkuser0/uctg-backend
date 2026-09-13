import { z } from "zod";
import { USER_ROLES } from "../models/User.model";

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128),
  role: z.enum(USER_ROLES).default("member"),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(USER_ROLES).optional(),
  isActive: z.boolean().optional(),
});

export const searchUsersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
});
