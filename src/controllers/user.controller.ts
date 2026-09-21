import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { userService, UserWithRole } from "../services/user.service";
import { mailService } from "../services/mail.service";

export function toPublicUser(user: UserWithRole) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    organizationId: user.organizationId,
    role: { id: user.roleId._id, name: user.roleId.name, permissions: user.roleId.permissions },
    avatarUrl: user.avatarUrl,
    isActive: user.isActive,
    isSuperAdmin: user.isSuperAdmin === true,
    mustChangePassword: user.mustChangePassword === true,
  };
}

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.createUser({ ...req.body, organizationId: req.orgId! });
  const credentialsEmailSent = await mailService.sendAccountCreatedEmail({
    to: user.email,
    name: user.name,
    password: req.body.password,
  });
  res.status(201).json(new ApiResponse(201, { ...toPublicUser(user), credentialsEmailSent }, "User created"));
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const users = await userService.listUsers(req.orgId!);
  res.json(new ApiResponse(200, users.map(toPublicUser), "Users list"));
});

export const searchUsers = asyncHandler(async (req: Request, res: Response) => {
  const users = await userService.searchUsers(req.orgId!, (req.query.q as string) || "");
  res.json(new ApiResponse(200, users.map(toPublicUser), "Search results"));
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateUser(req.params.id, req.orgId!, req.body);
  res.json(new ApiResponse(200, toPublicUser(user), "User updated"));
});

export const deactivateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.deactivateUser(req.params.id, req.orgId!);
  res.json(new ApiResponse(200, toPublicUser(user), "User deactivated"));
});
