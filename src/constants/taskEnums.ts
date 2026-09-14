export const TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
