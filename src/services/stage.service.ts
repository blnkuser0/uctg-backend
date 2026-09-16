import { Stage, IStage } from "../models/Stage.model";
import { Task } from "../models/Task.model";
import { Permission } from "../constants/permissions";
import { projectService } from "./project.service";
import { ApiError } from "../utils/ApiError";

async function listStages(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<IStage[]> {
  await projectService.assertProjectAccess(organizationId, projectId, userId, permissions, isSuperAdmin);
  return Stage.find({ projectId, deletedAt: null }).sort({ order: 1 });
}

async function createStage(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  input: { name: string; color?: string; wipLimit?: number | null }
): Promise<IStage> {
  const project = await projectService.assertProjectAccess(organizationId, projectId, userId, permissions, isSuperAdmin);
  const lastStage = await Stage.findOne({ projectId, deletedAt: null }).sort({ order: -1 });
  const order = lastStage ? lastStage.order + 1 : 0;

  return Stage.create({
    organizationId: project.organizationId,
    projectId,
    name: input.name,
    color: input.color ?? "#94a3b8",
    wipLimit: input.wipLimit ?? null,
    order,
    createdBy: userId,
  });
}

async function getStageForAccess(
  organizationId: string,
  stageId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<IStage> {
  // No organizationId filter — see task.service.ts's getTaskForAccess for why.
  const stage = await Stage.findOne({ _id: stageId, deletedAt: null });
  if (!stage) throw ApiError.notFound("Stage not found");
  await projectService.assertProjectAccess(organizationId, stage.projectId.toString(), userId, permissions, isSuperAdmin);
  return stage;
}

async function updateStage(
  organizationId: string,
  stageId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  updates: Partial<Pick<IStage, "name" | "color" | "isDoneStage" | "wipLimit">>
): Promise<IStage> {
  const stage = await getStageForAccess(organizationId, stageId, userId, permissions, isSuperAdmin);
  Object.assign(stage, updates);
  await stage.save();
  return stage;
}

async function reorderStages(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  orderedIds: string[]
): Promise<void> {
  await projectService.assertProjectAccess(organizationId, projectId, userId, permissions, isSuperAdmin);
  await Promise.all(
    orderedIds.map((stageId, index) => Stage.updateOne({ _id: stageId, projectId }, { order: index }))
  );
}

async function deleteStage(
  organizationId: string,
  stageId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  reassignToStageId?: string
): Promise<IStage> {
  const stage = await getStageForAccess(organizationId, stageId, userId, permissions, isSuperAdmin);

  const taskCount = await Task.countDocuments({ stageId: stage._id, deletedAt: null });
  if (taskCount > 0) {
    if (!reassignToStageId) {
      throw ApiError.badRequest(`${taskCount} task(s) are still in this stage — provide reassignToStageId`);
    }
    const target = await Stage.findOne({ _id: reassignToStageId, projectId: stage.projectId, deletedAt: null });
    if (!target) throw ApiError.badRequest("Target stage for reassignment not found");
    await Task.updateMany({ stageId: stage._id, deletedAt: null }, { stageId: target._id });
  }

  stage.deletedAt = new Date();
  await stage.save();
  return stage;
}

export const stageService = {
  listStages,
  createStage,
  updateStage,
  reorderStages,
  deleteStage,
};
