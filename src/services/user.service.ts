import bcrypt from "bcryptjs";
import { User, IUser, UserRole } from "../models/User.model";
import { ApiError } from "../utils/ApiError";

const SALT_ROUNDS = 10;

async function createUser(input: { name: string; email: string; password: string; role: UserRole }): Promise<IUser> {
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw ApiError.conflict("A user with this email already exists");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  return User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    role: input.role,
  });
}

async function listUsers(): Promise<IUser[]> {
  return User.find().sort({ name: 1 });
}

async function searchUsers(query: string): Promise<IUser[]> {
  if (!query) return listUsers();
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return User.find({ $or: [{ name: regex }, { email: regex }] })
    .limit(20)
    .sort({ name: 1 });
}

async function getUserById(userId: string): Promise<IUser> {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

async function updateUser(
  userId: string,
  updates: Partial<Pick<IUser, "name" | "role" | "isActive">>
): Promise<IUser> {
  const user = await User.findByIdAndUpdate(userId, updates, { new: true });
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

async function deactivateUser(userId: string): Promise<IUser> {
  const user = await User.findByIdAndUpdate(userId, { isActive: false, $inc: { tokenVersion: 1 } }, { new: true });
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
