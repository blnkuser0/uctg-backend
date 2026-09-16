import { z } from "zod";

// registerSchema moved to validations/platform.validation.ts as
// createOrgSchema — registration is Super-Admin-only now, reached via
// /api/platform/organizations, not this file's routes.

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

export const updateMeSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});
