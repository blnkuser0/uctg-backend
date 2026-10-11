import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { accomplishmentService } from "../services/accomplishment.service";
import { storageService } from "../services/storage.service";
import { AccomplishmentSection } from "../models/Accomplishment.model";

export const create = asyncHandler(async (req: Request, res: Response) => {
  const entry = await accomplishmentService.create(req.orgId!, req.user!.id, req.body);
  res.status(201).json(new ApiResponse(201, entry, "Accomplishment logged"));
});

export const listMine = asyncHandler(async (req: Request, res: Response) => {
  const entries = await accomplishmentService.listMine(req.orgId!, req.user!.id, {
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
  });
  res.json(new ApiResponse(200, entries, "Your accomplishments"));
});

export const listAll = asyncHandler(async (req: Request, res: Response) => {
  const entries = await accomplishmentService.listAll(req.orgId!, {
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    userId: req.query.userId as string | undefined,
  });
  res.json(new ApiResponse(200, entries, "Team accomplishments"));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const entry = await accomplishmentService.update(req.orgId!, req.user!.id, req.params.id, req.body);
  res.json(new ApiResponse(200, entry, "Accomplishment updated"));
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await accomplishmentService.remove(req.orgId!, req.user!.id, req.params.id);
  res.json(new ApiResponse(200, null, "Accomplishment deleted"));
});

export const addAttachments = asyncHandler(async (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (files.length === 0) throw ApiError.badRequest("No files uploaded");
  const section = req.body.section as AccomplishmentSection;

  let entry;
  for (const file of files) {
    const stored = await storageService.upload(file, `accomplishments/${req.user!.id}`);
    entry = await accomplishmentService.addAttachment(req.orgId!, req.user!.id, req.params.id, {
      ...stored,
      section,
      uploadedBy: req.user!.id as unknown as never,
      createdAt: new Date(),
    });
  }

  res.status(201).json(new ApiResponse(201, entry, "Attachment(s) uploaded"));
});

export const removeAttachment = asyncHandler(async (req: Request, res: Response) => {
  const { entry, removedKey } = await accomplishmentService.removeAttachment(
    req.orgId!,
    req.user!.id,
    req.params.id,
    req.params.fileKey
  );
  if (removedKey) await storageService.remove(removedKey);
  res.json(new ApiResponse(200, entry, "Attachment removed"));
});
