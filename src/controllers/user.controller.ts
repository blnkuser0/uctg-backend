import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { userService } from "../services/user.service";

function toPublicUser(user: { _id: unknown; name: string; email: string; role: string; avatarUrl: string | null; isActive: boolean }) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    isActive: user.isActive,
  };
}

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.createUser(req.body);
  res.status(201).json(new ApiResponse(201, toPublicUser(user), "User created"));
});

export const listUsers = asyncHandler(async (_req: Request, res: Response) => {
  const users = await userService.listUsers();
  res.json(new ApiResponse(200, users.map(toPublicUser), "Users list"));
});

export const searchUsers = asyncHandler(async (req: Request, res: Response) => {
  const users = await userService.searchUsers((req.query.q as string) || "");
  res.json(new ApiResponse(200, users.map(toPublicUser), "Search results"));
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateUser(req.params.id, req.body);
  res.json(new ApiResponse(200, toPublicUser(user), "User updated"));
});

export const deactivateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.deactivateUser(req.params.id);
  res.json(new ApiResponse(200, toPublicUser(user), "User deactivated"));
});
