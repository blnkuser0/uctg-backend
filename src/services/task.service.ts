import { FilterQuery, Types } from "mongoose";
import { Task, ITask, IAttachment } from "../models/Task.model";
import { Project } from "../models/Project.model";
import { Stage } from "../models/Stage.model";
import { User } from "../models/User.model";
import { Permission } from "../constants/permissions";
import { TaskPriority } from "../constants/taskEnums";
import { projectService } from "./project.service";
import { notificationService } from "./notification.service";
import { computeChecklistProgress } from "../utils/progress";
import { ApiError } from "../utils/ApiError";

async function notifyNewAssignees(task: ITask, actorId: string, newAssigneeIds: string[]): Promise<void> {
  const targets = newAssigneeIds.filter((id) => id !== actorId);
  if (targets.length === 0) return;

  const actor = await User.findById(actorId);
  await Promise.all(
    targets.map((assigneeId) =>
      notificationService.createNotification({
        userId: assigneeId,
        type: "task_assigned",
        projectId: task.projectId.toString(),
        taskId: task._id.toString(),
        actorId,
        actorName: actor?.name ?? "Someone",
        title: `${actor?.name ?? "Someone"} assigned you a task`,
        message: task.title,
      })
    )
  );
}

interface ListTasksFilters {
  stageId?: string;
  assigneeId?: string;
  labelId?: string;
  priority?: TaskPriority;
  q?: string;
  includeSubtasks?: boolean;
  completed?: boolean;
}

/** Resets "who's seen this" to just the actor — used on every meaningful task change, so
 *  everyone else involved sees an unread indicator until they reopen it. */
function resetSeenToActor(task: ITask, actorId: string): void {
  task.seenBy = [new Types.ObjectId(actorId)];
}

/** Marks a single viewer as having seen a task, without disturbing anyone else's seen state —
 *  used only on an explicit single-task fetch, never from a list/bulk endpoint. */
async function markTaskSeen(taskId: string, viewerId: string): Promise<void> {
  await Task.updateOne({ _id: taskId }, { $addToSet: { seenBy: new Types.ObjectId(viewerId) } });
}

