import bcrypt from "bcryptjs";
import { User, IUser } from "../models/User.model";
import { jwtService } from "./jwt.service";
import { ApiError } from "../utils/ApiError";

const SALT_ROUNDS = 10;

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function buildTokens(user: IUser): AuthTokens {
  const accessToken = jwtService.signAccessToken({
    sub: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
  });
  const refreshToken = jwtService.signRefreshToken({
    sub: user._id.toString(),
    tokenVersion: user.tokenVersion,
  });
  return { accessToken, refreshToken };
}

async function bootstrapFirstAdmin(input: { name: string; email: string; password: string }): Promise<IUser> {
  const existingCount = await User.countDocuments();
  if (existingCount > 0) {
    throw ApiError.forbidden("Registration is closed. Ask an admin to create your account.");
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    role: "admin",
  });
  return user;
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

export const authService = {
  bootstrapFirstAdmin,
  login,
  refreshTokens,
  logout,
  changePassword,
};
