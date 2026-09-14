import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { PERMISSIONS } from "../constants/permissions";
import { projectService } from "../services/project.service";
import { reportService } from "../services/report.service";
import { emitToProject } from "../utils/socketEmitter";

export const createProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await projectService.createProject(req.orgId!, req.user!.id, req.body);
  res.status(201).json(new ApiResponse(201, project, "Project created"));
});

export const listProjects = asyncHandler(async (req: Request, res: Response) => {
  const wantsAll = req.query.all === "true";
  if (wantsAll) {
    if (!req.permissions?.includes(PERMISSIONS.PROJECTS_MANAGE)) {
      throw ApiError.forbidden("You do not have permission to view every project");
    }
    const projects = await projectService.listAllProjects(req.orgId!);
    res.json(new ApiResponse(200, projects, "All projects"));
    return;
  }

  const projects = await projectService.listMyProjects(req.orgId!, req.user!.id);
  res.json(new ApiResponse(200, projects, "Your projects"));
});

export const getProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await projectService.assertProjectAccess(req.orgId!, req.params.id, req.user!.id, req.permissions!);
  res.json(new ApiResponse(200, project, "Project"));
});

export const getReport = asyncHandler(async (req: Request, res: Response) => {
  const report = await reportService.getProjectReport(req.orgId!, req.params.id, req.user!.id, req.permissions!);
  res.json(new ApiResponse(200, report, "Project report"));
});

export const updateProject = asyncHandler(async (req: Request, res: Response) => {
  const project = await projectService.updateProject(req.orgId!, req.params.id, req.user!.id, req.permissions!, req.body);
  emitToProject(project._id.toString(), "pm:project:updated", { project });
  res.json(new ApiResponse(200, project, "Project updated"));
});

export const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  await projectService.deleteProject(req.orgId!, req.params.id, req.user!.id, req.permissions!);
  emitToProject(req.params.id, "pm:project:deleted", { projectId: req.params.id });
  res.json(new ApiResponse(200, null, "Project deleted"));
});

export const addMember = asyncHandler(async (req: Request, res: Response) => {
  const project = await projectService.addMember(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.body.userId
  );
  emitToProject(project._id.toString(), "pm:project:updated", { project });
  res.json(new ApiResponse(200, project, "Member added"));
});

export const removeMember = asyncHandler(async (req: Request, res: Response) => {
  const project = await projectService.removeMember(
    req.orgId!,
    req.params.id,
    req.user!.id,
    req.permissions!,
    req.params.userId
  );
  emitToProject(project._id.toString(), "pm:project:updated", { project });
  res.json(new ApiResponse(200, project, "Member removed"));
});