async function listTasks(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  filters: ListTasksFilters
): Promise<ITask[]> {
  await projectService.assertProjectAccess(organizationId, projectId, userId, permissions, isSuperAdmin);

  // No organizationId filter: the project itself was already access-checked
  // above (membership can now be cross-org), and every task here belongs to
  // that specific project regardless of which org owns it.
  const query: FilterQuery<ITask> = { projectId, deletedAt: null };
  if (filters.stageId) query.stageId = filters.stageId;
  if (filters.assigneeId) query.assigneeIds = filters.assigneeId;
  if (filters.labelId) query.labelIds = filters.labelId;
  if (filters.priority) query.priority = filters.priority;
  if (!filters.includeSubtasks) query.parentTaskId = null;
  if (filters.completed === true) query.completedAt = { $ne: null };
  if (filters.completed === false) query.completedAt = null;
  if (filters.q) {
    const regex = new RegExp(filters.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.title = regex;
  }

  return Task.find(query).sort({ order: 1, createdAt: 1 });
}

async function createTask(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  input: {
    stageId: string;
    title: string;
    description?: string;
    priority?: TaskPriority | null;
    assigneeIds?: string[];
    labelIds?: string[];
    startDate?: Date | null;
    deadline?: Date | null;
    parentTaskId?: string | null;
    estimateMinutes?: number | null;
  }
): Promise<ITask> {
  await projectService.assertProjectAccess(organizationId, projectId, userId, permissions, isSuperAdmin);

  const stage = await Stage.findOne({ _id: input.stageId, projectId, deletedAt: null });
  if (!stage) throw ApiError.badRequest("Stage not found in this project");

  // No organizationId filter: access was already established above, and can
  // now legitimately come from a caller whose own org differs from the
  // project's.
  const project = await Project.findOneAndUpdate({ _id: projectId }, { $inc: { taskSeq: 1 } }, { new: true });
  if (!project) throw ApiError.notFound("Project not found");

  const lastTask = await Task.findOne({ stageId: stage._id, deletedAt: null }).sort({ order: -1 });
  const order = lastTask ? lastTask.order + 1 : 0;

  // Stamp the task with the PROJECT's own org, not the acting user's — keeps
  // every resource under a project internally consistent regardless of who
  // (which org) created it.
  const task = await Task.create({
    organizationId: project.organizationId,
    projectId,
    stageId: stage._id,
    parentTaskId: input.parentTaskId ?? null,
    taskNumber: project.taskSeq,
    title: input.title,
    description: input.description ?? "",
    priority: input.priority ?? "normal",
    assigneeIds: input.assigneeIds ?? [],
    labelIds: input.labelIds ?? [],
    startDate: input.startDate ?? null,
    deadline: input.deadline ?? null,
    estimateMinutes: input.estimateMinutes ?? null,
    order,
    createdBy: userId,
    // The creator "acted," so they start off having seen it — everyone else sees the unread
    // indicator until they open it.
    seenBy: [userId],
  });

  await notifyNewAssignees(task, userId, input.assigneeIds ?? []);
  return task;
}

/**
 * Strict workspace-level access to a task — no ownership carve-out. Used by operations that
 * must stay tasks.manage/projects.manage/Super-Admin-only even for the task's own assignee:
 * reassigning, retitling/reprioritizing/relabeling/redating, deleting, or creating (sub)tasks.
 */
async function getTaskForWorkspaceAccess(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<ITask> {
  // No organizationId filter: the task's true org may differ from the
  // caller's — assertProjectAccess below (via task.projectId) is what
  // actually authorizes the caller, not this lookup.
  const task = await Task.findOne({ _id: taskId, deletedAt: null });
  if (!task) throw ApiError.notFound("Task not found");
  await projectService.assertProjectAccess(organizationId, task.projectId.toString(), userId, permissions, isSuperAdmin);
  return task;
}

/**
 * Task access with an own-task carve-out: a plain assignee or creator (no tasks.manage) can
 * still view, comment on, move the stage of, check off items on, and attach files to a task
 * that's theirs, even without full project-workspace access. Everyone else needs workspace
 * access (tasks.manage/projects.manage/Super Admin) as usual.
 */
async function getTaskForAccess(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<ITask> {
  const task = await Task.findOne({ _id: taskId, deletedAt: null });
  if (!task) throw ApiError.notFound("Task not found");

  const isOwnTask = task.assigneeIds.some((id) => id.toString() === userId) || task.createdBy.toString() === userId;

  try {
    await projectService.assertProjectAccess(organizationId, task.projectId.toString(), userId, permissions, isSuperAdmin);
  } catch (err) {
    if (!isOwnTask) throw err;
  }
  return task;
}

async function updateTask(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  updates: Partial<
    Pick<ITask, "title" | "description" | "priority" | "assigneeIds" | "labelIds" | "startDate" | "deadline" | "estimateMinutes">
  >
): Promise<ITask> {
  const task = await getTaskForWorkspaceAccess(organizationId, taskId, userId, permissions, isSuperAdmin);
  const previousAssigneeIds = task.assigneeIds.map((id) => id.toString());
  Object.assign(task, updates);
  resetSeenToActor(task, userId);
  await task.save();

  if (updates.assigneeIds) {
    const newlyAssigned = updates.assigneeIds
      .map((id) => id.toString())
      .filter((id) => !previousAssigneeIds.includes(id));
    await notifyNewAssignees(task, userId, newlyAssigned);
  }

  return task;
}

async function deleteTask(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<ITask> {
  const task = await getTaskForWorkspaceAccess(organizationId, taskId, userId, permissions, isSuperAdmin);
  task.deletedAt = new Date();
  await task.save();
  return task;
}

async function moveTask(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  input: { stageId: string; order: number }
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);

  const stage = await Stage.findOne({ _id: input.stageId, projectId: task.projectId, deletedAt: null });
  if (!stage) throw ApiError.badRequest("Stage not found in this project");

  task.stageId = stage._id;
  task.order = input.order;
  if (stage.isDoneStage && !task.completedAt) task.completedAt = new Date();
  if (!stage.isDoneStage) task.completedAt = null;

  resetSeenToActor(task, userId);
  await task.save();
  return task;
}

async function createSubtask(
  organizationId: string,
  parentTaskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  input: { title: string; description?: string; priority?: TaskPriority | null; assigneeIds?: string[] }
): Promise<ITask> {
  const parent = await getTaskForWorkspaceAccess(organizationId, parentTaskId, userId, permissions, isSuperAdmin);

  return createTask(organizationId, parent.projectId.toString(), userId, permissions, isSuperAdmin, {
    stageId: parent.stageId.toString(),
    title: input.title,
    description: input.description,
    priority: input.priority,
    assigneeIds: input.assigneeIds,
    parentTaskId: parent._id.toString(),
  });
}

async function listSubtasks(
  organizationId: string,
  parentTaskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<ITask[]> {
  const parent = await getTaskForAccess(organizationId, parentTaskId, userId, permissions, isSuperAdmin);
  return Task.find({ parentTaskId: parent._id, deletedAt: null }).sort({ order: 1, createdAt: 1 });
}

async function addChecklistItem(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  text: string
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);
  task.checklist.push({
    _id: new Types.ObjectId(),
    text,
    isChecked: false,
    order: task.checklist.length,
    completedBy: null,
    completedAt: null,
  });
  task.checklistProgress = computeChecklistProgress(task.checklist);
  resetSeenToActor(task, userId);
  await task.save();
  return task;
}

async function updateChecklistItem(
  organizationId: string,
  taskId: string,
  itemId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  updates: { text?: string; isChecked?: boolean }
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);
  const item = task.checklist.find((i) => i._id.toString() === itemId);
  if (!item) throw ApiError.notFound("Checklist item not found");

  if (updates.text !== undefined) item.text = updates.text;
  if (updates.isChecked !== undefined) {
    item.isChecked = updates.isChecked;
    item.completedBy = updates.isChecked ? new Types.ObjectId(userId) : null;
    item.completedAt = updates.isChecked ? new Date() : null;
  }

  task.checklistProgress = computeChecklistProgress(task.checklist);
  resetSeenToActor(task, userId);
  await task.save();
  return task;
}

async function deleteChecklistItem(
  organizationId: string,
  taskId: string,
  itemId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);
  task.checklist = task.checklist.filter((i) => i._id.toString() !== itemId);
  task.checklistProgress = computeChecklistProgress(task.checklist);
  resetSeenToActor(task, userId);
  await task.save();
  return task;
}

async function reorderChecklistItems(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  orderedIds: string[]
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);
  const byId = new Map(task.checklist.map((item) => [item._id.toString(), item]));
  orderedIds.forEach((id, index) => {
    const item = byId.get(id);
    if (item) item.order = index;
  });
  task.checklist.sort((a, b) => a.order - b.order);
  await task.save();
  return task;
}

