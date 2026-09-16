import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { platformService } from "../services/platform.service";
import { toPublicUser } from "./user.controller";

export const createOrganization = asyncHandler(async (req: Request, res: Response) => {
  const admin = await platformService.createClientOrganization(req.body);
  res.status(201).json(new ApiResponse(201, admin, "Organization created"));
});

export const listOrganizations = asyncHandler(async (_req: Request, res: Response) => {
  const organizations = await platformService.listAllOrganizations();
  res.json(new ApiResponse(200, organizations, "Organizations"));
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const user = req.body.isDeveloper
    ? await platformService.createDeveloperUser(req.body)
    : await platformService.createClientOrgUser(req.body);
  res.status(201).json(new ApiResponse(201, toPublicUser(user), "User created"));
});

export const listDevelopers = asyncHandler(async (_req: Request, res: Response) => {
  const developers = await platformService.listDevelopers();
  res.json(new ApiResponse(200, developers.map(toPublicUser), "Developers"));
});

export const listAllProjects = asyncHandler(async (_req: Request, res: Response) => {
  const projects = await platformService.listAllProjectsPlatformWide();
  res.json(new ApiResponse(200, projects, "All projects"));
});

export const assignDeveloper = asyncHandler(async (req: Request, res: Response) => {
  const project = await platformService.assignDeveloperToProject(
    req.orgId!,
    req.user!.id,
    req.params.id,
    req.body.userId
  );
  res.json(new ApiResponse(200, project, "Developer assigned"));
});

export const unassignDeveloper = asyncHandler(async (req: Request, res: Response) => {
  const project = await platformService.unassignDeveloperFromProject(
    req.orgId!,
    req.user!.id,
    req.params.id,
    req.params.userId
  );
  res.json(new ApiResponse(200, project, "Developer unassigned"));
});
