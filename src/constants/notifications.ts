export const NOTIFICATION_TYPES = [
  "task_assigned",
  "task_comment",
  "task_mention",
  "task_deadline",
  "project_added",
  "checklist_completed",
  "leave_submitted",
  "leave_hr_decided",
  "leave_decided",
  "dm_message",
  "message_mention",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
