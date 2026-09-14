import { FilterQuery } from "mongoose";
import { Message, IMessage } from "../models/Message.model";
import { IAttachment } from "../models/Task.model";
import { User } from "../models/User.model";
import { channelService } from "./channel.service";
import { notificationService } from "./notification.service";
import { ApiError } from "../utils/ApiError";

async function listForChannel(
  organizationId: string,
  channelId: string,
  userId: string,
  opts: { before?: Date; limit?: number }
): Promise<IMessage[]> {
  await channelService.assertChannelAccess(organizationId, channelId, userId);

  const query: FilterQuery<IMessage> = { organizationId, channelId, deletedAt: null };
  if (opts.before) query.createdAt = { $lt: opts.before };
  const limit = Math.min(opts.limit ?? 50, 100);

  const messages = await Message.find(query).sort({ createdAt: -1 }).limit(limit);
  return messages.reverse();
}

async function createMessage(
  organizationId: string,
  channelId: string,
  userId: string,
  input: { message: string; mentions?: string[]; attachments?: IAttachment[] }
): Promise<IMessage> {
  const channel = await channelService.assertChannelAccess(organizationId, channelId, userId);
  const author = await User.findById(userId);
  if (!author) throw ApiError.notFound("User not found");

  const mentions = [...new Set(input.mentions ?? [])].filter((id) => id !== userId);

  const created = await Message.create({
    organizationId,
    channelId,
    userId,
    authorName: author.name,
    authorAvatar: author.avatarUrl,
    message: input.message,
    mentions,
    attachments: input.attachments ?? [],
  });

  channel.lastMessageAt = new Date();
  await channel.save();

  if (channel.type === "dm") {
    const otherMemberId = channel.memberIds.map((id) => id.toString()).find((id) => id !== userId);
    if (otherMemberId) {
      await notificationService.createNotification({
        organizationId,
        userId: otherMemberId,
        type: "dm_message",
        channelId: channel._id.toString(),
        messageId: created._id.toString(),
        actorId: userId,
        actorName: author.name,
        title: `${author.name} sent you a message`,
        message: input.message.slice(0, 200),
      });
    }
  } else if (mentions.length > 0) {
    await Promise.all(
      mentions.map((mentionedUserId) =>
        notificationService.createNotification({
          organizationId,
          userId: mentionedUserId,
          type: "message_mention",
          channelId: channel._id.toString(),
          messageId: created._id.toString(),
          actorId: userId,
          actorName: author.name,
          title: `${author.name} mentioned you in ${channel.name ?? "a channel"}`,
          message: input.message.slice(0, 200),
        })
      )
    );
  }

  return created;
}

async function getOwnMessage(organizationId: string, messageId: string, userId: string): Promise<IMessage> {
  const message = await Message.findOne({ _id: messageId, organizationId, deletedAt: null });
  if (!message) throw ApiError.notFound("Message not found");
  if (message.userId.toString() !== userId) throw ApiError.forbidden("You can only edit your own messages");
  return message;
}

async function updateMessage(organizationId: string, messageId: string, userId: string, text: string): Promise<IMessage> {
  const message = await getOwnMessage(organizationId, messageId, userId);
  message.message = text;
  message.isEdited = true;
  await message.save();
  return message;
}

async function deleteMessage(organizationId: string, messageId: string, userId: string): Promise<IMessage> {
  const message = await getOwnMessage(organizationId, messageId, userId);
  message.deletedAt = new Date();
  await message.save();
  return message;
}

async function listMentionsForUser(organizationId: string, userId: string): Promise<IMessage[]> {
  return Message.find({ organizationId, mentions: userId, deletedAt: null })
    .sort({ createdAt: -1 })
    .limit(100);
}

export const messageService = {
  listForChannel,
  createMessage,
  updateMessage,
  deleteMessage,
  listMentionsForUser,
};
