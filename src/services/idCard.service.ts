import { User, IUser, nextEmployeeId, generateIdToken } from "../models/User.model";
import { IRole } from "../models/Role.model";
import { Organization } from "../models/Organization.model";
import { ApiError } from "../utils/ApiError";

type UserWithRole = Omit<IUser, "roleId"> & { roleId: IRole };

export interface IdCard {
  userId: string;
  employeeId: string;
  verifyToken: string;
  name: string;
  role: string | null;
  organization: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  issuedAt: Date;
}

// Accounts created before ID cards existed have neither field. Filling them
// in on first request means no migration script is needed.
async function ensureIdentity(userId: string): Promise<void> {
  const user = await User.findById(userId).select("employeeId +idToken");
  if (!user) throw ApiError.notFound("User not found");

  if (!user.employeeId) {
    await User.updateOne({ _id: userId, employeeId: { $exists: false } }, { $set: { employeeId: await nextEmployeeId() } });
  }
  if (!user.idToken) {
    await User.updateOne({ _id: userId, idToken: { $exists: false } }, { $set: { idToken: generateIdToken() } });
  }
}

async function getIdCard(userId: string): Promise<IdCard> {
  await ensureIdentity(userId);

  const user = await User.findById(userId).select("+idToken").populate<{ roleId: IRole }>("roleId");
  if (!user) throw ApiError.notFound("User not found");
  const organization = await Organization.findById(user.organizationId).select("name");

  return {
    userId: user._id.toString(),
    employeeId: user.employeeId!,
    verifyToken: user.idToken!,
    name: user.name,
    role: user.roleId?.name ?? null,
    organization: organization?.name ?? null,
    avatarUrl: user.avatarUrl,
    isActive: user.isActive,
    issuedAt: user.createdAt,
  };
}

// Public — what a stranger sees after scanning the QR. Deliberately leaves out
// email, ids and anything else that isn't on the printed card itself.
async function verifyByToken(token: string) {
  const user = await User.findOne({ idToken: token }).populate<{ roleId: IRole }>("roleId");
  if (!user) throw ApiError.notFound("This ID could not be verified");
  const organization = await Organization.findById(user.organizationId).select("name");

  return {
    name: user.name,
    employeeId: user.employeeId ?? null,
    role: (user as unknown as UserWithRole).roleId?.name ?? null,
    organization: organization?.name ?? null,
    avatarUrl: user.avatarUrl,
    isActive: user.isActive,
  };
}

export const idCardService = { getIdCard, verifyByToken };
