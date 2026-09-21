import bcrypt from "bcryptjs";
import { User, IUser } from "../models/User.model";
import { Role, IRole } from "../models/Role.model";
import { Project } from "../models/Project.model";
import { Task } from "../models/Task.model";
import { Channel } from "../models/Channel.model";
import { ApiError } from "../utils/ApiError";
import { nameFromEmail } from "../utils/nameFromEmail";

const SALT_ROUNDS = 10;

export type UserWithRole = Omit<IUser, "roleId"> & { roleId: IRole };

async function assertRoleInOrg(organizationId: string, roleId: string): Promise<void> {
  const role = await Role.findOne({ _id: roleId, organizationId });
  if (!role) throw ApiError.badRequest("That role does not belong to your organization");
}

async function createUser(input: {
  name?: string;
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
    name: input.name?.trim() || nameFromEmail(input.email),
    email: input.email,
    passwordHash,
    mustChangePassword: true,
    roleId: input.roleId,
    organizationId: input.organizationId,
  });
  return user.populate<{ roleId: IRole }>("roleId");
}

async function listUsers(organizationId: string): Promise<UserWithRole[]> {
  return User.find({ organizationId, deletedAt: null }).populate<{ roleId: IRole }>("roleId").sort({ name: 1 });
}

async function searchUsers(organizationId: string, query: string): Promise<UserWithRole[]> {
  if (!query) return listUsers(organizationId);
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return User.find({ organizationId, deletedAt: null, $or: [{ name: regex }, { email: regex }] })
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

  const user = await User.findOneAndUpdate({ _id: userId, organizationId, deletedAt: null }, updates, { new: true }).populate<{
    roleId: IRole;
  }>("roleId");
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

async function deactivateUser(userId: string, organizationId: string): Promise<UserWithRole> {
  const user = await User.findOneAndUpdate(
    { _id: userId, organizationId, deletedAt: null },
    { isActive: false, $inc: { tokenVersion: 1 } },
    { new: true }
  ).populate<{ roleId: IRole }>("roleId");
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

/** Removes an account from the org. It is a soft delete on purpose: hard-deleting the row would
 *  leave every comment, message, task and time record they ever wrote pointing at nobody. */
async function deleteUser(userId: string, organizationId: string, actingUserId: string): Promise<void> {
  if (userId === actingUserId) throw ApiError.badRequest("You can't delete your own account");

  const user = await User.findOne({ _id: userId, organizationId, deletedAt: null });
  if (!user) throw ApiError.notFound("User not found");
  if (user.isSuperAdmin) throw ApiError.forbidden("A Super Admin account can't be deleted here");

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        isActive: false,
        deletedAt: new Date(),
        // Frees the address so the same person can be invited again later.
        email: `deleted+${user._id.toString()}@deleted.invalid`,
        passwordResetTokenHash: null,
        passwordResetExpires: null,
      },
      $inc: { tokenVersion: 1 }, // signs out every session they still have
      $unset: { idToken: "" }, // their ID card's QR stops verifying
    }
  );

  // A deleted person shouldn't keep showing up as a project member or assignee.
  // Direct-message channels are left alone so the conversation history survives.
  await Promise.all([
    Project.updateMany({ memberIds: user._id }, { $pull: { memberIds: user._id } }),
    Task.updateMany({ assigneeIds: user._id }, { $pull: { assigneeIds: user._id } }),
    Channel.updateMany({ type: { $in: ["group", "project"] }, memberIds: user._id }, { $pull: { memberIds: user._id } }),
  ]);
}

export const userService = {
  createUser,
  listUsers,
  searchUsers,
  getUserById,
  updateUser,
  deactivateUser,
  deleteUser,
};
