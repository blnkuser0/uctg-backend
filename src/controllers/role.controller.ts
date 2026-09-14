import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { IRole } from "../models/Role.model";
import { roleService, RoleWithUserCount } from "../services/role.service";

function toPublicRole(role: IRole) {
  return {
    id: role._id,
    name: role.name,
    permissions: role.permissions,
  };
}

function toPublicRoleWithCount({ role, userCount }: RoleWithUserCount) {
  return { ...toPublicRole(role), userCount };
}

export const createRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await roleService.createRole(req.orgId!, req.body);
  res.status(201).json(new ApiResponse(201, toPublicRole(role), "Role created"));
});

export const listRoles = asyncHandler(async (req: Request, res: Response) => {
  const roles = await roleService.listRoles(req.orgId!);
  res.json(new ApiResponse(200, roles.map(toPublicRoleWithCount), "Roles"));
});

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await roleService.updateRole(req.orgId!, req.params.id, req.body);
  res.json(new ApiResponse(200, toPublicRole(role), "Role updated"));
});

export const deleteRole = asyncHandler(async (req: Request, res: Response) => {
  await roleService.deleteRole(req.orgId!, req.params.id);
  res.json(new ApiResponse(200, null, "Role deleted"));
});
