import bcrypt from "bcryptjs";
import { User, IUser } from "../models/User.model";
import { IRole } from "../models/Role.model";
import { ApiError } from "../utils/ApiError";
import { SystemRole } from "../constants/roles";
import { resolveProvisioningRole } from "./platform.service";

const SALT_ROUNDS = 10;

export type UserWithRole = Omit<IUser, "roleId"> & { roleId: IRole };

async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: SystemRole;
  organizationId?: string;
}): Promise<UserWithRole> {
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw ApiError.conflict("A user with this email already exists");
  }
  const { role, organization } = await resolveProvisioningRole(input.role, input.organizationId);

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    roleId: role._id,
    organizationId: organization._id,
  });
  return user.populate<{ roleId: IRole }>("roleId");
}

async function listUsers(): Promise<UserWithRole[]> {
  return User.find({}).populate<{ roleId: IRole }>("roleId").sort({ name: 1 });
}

async function searchUsers(query: string): Promise<UserWithRole[]> {
  if (!query) return listUsers();
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return User.find({ $or: [{ name: regex }, { email: regex }] })
    .populate<{ roleId: IRole }>("roleId")
    .limit(20)
    .sort({ name: 1 });
}

async function getUserById(userId: string): Promise<UserWithRole> {
  const user = await User.findById(userId).populate<{ roleId: IRole }>("roleId");
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

async function updateProvisionedUser(
  userId: string,
  updates: Partial<Pick<IUser, "name" | "isActive" | "avatarUrl">> & { role?: SystemRole; organizationId?: string }
): Promise<UserWithRole> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound("User not found");
  if (updates.role) {
    const resolved = await resolveProvisioningRole(updates.role, updates.organizationId);
    user.roleId = resolved.role._id;
    user.organizationId = resolved.organization._id;
  }
  if (updates.name !== undefined) user.name = updates.name;
  if (updates.isActive !== undefined) user.isActive = updates.isActive;
  if (updates.avatarUrl !== undefined) user.avatarUrl = updates.avatarUrl;
  await user.save();

  return user.populate<{
    roleId: IRole;
  }>("roleId");
}

async function updateProfile(
  userId: string,
  organizationId: string,
  updates: Partial<Pick<IUser, "name" | "avatarUrl">>
): Promise<UserWithRole> {
  const user = await User.findOneAndUpdate({ _id: userId, organizationId }, updates, { new: true }).populate<{
    roleId: IRole;
  }>("roleId");
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

async function deactivateUser(userId: string): Promise<UserWithRole> {
  const user = await User.findOneAndUpdate(
    { _id: userId },
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
  updateProvisionedUser,
  updateProfile,
  deactivateUser,
};
