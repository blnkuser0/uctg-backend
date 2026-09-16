import { TimeEntry, ITimeEntry } from "../models/TimeEntry.model";
import { Task } from "../models/Task.model";
import { Permission } from "../constants/permissions";
import { taskService } from "./task.service";
import { ApiError } from "../utils/ApiError";

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

async function startTimer(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<ITimeEntry> {
  const task = await taskService.getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);

  const running = await TimeEntry.findOne({ userId, endedAt: null });
  if (running) throw ApiError.conflict("You already have a timer running on another task");

  // Stamp with the task's own org, not the acting user's.
  return TimeEntry.create({
    organizationId: task.organizationId,
    taskId: task._id,
    projectId: task.projectId,
    userId,
    source: "timer",
    startedAt: new Date(),
    endedAt: null,
  });
}

async function stopTimer(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<ITimeEntry> {
  const task = await taskService.getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);

  // No organizationId filter — taskId + userId already scope this correctly.
  const entry = await TimeEntry.findOne({ taskId: task._id, userId, endedAt: null });
  if (!entry) throw ApiError.badRequest("No running timer on this task");

  entry.endedAt = new Date();
  entry.durationMinutes = minutesBetween(entry.startedAt, entry.endedAt);
  await entry.save();

  await Task.updateOne({ _id: task._id }, { $inc: { trackedMinutes: entry.durationMinutes } });
  return entry;
}

async function createManualEntry(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean,
  input: { startedAt: Date; endedAt: Date; note?: string }
): Promise<ITimeEntry> {
  const task = await taskService.getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);
  if (input.endedAt < input.startedAt) throw ApiError.badRequest("endedAt must be after startedAt");

  const durationMinutes = minutesBetween(input.startedAt, input.endedAt);
  const entry = await TimeEntry.create({
    organizationId: task.organizationId,
    taskId: task._id,
    projectId: task.projectId,
    userId,
    source: "manual",
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMinutes,
    note: input.note ?? "",
  });

  await Task.updateOne({ _id: task._id }, { $inc: { trackedMinutes: durationMinutes } });
  return entry;
}

async function listForTask(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  isSuperAdmin: boolean
): Promise<ITimeEntry[]> {
  await taskService.getTaskForAccess(organizationId, taskId, userId, permissions, isSuperAdmin);
  return TimeEntry.find({ taskId }).sort({ createdAt: -1 });
}

// Own-entry-only, by construction — no org check needed (same reasoning as
// comment.service.ts's getOwnComment).
async function deleteEntry(entryId: string, userId: string): Promise<void> {
  const entry = await TimeEntry.findOne({ _id: entryId, userId });
  if (!entry) throw ApiError.notFound("Time entry not found");

  if (entry.durationMinutes) {
    await Task.updateOne({ _id: entry.taskId }, { $inc: { trackedMinutes: -entry.durationMinutes } });
  }
  await entry.deleteOne();
}

export const timeEntryService = {
  startTimer,
  stopTimer,
  createManualEntry,
  listForTask,
  deleteEntry,
};
