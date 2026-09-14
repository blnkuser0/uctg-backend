import { Task, ReminderStage } from "../models/Task.model";
import { notificationService } from "./notification.service";
import { phStartOfDay, phAddDays } from "../utils/phTime";
import { logger } from "../utils/logger";

const REMINDER_WINDOWS: { stage: ReminderStage; daysAhead: number; label: string }[] = [
  { stage: "d3", daysAhead: 3, label: "in 3 days" },
  { stage: "d1", daysAhead: 1, label: "tomorrow" },
  { stage: "d0", daysAhead: 0, label: "today" },
];

async function sweepDeadlineReminders(now: Date = new Date()): Promise<number> {
  let notified = 0;

  for (const { stage, daysAhead, label } of REMINDER_WINDOWS) {
    const windowStart = phStartOfDay(phAddDays(now, daysAhead));
    const windowEnd = phAddDays(windowStart, 1);

    const tasks = await Task.find({
      deadline: { $gte: windowStart, $lt: windowEnd },
      completedAt: null,
      deletedAt: null,
      remindersSent: { $ne: stage },
      "assigneeIds.0": { $exists: true },
    });

    for (const task of tasks) {
      await Promise.all(
        task.assigneeIds.map((assigneeId) =>
          notificationService.createNotification({
            organizationId: task.organizationId.toString(),
            userId: assigneeId.toString(),
            type: "task_deadline",
            projectId: task.projectId.toString(),
            taskId: task._id.toString(),
            actorId: assigneeId.toString(),
            actorName: "System",
            title: `Deadline ${label}: ${task.title}`,
            message: task.title,
          })
        )
      );
      task.remindersSent.push(stage);
      await task.save();
      notified += 1;
    }
  }

  return notified;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function startDeadlineReminderSweep(intervalMs = 15 * 60 * 1000): void {
  if (sweepTimer) return;

  const run = () => {
    sweepDeadlineReminders().catch((err) => logger.error({ err }, "Deadline reminder sweep failed"));
  };

  run();
  sweepTimer = setInterval(run, intervalMs);
}

function stopDeadlineReminderSweep(): void {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

export const deadlineReminderService = {
  sweepDeadlineReminders,
  startDeadlineReminderSweep,
  stopDeadlineReminderSweep,
};
