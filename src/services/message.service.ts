import { FilterQuery } from "mongoose";
import { Message, IMessage } from "../models/Message.model";
import { IAttachment } from "../models/Task.model";
import { User } from "../models/User.model";
import { channelService } from "./channel.service";
import { notificationService } from "./notification.service";
import { ApiError } from "../utils/ApiError";

async function listForChannel(
  channelId: string,
  userId: string,
  isSuperAdmin: boolean,
  opts: { before?: Date; limit?: number }
): Promise<IMessage[]> {
  await channelService.assertChannelAccess(channelId, userId, isSuperAdmin);

  // No organizationId filter — channelId already scopes this correctly, and
  // the channel's own org may differ from the caller's.
  const query: FilterQuery<IMessage> = { channelId, deletedAt: null };
  if (opts.before) query.createdAt = { $lt: opts.before };
  const limit = Math.min(opts.limit ?? 50, 100);

  const messages = await Message.find(query).sort({ createdAt: -1 }).limit(limit);
  return messages.reverse();
}

async function createMessage(
  channelId: string,
  userId: string,
  isSuperAdmin: boolean,
  input: { message: string; mentions?: string[]; attachments?: IAttachment[] }
): Promise<IMessage> {
  const channel = await channelService.assertChannelAccess(channelId, userId, isSuperAdmin);
  const author = await User.findById(userId);
  if (!author) throw ApiError.notFound("User not found");

  const mentions = [...new Set(input.mentions ?? [])].filter((id) => id !== userId);

  // Stamp with the channel's own org, not the acting user's.
  const created = await Message.create({
    organizationId: channel.organizationId,
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

// Own-message-only, by construction — no org check needed (same reasoning
// as comment.service.ts's getOwnComment).
async function getOwnMessage(messageId: string, userId: string): Promise<IMessage> {
  const message = await Message.findOne({ _id: messageId, deletedAt: null });
  if (!message) throw ApiError.notFound("Message not found");
  if (message.userId.toString() !== userId) throw ApiError.forbidden("You can only edit your own messages");
  return message;
}

async function updateMessage(messageId: string, userId: string, text: string): Promise<IMessage> {
  const message = await getOwnMessage(messageId, userId);
  message.message = text;
  message.isEdited = true;
  await message.save();
  return message;
}

async function deleteMessage(messageId: string, userId: string): Promise<IMessage> {
  const message = await getOwnMessage(messageId, userId);
  message.deletedAt = new Date();
  await message.save();
  return message;
}

// No organizationId filter — same reasoning as comment.service.ts's
// listMentionsForUser.
async function listMentionsForUser(userId: string): Promise<IMessage[]> {
  return Message.find({ mentions: userId, deletedAt: null })
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
