import { Notification, INotification } from "../models/Notification.model";
import { NotificationType } from "../constants/notifications";
import { emitToUser } from "../utils/socketEmitter";

async function listForUser(organizationId: string, userId: string, limit = 50): Promise<INotification[]> {
  return Notification.find({ organizationId, userId }).sort({ createdAt: -1 }).limit(limit);
}

async function countUnread(organizationId: string, userId: string): Promise<number> {
  return Notification.countDocuments({ organizationId, userId, readAt: null });
}

async function markRead(organizationId: string, userId: string, notificationIds?: string[]): Promise<void> {
  const filter: Record<string, unknown> = { organizationId, userId, readAt: null };
  if (notificationIds && notificationIds.length > 0) filter._id = { $in: notificationIds };
  await Notification.updateMany(filter, { readAt: new Date() });
}

async function createNotification(input: {
  organizationId: string;
  userId: string;
  type: NotificationType;
  projectId?: string | null;
  taskId?: string | null;
  commentId?: string | null;
  leaveId?: string | null;
  channelId?: string | null;
  messageId?: string | null;
  actorId: string;
  actorName: string;
  title: string;
  message?: string;
}): Promise<INotification> {
  const notification = await Notification.create({
    organizationId: input.organizationId,
    userId: input.userId,
    type: input.type,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    commentId: input.commentId ?? null,
    leaveId: input.leaveId ?? null,
    channelId: input.channelId ?? null,
    messageId: input.messageId ?? null,
    actorId: input.actorId,
    actorName: input.actorName,
    title: input.title,
    message: input.message ?? "",
  });

  emitToUser(input.userId, "pm:notification", { notification });
  return notification;
}

export const notificationService = {
  createNotification,
  listForUser,
  countUnread,
  markRead,
};
