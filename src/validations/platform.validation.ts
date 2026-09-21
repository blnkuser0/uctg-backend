import { z } from "zod";
import { config } from "../config";

// Same shape as the old public registerSchema (auth.validation.ts) — this is
// effectively that schema's new home, reached only via Super Admin now.
// registerSchema itself gets removed once the public /auth/register route
// does.
export const createOrgSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(128).default(config.auth.newUserTempPassword),
});

export const createPlatformUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(128).default(config.auth.newUserTempPassword),
    isDeveloper: z.boolean().default(false),
    organizationId: z.string().min(1).optional(),
    roleId: z.string().min(1).optional(),
  })
  .refine((data) => data.isDeveloper || (!!data.organizationId && !!data.roleId), {
    message: "organizationId and roleId are required unless isDeveloper is true",
  });

export const assignDeveloperSchema = z.object({
  userId: z.string().min(1),
});
