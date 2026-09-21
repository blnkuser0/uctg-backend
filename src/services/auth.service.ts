import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { User, IUser } from "../models/User.model";
import { Organization } from "../models/Organization.model";
import { Role } from "../models/Role.model";
import { ALL_PERMISSIONS } from "../constants/permissions";
import { jwtService } from "./jwt.service";
import { mailService } from "./mail.service";
import { ApiError } from "../utils/ApiError";
import { slugify } from "../utils/slugify";
import { config } from "../config";

const SALT_ROUNDS = 10;
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function buildTokens(user: IUser): AuthTokens {
  const accessToken = jwtService.signAccessToken({
    sub: user._id.toString(),
    email: user.email,
    name: user.name,
  });
  const refreshToken = jwtService.signRefreshToken({
    sub: user._id.toString(),
    tokenVersion: user.tokenVersion,
  });
  return { accessToken, refreshToken };
}

async function generateUniqueSlug(organizationName: string, session?: mongoose.ClientSession): Promise<string> {
  const base = slugify(organizationName);
  let slug = base;
  let attempt = 1;
  while (true) {
    const query = Organization.findOne({ slug });
    if (session) query.session(session);
    const existing = await query;
    if (!existing) return slug;
    attempt += 1;
    slug = `${base}-${attempt}`;
  }
}

async function registerOrganizationWithoutTransaction(input: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}): Promise<IUser> {
  const slug = await generateUniqueSlug(input.organizationName);
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  let organizationId: mongoose.Types.ObjectId | null = null;
  let roleId: mongoose.Types.ObjectId | null = null;
  let userId: mongoose.Types.ObjectId | null = null;

  try {
    const organization = await Organization.create({
      name: input.organizationName,
      slug,
      createdBy: new mongoose.Types.ObjectId(),
    });
    organizationId = organization._id;

    const adminRole = await Role.create({
      organizationId: organization._id,
      name: "Admin",
      permissions: ALL_PERMISSIONS,
    });
    roleId = adminRole._id;

    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      organizationId: organization._id,
      roleId: adminRole._id,
    });
    userId = user._id;

    organization.createdBy = user._id;
    await organization.save();

    return (await user.populate("roleId")) as unknown as IUser;
  } catch (error) {
    if (userId) await User.deleteOne({ _id: userId });
    if (roleId) await Role.deleteOne({ _id: roleId });
    if (organizationId) await Organization.deleteOne({ _id: organizationId });
    throw error;
  }
}

// Exported directly (not via the authService object below) — only
// platform.service.ts should call this now, gated behind Super Admin.
// Keeping it off the authService object is a defense-in-depth: an accidental
// future public-route wire-up via authService.registerOrganization becomes a
// compile error instead of a silent hole.
export async function registerOrganization(input: {
  organizationName: string;
  name: string;
  email: string;
  password: string;
}): Promise<IUser> {
  const existingUser = await User.findOne({ email: input.email });
  if (existingUser) {
    throw ApiError.conflict("A user with this email already exists");
  }

  const session = await mongoose.startSession();
  let transactionError: unknown;
  try {
    let createdUser: IUser | null = null;

    await session.withTransaction(async () => {
      const slug = await generateUniqueSlug(input.organizationName, session);
      const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

      const [organization] = await Organization.create(
        [{ name: input.organizationName, slug, createdBy: new mongoose.Types.ObjectId() }],
        { session }
      );

      const [adminRole] = await Role.create(
        [{ organizationId: organization._id, name: "Admin", permissions: ALL_PERMISSIONS }],
        { session }
      );

      const [user] = await User.create(
        [
          {
            name: input.name,
            email: input.email,
            passwordHash,
            organizationId: organization._id,
            roleId: adminRole._id,
          },
        ],
        { session }
      );

      organization.createdBy = user._id;
      await organization.save({ session });

      createdUser = user;
    });

    return (await createdUser!.populate("roleId")) as unknown as IUser;
  } catch (error) {
    transactionError = error;
  } finally {
    await session.endSession();
  }

  if (transactionError instanceof Error && transactionError.message.includes("Transaction numbers are only allowed")) {
    return registerOrganizationWithoutTransaction(input);
  }

  throw transactionError;
}

// Credentials are usually copy-pasted from an email or chat message, which routinely drags
// along a trailing space/newline or an invisible zero-width character. Accept the password
// as typed first, then with that junk removed — it still has to match the stored hash exactly.
const INVISIBLE_CHARS = /[\u200B-\u200D\u2060\uFEFF]/g;

async function passwordMatches(entered: string, hash: string): Promise<boolean> {
  const candidates = new Set([entered, entered.trim(), entered.replace(INVISIBLE_CHARS, "").trim()]);
  for (const candidate of candidates) {
    if (candidate && (await bcrypt.compare(candidate, hash))) return true;
  }
  return false;
}

async function login(input: { email: string; password: string }): Promise<{ user: IUser; tokens: AuthTokens }> {
  const user = await User.findOne({ email: input.email }).select("+passwordHash");
  if (!user) {
    throw ApiError.unauthorized("Invalid email or password");
  }
  if (!user.isActive) {
    throw ApiError.forbidden("Account is deactivated");
  }

  if (!(await passwordMatches(input.password, user.passwordHash))) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  user.lastLoginAt = new Date();
  await user.save();

  return { user, tokens: buildTokens(user) };
}

async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  let payload;
  try {
    payload = jwtService.verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }
  if (user.tokenVersion !== payload.tokenVersion) {
    throw ApiError.unauthorized("Refresh token has been revoked");
  }

  return buildTokens(user);
}

async function logout(userId: string): Promise<void> {
  await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } });
}

async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<AuthTokens> {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw ApiError.notFound("User not found");

  if (!(await passwordMatches(currentPassword, user.passwordHash))) throw ApiError.badRequest("Current password is incorrect");

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  user.mustChangePassword = false;
  user.tokenVersion += 1; // invalidate existing refresh tokens
  await user.save();
  return buildTokens(user);
}

async function requestPasswordReset(email: string): Promise<void> {
  const user = await User.findOne({ email });
  // Always behave the same whether or not the account exists, so this
  // endpoint can't be used to enumerate registered emails.
  if (!user || !user.isActive) return;

  const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");
  user.passwordResetTokenHash = hashResetToken(token);
  user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await user.save();

  const resetUrl = `${config.server.clientUrl}/reset-password?token=${token}`;
  await mailService.sendPasswordResetEmail(user.email, resetUrl);
}

async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashResetToken(token);
  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpires: { $gt: new Date() },
  }).select("+passwordResetTokenHash +passwordResetExpires");

  if (!user) {
    throw ApiError.badRequest("This reset link is invalid or has expired");
  }

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  user.passwordResetTokenHash = null;
  user.passwordResetExpires = null;
  user.mustChangePassword = false;
  user.tokenVersion += 1; // invalidate existing refresh tokens
  await user.save();
}

export const authService = {
  login,
  refreshTokens,
  logout,
  changePassword,
  requestPasswordReset,
  resetPassword,
};
