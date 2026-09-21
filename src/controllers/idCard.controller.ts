import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { PERMISSIONS } from "../constants/permissions";
import { User } from "../models/User.model";
import { idCardService } from "../services/idCard.service";

export const getMyIdCard = asyncHandler(async (req: Request, res: Response) => {
  const card = await idCardService.getIdCard(req.user!.id);
  res.json(new ApiResponse(200, card, "ID card"));
});

// Anyone's card (they carry a QR that opens their identity) is limited to
// the platform Super Admin, or a users.manage holder within their own org.
export const getUserIdCard = asyncHandler(async (req: Request, res: Response) => {
  const target = await User.findOne({ _id: req.params.id, deletedAt: null }).select("organizationId");
  if (!target) throw ApiError.notFound("User not found");

  const sameOrgManager =
    req.permissions?.includes(PERMISSIONS.USERS_MANAGE) === true && target.organizationId.toString() === req.orgId;
  if (!req.isSuperAdmin && !sameOrgManager) {
    throw ApiError.forbidden("You do not have permission to view this ID card");
  }

  const card = await idCardService.getIdCard(req.params.id);
  res.json(new ApiResponse(200, card, "ID card"));
});

export const verifyIdCard = asyncHandler(async (req: Request, res: Response) => {
  const result = await idCardService.verifyByToken(req.params.token);
  res.json(new ApiResponse(200, result, "ID verified"));
});
