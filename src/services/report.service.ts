import { Task } from "../models/Task.model";
import { Stage } from "../models/Stage.model";
import { Permission } from "../constants/permissions";
import { projectService } from "./project.service";

export interface ProjectReport {
  projectId: string;
  totalTasks: number;
  completedTasks: number;
  completionPercent: number;
  overdueTasks: {
    _id: string;
    title: string;
    taskNumber: number;
    deadline: Date;
    assigneeIds: string[];
  }[];
  byStage: { stageId: string; name: string; count: number }[];
  workload: { userId: string; assigned: number; completed: number }[];
}

async function getProjectReport(
  organizationId: string,
  projectId: string,
  userId: string,
  permissions: Permission[]
): Promise<ProjectReport> {
  const project = await projectService.assertProjectAccess(organizationId, projectId, userId, permissions);

  const [tasks, stages] = await Promise.all([
    Task.find({ organizationId, projectId: project._id, deletedAt: null, parentTaskId: null }),
    Stage.find({ projectId: project._id, deletedAt: null }).sort({ order: 1 }),
  ]);

  const total = tasks.length;
  const completed = tasks.filter((t) => t.completedAt).length;
  const now = new Date();

  const overdueTasks = tasks
    .filter((t) => t.deadline && t.deadline < now && !t.completedAt)
    .sort((a, b) => (a.deadline as Date).getTime() - (b.deadline as Date).getTime())
    .map((t) => ({
      _id: t._id.toString(),
      title: t.title,
      taskNumber: t.taskNumber,
      deadline: t.deadline as Date,
      assigneeIds: t.assigneeIds.map((id) => id.toString()),
    }));

  const byStage = stages.map((stage) => ({
    stageId: stage._id.toString(),
    name: stage.name,
    count: tasks.filter((t) => t.stageId.toString() === stage._id.toString()).length,
  }));

  const workloadMap = new Map<string, { assigned: number; completed: number }>();
  for (const task of tasks) {
    for (const assigneeId of task.assigneeIds) {
      const key = assigneeId.toString();
      const entry = workloadMap.get(key) ?? { assigned: 0, completed: 0 };
      entry.assigned += 1;
      if (task.completedAt) entry.completed += 1;
      workloadMap.set(key, entry);
    }
  }
  const workload = [...workloadMap.entries()].map(([userId, stats]) => ({ userId, ...stats }));

  return {
    projectId: project._id.toString(),
    totalTasks: total,
    completedTasks: completed,
    completionPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    overdueTasks,
    byStage,
    workload,
  };
}

export const reportService = {
  getProjectReport,
};
