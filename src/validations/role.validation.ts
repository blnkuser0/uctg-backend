import { z } from "zod";
import { ALL_PERMISSIONS } from "../constants/permissions";

const permissionsField = z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).default([]);

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  permissions: permissionsField,
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  permissions: permissionsField.optional(),
});
