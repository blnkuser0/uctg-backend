import { ALL_PERMISSIONS, PERMISSIONS, Permission } from "./permissions";

export const SYSTEM_ROLES = ["SUPER_ADMIN", "CLIENT_ADMIN", "DEVELOPER"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const UMBRELLA_ORGANIZATION_SLUG = "ugnexa-umbrella";

export const ROLE_PERMISSIONS: Record<SystemRole, Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,
  CLIENT_ADMIN: [
    PERMISSIONS.PROJECTS_MANAGE,
    PERMISSIONS.ATTENDANCE_VIEW_ALL,
    PERMISSIONS.LEAVES_VIEW_ALL,
    PERMISSIONS.LEAVES_APPROVE_HR,
    PERMISSIONS.LEAVES_APPROVE_ADMIN,
    PERMISSIONS.ORG_MANAGE,
  ],
  DEVELOPER: [],
};

export function isSystemRole(value: unknown): value is SystemRole {
  return typeof value === "string" && SYSTEM_ROLES.includes(value as SystemRole);
}