async function addAttachment(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  file: IAttachment
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);
  task.attachments.push(file);
  resetSeenToActor(task, userId);
  await task.save();
  return task;
}

async function removeAttachment(
  organizationId: string,
  taskId: string,
  fileKey: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<{ task: ITask; removedKey: string | null }> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);
  const before = task.attachments.length;
  task.attachments = task.attachments.filter((a) => a.fileKey !== fileKey);
  const removedKey = task.attachments.length < before ? fileKey : null;
  resetSeenToActor(task, userId);
  await task.save();
  return { task, removedKey };
}

// No organizationId filter: "my tasks" is membership/assignment-based, not
// org-based, mirroring listMyProjects — a cross-org-assigned developer's
// tasks on a client project must show up here too.
async function listMyTasks(userId: string): Promise<ITask[]> {
  return Task.find({ assigneeIds: userId, deletedAt: null }).sort({ deadline: 1, createdAt: -1 });
}

export const taskService = {
  listTasks,
  listMyTasks,
  createTask,
  getTaskForAccess,
  getTaskForWorkspaceAccess,
  resetSeenToActor,
  markTaskSeen,
  updateTask,
  deleteTask,
  moveTask,
  createSubtask,
  listSubtasks,
  addChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  reorderChecklistItems,
  addAttachment,
  removeAttachment,
};
