import bcrypt from "bcryptjs";
import { User, IUser } from "../models/User.model";
import { Role, IRole } from "../models/Role.model";
import { ApiError } from "../utils/ApiError";

const SALT_ROUNDS = 10;

export type UserWithRole = Omit<IUser, "roleId"> & { roleId: IRole };

async function assertRoleInOrg(organizationId: string, roleId: string): Promise<void> {
  const role = await Role.findOne({ _id: roleId, organizationId });
  if (!role) throw ApiError.badRequest("That role does not belong to your organization");
}

async function createUser(input: {
  name: string;
  email: string;
  password: string;
  roleId: string;
  organizationId: string;
}): Promise<UserWithRole> {
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw ApiError.conflict("A user with this email already exists");
  }
  await assertRoleInOrg(input.organizationId, input.roleId);

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    roleId: input.roleId,
    organizationId: input.organizationId,
  });
  return user.populate<{ roleId: IRole }>("roleId");
}

async function listUsers(organizationId: string): Promise<UserWithRole[]> {
  return User.find({ organizationId }).populate<{ roleId: IRole }>("roleId").sort({ name: 1 });
}

async function searchUsers(organizationId: string, query: string): Promise<UserWithRole[]> {
  if (!query) return listUsers(organizationId);
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return User.find({ organizationId, $or: [{ name: regex }, { email: regex }] })
    .populate<{ roleId: IRole }>("roleId")
    .limit(20)
    .sort({ name: 1 });
}

async function getUserById(userId: string): Promise<UserWithRole> {
  const user = await User.findById(userId).populate<{ roleId: IRole }>("roleId");
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

async function updateUser(
  userId: string,
  organizationId: string,
  updates: Partial<Pick<IUser, "name" | "isActive" | "avatarUrl">> & { roleId?: string }
): Promise<UserWithRole> {
  if (updates.roleId) await assertRoleInOrg(organizationId, updates.roleId);

  const user = await User.findOneAndUpdate({ _id: userId, organizationId }, updates, { new: true }).populate<{
    roleId: IRole;
  }>("roleId");
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

async function deactivateUser(userId: string, organizationId: string): Promise<UserWithRole> {
  const user = await User.findOneAndUpdate(
    { _id: userId, organizationId },
    { isActive: false, $inc: { tokenVersion: 1 } },
    { new: true }
  ).populate<{ roleId: IRole }>("roleId");
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

export const userService = {
  createUser,
  listUsers,
  searchUsers,
  getUserById,
  updateUser,
  deactivateUser,
};
