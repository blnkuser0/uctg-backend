import { Label, ILabel } from "../models/Label.model";
import { Task } from "../models/Task.model";
import { Permission } from "../constants/permissions";
import { projectService } from "./project.service";
import { ApiError } from "../utils/ApiError";

async function listLabels(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[]
): Promise<ILabel[]> {
  await projectService.assertProjectAccess(organizationId, projectId, userId, permissions);
  return Label.find({ projectId, deletedAt: null }).sort({ name: 1 });
}

async function createLabel(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[],
  input: { name: string; color: string }
): Promise<ILabel> {
  await projectService.assertProjectAccess(organizationId, projectId, userId, permissions);
  const existing = await Label.findOne({ projectId, name: input.name, deletedAt: null });
  if (existing) throw ApiError.conflict("A label with this name already exists in this project");

  return Label.create({ organizationId, projectId, name: input.name, color: input.color, createdBy: userId });
}

async function getLabelForAccess(
  organizationId: string,
  labelId: string,
  userId: string,
  permissions: Permission[]
): Promise<ILabel> {
  const label = await Label.findOne({ _id: labelId, organizationId, deletedAt: null });
  if (!label) throw ApiError.notFound("Label not found");
  await projectService.assertProjectAccess(organizationId, label.projectId.toString(), userId, permissions);
  return label;
}

async function updateLabel(
  organizationId: string,
  labelId: string,
  userId: string,
  permissions: Permission[],
  updates: Partial<Pick<ILabel, "name" | "color">>
): Promise<ILabel> {
  const label = await getLabelForAccess(organizationId, labelId, userId, permissions);
  Object.assign(label, updates);
  await label.save();
  return label;
}

async function deleteLabel(
  organizationId: string,
  labelId: string,
  userId: string,
  permissions: Permission[]
): Promise<ILabel> {
  const label = await getLabelForAccess(organizationId, labelId, userId, permissions);
  label.deletedAt = new Date();
  await label.save();
  await Task.updateMany({ labelIds: label._id }, { $pull: { labelIds: label._id } });
  return label;
}

export const labelService = {
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
};
