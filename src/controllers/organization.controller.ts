import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { organizationService } from "../services/organization.service";

export const getOrganization = asyncHandler(async (req: Request, res: Response) => {
  const org = await organizationService.getOrganization(req.orgId!);
  res.json(new ApiResponse(200, org, "Organization"));
});

export const updateOrganization = asyncHandler(async (req: Request, res: Response) => {
  const org = await organizationService.updateOrganization(req.orgId!, req.body);
  res.json(new ApiResponse(200, org, "Organization updated"));
});
