import { Types } from "mongoose";
import { Role, IRole } from "../models/Role.model";
import { User } from "../models/User.model";
import { PERMISSIONS, Permission } from "../constants/permissions";
import { ApiError } from "../utils/ApiError";
import { SystemRole } from "../constants/roles";

export interface RoleWithUserCount {
  role: IRole;
  userCount: number;
}

async function createRole(
  organizationId: string,
  input: { name: SystemRole; permissions: Permission[] }
): Promise<IRole> {
  const existing = await Role.findOne({ organizationId, name: input.name });
  if (existing) throw ApiError.conflict("A role with this name already exists");

  return Role.create({ organizationId, name: input.name, permissions: input.permissions });
}

async function listRoles(organizationId: string): Promise<RoleWithUserCount[]> {
  const roles = await Role.find({ organizationId }).sort({ createdAt: 1 });
  const counts = await User.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { organizationId: new Types.ObjectId(organizationId) } },
    { $group: { _id: "$roleId", count: { $sum: 1 } } },
  ]);
  const countByRoleId = new Map(counts.map((c) => [c._id.toString(), c.count]));

  return roles.map((role) => ({ role, userCount: countByRoleId.get(role._id.toString()) ?? 0 }));
}

async function getByIdInOrg(organizationId: string, roleId: string): Promise<IRole> {
  const role = await Role.findOne({ _id: roleId, organizationId });
  if (!role) throw ApiError.notFound("Role not found");
  return role;
}

/** Active users in the org whose role grants the given permission — e.g. everyone who can approve leaves. */
async function listUserIdsWithPermission(organizationId: string, permission: Permission): Promise<string[]> {
  const roles = await Role.find({ organizationId, permissions: permission }, { _id: 1 });
  if (roles.length === 0) return [];

  const users = await User.find(
    { organizationId, roleId: { $in: roles.map((r) => r._id) }, isActive: true },
    { _id: 1 }
  );
  return users.map((u) => u._id.toString());
}

/** Would the org have zero roles left holding ROLES_MANAGE after this role ends up with `nextPermissions`? */
async function wouldStripLastRoleManager(
  organizationId: string,
  roleId: string,
  nextPermissions: Permission[]
): Promise<boolean> {
  if (nextPermissions.includes(PERMISSIONS.ROLES_MANAGE)) return false;

  const otherRoleWithManage = await Role.findOne({
    organizationId,
    _id: { $ne: roleId },
    permissions: PERMISSIONS.ROLES_MANAGE,
  });
  return !otherRoleWithManage;
}

async function updateRole(
  organizationId: string,
  roleId: string,
  updates: { name?: SystemRole; permissions?: Permission[] }
): Promise<IRole> {
  const role = await getByIdInOrg(organizationId, roleId);

  const nextPermissions = updates.permissions ?? (role.permissions as Permission[]);
  if (await wouldStripLastRoleManager(organizationId, roleId, nextPermissions)) {
    throw ApiError.badRequest("This would leave no role able to manage roles — keep at least one.");
  }

  if (updates.name) role.name = updates.name;
  if (updates.permissions) role.permissions = updates.permissions;
  await role.save();
  return role;
}

async function deleteRole(organizationId: string, roleId: string): Promise<void> {
  const role = await getByIdInOrg(organizationId, roleId);

  const assignedCount = await User.countDocuments({ organizationId, roleId: role._id });
  if (assignedCount > 0) {
    throw ApiError.conflict(`${assignedCount} user(s) still have this role — reassign them first`);
  }

  await role.deleteOne();
}

export const roleService = {
  createRole,
  listRoles,
  updateRole,
  deleteRole,
  listUserIdsWithPermission,
};
