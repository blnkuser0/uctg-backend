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

async function generateUniqueSlug(organizationName: string, session: mongoose.ClientSession): Promise<string> {
  const base = slugify(organizationName);
  let slug = base;
  let attempt = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await Organization.findOne({ slug }).session(session);
    if (!existing) return slug;
    attempt += 1;
    slug = `${base}-${attempt}`;
  }
}

async function registerOrganization(input: {
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
  } finally {
    await session.endSession();
  }
}

async function login(input: { email: string; password: string }): Promise<{ user: IUser; tokens: AuthTokens }> {
  const user = await User.findOne({ email: input.email }).select("+passwordHash");
  if (!user) {
    throw ApiError.unauthorized("Invalid email or password");
  }
  if (!user.isActive) {
    throw ApiError.forbidden("Account is deactivated");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
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

async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw ApiError.notFound("User not found");

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) throw ApiError.badRequest("Current password is incorrect");

  user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  user.tokenVersion += 1; // invalidate existing refresh tokens
  await user.save();
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
  user.tokenVersion += 1; // invalidate existing refresh tokens
  await user.save();
}

export const authService = {
  registerOrganization,
  login,
  refreshTokens,
  logout,
  changePassword,
  requestPasswordReset,
  resetPassword,
};
