import { TaskComment, ITaskComment } from "../models/TaskComment.model";
import { Task } from "../models/Task.model";
import { User } from "../models/User.model";
import { Permission } from "../constants/permissions";
import { taskService } from "./task.service";
import { notificationService } from "./notification.service";
import { ApiError } from "../utils/ApiError";

async function listForTask(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[]
): Promise<ITaskComment[]> {
  const task = await taskService.getTaskForAccess(organizationId, taskId, userId, permissions);
  return TaskComment.find({ organizationId: task.organizationId, taskId, deletedAt: null }).sort({ createdAt: 1 });
}

async function createComment(
  organizationId: string,
  taskId: string,
  userId: string,
  permissions: Permission[],
  input: { message: string; mentions?: string[] }
): Promise<ITaskComment> {
  const task = await taskService.getTaskForAccess(organizationId, taskId, userId, permissions);
  const author = await User.findById(userId);
  if (!author) throw ApiError.notFound("User not found");

  const mentions = [...new Set(input.mentions ?? [])].filter((id) => id !== userId);

  const comment = await TaskComment.create({
    organizationId: task.organizationId,
    projectId: task.projectId,
    taskId: task._id,
    userId,
    authorName: author.name,
    authorAvatar: author.avatarUrl,
    message: input.message,
    mentions,
  });

  await Task.updateOne({ _id: task._id }, { $inc: { commentCount: 1 } });

  await Promise.all(
    mentions.map((mentionedUserId) =>
      notificationService.createNotification({
        organizationId: task.organizationId.toString(),
        userId: mentionedUserId,
        type: "task_mention",
        projectId: task.projectId.toString(),
        taskId: task._id.toString(),
        commentId: comment._id.toString(),
        actorId: userId,
        actorName: author.name,
        title: `${author.name} mentioned you`,
        message: input.message.slice(0, 200),
      })
    )
  );

  return comment;
}

async function listMentionsForUser(_organizationId: string, userId: string): Promise<ITaskComment[]> {
  return TaskComment.find({ mentions: userId, deletedAt: null })
    .sort({ createdAt: -1 })
    .limit(100);
}

async function getOwnComment(organizationId: string, commentId: string, userId: string): Promise<ITaskComment> {
  const comment = await TaskComment.findOne({ _id: commentId, deletedAt: null });
  if (!comment) throw ApiError.notFound("Comment not found");
  if (comment.userId.toString() !== userId) throw ApiError.forbidden("You can only edit your own comments");
  return comment;
}

async function updateComment(
  organizationId: string,
  commentId: string,
  userId: string,
  message: string
): Promise<ITaskComment> {
  const comment = await getOwnComment(organizationId, commentId, userId);
  comment.message = message;
  comment.isEdited = true;
  await comment.save();
  return comment;
}

async function deleteComment(organizationId: string, commentId: string, userId: string): Promise<ITaskComment> {
  const comment = await getOwnComment(organizationId, commentId, userId);
  comment.deletedAt = new Date();
  await comment.save();
  await Task.updateOne({ _id: comment.taskId }, { $inc: { commentCount: -1 } });
  return comment;
}

export const commentService = {
  listForTask,
  listMentionsForUser,
  createComment,
  updateComment,
  deleteComment,
};
