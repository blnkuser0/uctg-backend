import { z } from "zod";
import { ALL_PERMISSIONS } from "../constants/permissions";
import { SYSTEM_ROLES } from "../constants/roles";

const permissionsField = z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).default([]);

export const createRoleSchema = z.object({
  name: z.enum(SYSTEM_ROLES),
  permissions: permissionsField,
});

export const updateRoleSchema = z.object({
  name: z.enum(SYSTEM_ROLES).optional(),
  permissions: permissionsField.optional(),
});
