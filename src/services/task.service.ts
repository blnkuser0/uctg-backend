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

async function notifyNewAssignees(
  organizationId: string,
  task: ITask,
  actorId: string,
  newAssigneeIds: string[]
): Promise<void> {
  const targets = newAssigneeIds.filter((id) => id !== actorId);
  if (targets.length === 0) return;

  const actor = await User.findById(actorId);
  await Promise.all(
    targets.map((assigneeId) =>
      notificationService.createNotification({
        organizationId,
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
}

async function listTasks(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[],
  filters: ListTasksFilters
): Promise<ITask[]> {
  await projectService.assertProjectAccess(organizationId, projectId, userId, permissions);

  const query: FilterQuery<ITask> = { organizationId, projectId, deletedAt: null };
  if (filters.stageId) query.stageId = filters.stageId;
  if (filters.assigneeId) query.assigneeIds = filters.assigneeId;
  if (filters.labelId) query.labelIds = filters.labelId;
  if (filters.priority) query.priority = filters.priority;
  if (!filters.includeSubtasks) query.parentTaskId = null;
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
  await projectService.assertProjectAccess(organizationId, projectId, userId, permissions);

  const stage = await Stage.findOne({ _id: input.stageId, projectId, deletedAt: null });
  if (!stage) throw ApiError.badRequest("Stage not found in this project");

  const project = await Project.findOneAndUpdate(
    { _id: projectId, organizationId },
    { $inc: { taskSeq: 1 } },
    { new: true }
  );
  if (!project) throw ApiError.notFound("Project not found");

  const lastTask = await Task.findOne({ stageId: stage._id, deletedAt: null }).sort({ order: -1 });
  const order = lastTask ? lastTask.order + 1 : 0;

  const task = await Task.create({
    organizationId,
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
  });

  await notifyNewAssignees(organizationId, task, userId, input.assigneeIds ?? []);
  return task;
}

async function getTaskForAccess(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[]
): Promise<ITask> {
  const task = await Task.findOne({ _id: taskId, organizationId, deletedAt: null });
  if (!task) throw ApiError.notFound("Task not found");
  await projectService.assertProjectAccess(organizationId, task.projectId.toString(), userId, permissions);
  return task;
}

async function updateTask(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  updates: Partial<
    Pick<ITask, "title" | "description" | "priority" | "assigneeIds" | "labelIds" | "startDate" | "deadline" | "estimateMinutes">
  >
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions);
  const previousAssigneeIds = task.assigneeIds.map((id) => id.toString());
  Object.assign(task, updates);
  await task.save();

  if (updates.assigneeIds) {
    const newlyAssigned = updates.assigneeIds
      .map((id) => id.toString())
      .filter((id) => !previousAssigneeIds.includes(id));
    await notifyNewAssignees(organizationId, task, userId, newlyAssigned);
  }

  return task;
}

async function deleteTask(organizationId: string, taskId: string, userId: string, permissions: Permission[]): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions);
  task.deletedAt = new Date();
  await task.save();
  return task;
}

async function moveTask(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  input: { stageId: string; order: number }
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions);

  const stage = await Stage.findOne({ _id: input.stageId, projectId: task.projectId, deletedAt: null });
  if (!stage) throw ApiError.badRequest("Stage not found in this project");

  task.stageId = stage._id;
  task.order = input.order;
  if (stage.isDoneStage && !task.completedAt) task.completedAt = new Date();
  if (!stage.isDoneStage) task.completedAt = null;

  await task.save();
  return task;
}

async function createSubtask(
  organizationId: string,
  parentTaskId: string,
  userId: string,
  permissions: Permission[],
  input: { title: string; description?: string; priority?: TaskPriority | null; assigneeIds?: string[] }
): Promise<ITask> {
  const parent = await getTaskForAccess(organizationId, parentTaskId, userId, permissions);

  return createTask(organizationId, parent.projectId.toString(), userId, permissions, {
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
  permissions: Permission[]
): Promise<ITask[]> {
  const parent = await getTaskForAccess(organizationId, parentTaskId, userId, permissions);
  return Task.find({ parentTaskId: parent._id, deletedAt: null }).sort({ order: 1, createdAt: 1 });
}

async function addChecklistItem(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  text: string
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions);
  task.checklist.push({
    _id: new Types.ObjectId(),
    text,
    isChecked: false,
    order: task.checklist.length,
    completedBy: null,
    completedAt: null,
  });
  task.checklistProgress = computeChecklistProgress(task.checklist);
  await task.save();
  return task;
}

async function updateChecklistItem(
  organizationId: string,
  taskId: string,
  itemId: string,
  userId: string,
  permissions: Permission[],
  updates: { text?: string; isChecked?: boolean }
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions);
  const item = task.checklist.find((i) => i._id.toString() === itemId);
  if (!item) throw ApiError.notFound("Checklist item not found");

  if (updates.text !== undefined) item.text = updates.text;
  if (updates.isChecked !== undefined) {
    item.isChecked = updates.isChecked;
    item.completedBy = updates.isChecked ? new Types.ObjectId(userId) : null;
    item.completedAt = updates.isChecked ? new Date() : null;
  }

  task.checklistProgress = computeChecklistProgress(task.checklist);
  await task.save();
  return task;
}

async function deleteChecklistItem(
  organizationId: string,
  taskId: string,
  itemId: string,
  userId: string,
  permissions: Permission[]
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions);
  task.checklist = task.checklist.filter((i) => i._id.toString() !== itemId);
  task.checklistProgress = computeChecklistProgress(task.checklist);
  await task.save();
  return task;
}

async function reorderChecklistItems(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  orderedIds: string[]
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions);
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
  file: IAttachment
): Promise<ITask> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions);
  task.attachments.push(file);
  await task.save();
  return task;
}

async function removeAttachment(
  organizationId: string,
  taskId: string,
  fileKey: string,
  userId: string,
  permissions: Permission[]
): Promise<{ task: ITask; removedKey: string | null }> {
  const task = await getTaskForAccess(organizationId, taskId, userId, permissions);
  const before = task.attachments.length;
  task.attachments = task.attachments.filter((a) => a.fileKey !== fileKey);
  const removedKey = task.attachments.length < before ? fileKey : null;
  await task.save();
  return { task, removedKey };
}

async function listMyTasks(organizationId: string, userId: string): Promise<ITask[]> {
  return Task.find({ organizationId, assigneeIds: userId, deletedAt: null })
    .sort({ deadline: 1, createdAt: -1 });
}

export const taskService = {
  listTasks,
  listMyTasks,
  createTask,
  getTaskForAccess,
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
