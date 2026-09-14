export const PERMISSIONS = {
  LEAVES_VIEW_ALL: "leaves.view_all",
  LEAVES_APPROVE_HR: "leaves.approve_hr",
  LEAVES_APPROVE_ADMIN: "leaves.approve_admin",
  USERS_MANAGE: "users.manage",
  ROLES_MANAGE: "roles.manage",
  PROJECTS_MANAGE: "projects.manage",
  ATTENDANCE_VIEW_ALL: "attendance.view_all",
  ORG_MANAGE: "org.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);
