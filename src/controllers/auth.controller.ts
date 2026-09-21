import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { authService } from "../services/auth.service";
import { userService } from "../services/user.service";
import { storageService } from "../services/storage.service";
import { IRole } from "../models/Role.model";
import { config } from "../config";
import { durationToMs } from "../utils/duration";

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  // Tied to the refresh token's own lifetime: a cookie that expires before the
  // token it holds (it used to be a hard-coded 7 days) silently logs users out.
  maxAge: durationToMs(config.jwt.refreshExpiresIn, 7 * 24 * 60 * 60 * 1000),
};

function toPublicUser(user: {
  _id: unknown;
  name: string;
  email: string;
  organizationId: unknown;
  roleId: unknown;
  avatarUrl: string | null;
  isSuperAdmin?: boolean;
  mustChangePassword?: boolean;
}) {
  const isPopulated = !!user.roleId && typeof user.roleId === "object" && "name" in user.roleId;
  const role = isPopulated
    ? {
        id: (user.roleId as IRole)._id,
        name: (user.roleId as IRole).name,
        permissions: (user.roleId as IRole).permissions,
      }
    : { id: user.roleId, name: null, permissions: [] };

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    organizationId: user.organizationId,
    role,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin === true,
    mustChangePassword: user.mustChangePassword === true,
  };
}

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { user, tokens } = await authService.login(req.body);
  const fullUser = await userService.getUserById(user._id.toString());
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
  res.json(
    new ApiResponse(
      200,
      { user: toPublicUser(fullUser), accessToken: tokens.accessToken },
      "Logged in successfully"
    )
  );
});

export const refreshTokens = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!refreshToken) throw ApiError.unauthorized("No refresh token provided");

  const tokens = await authService.refreshTokens(refreshToken);
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
  res.json(new ApiResponse(200, { accessToken: tokens.accessToken }, "Token refreshed"));
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  if (req.user) await authService.logout(req.user.id);
  res.clearCookie(REFRESH_COOKIE_NAME);
  res.json(new ApiResponse(200, null, "Logged out"));
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.getUserById(req.user!.id);
  res.json(new ApiResponse(200, toPublicUser(user), "Current user"));
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateUser(req.user!.id, req.orgId!, req.body);
  res.json(new ApiResponse(200, toPublicUser(user), "Profile updated"));
});

export const uploadAvatar = asyncHandler(async (req: Request, res: Response) => {
  const file = req.file as Express.Multer.File | undefined;
  if (!file) throw ApiError.badRequest("No file uploaded");

  const stored = await storageService.upload(file, `avatars/${req.user!.id}`);
  const user = await userService.updateUser(req.user!.id, req.orgId!, { avatarUrl: stored.url });
  res.json(new ApiResponse(200, toPublicUser(user), "Avatar updated"));
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  // Every other session is revoked, but the one that just changed the password
  // gets fresh tokens so it is not logged out when its access token expires.
  const tokens = await authService.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
  res.json(new ApiResponse(200, { accessToken: tokens.accessToken }, "Password changed"));
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.requestPasswordReset(req.body.email);
  res.json(new ApiResponse(200, null, "If an account exists for that email, a reset link has been sent."));
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  res.json(new ApiResponse(200, null, "Password reset. Please log in with your new password."));
});
