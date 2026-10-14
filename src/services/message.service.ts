import { FilterQuery, Types } from "mongoose";
import { Message, IMessage } from "../models/Message.model";
import { IChannel, Channel } from "../models/Channel.model";
import { IAttachment } from "../models/Task.model";
import { User } from "../models/User.model";
import { channelService } from "./channel.service";
import { notificationService } from "./notification.service";
import { ApiError } from "../utils/ApiError";
import { emitToChannel, emitToUser } from "../utils/socketEmitter";

export interface ReplyPreview {
  _id: string;
  authorName: string;
  message: string;
  isDeleted: boolean;
}

export type MessageWithReplyPreview = ReturnType<IMessage["toObject"]> & {
  replyPreview: ReplyPreview | null;
  scheduledFor: Date | null;
  scheduledStatus: "pending" | "dispatching" | "sent" | "cancelled";
};

// Batches the lookup of every quoted message in a page at once (instead of one query per reply),
// and returns a live snapshot rather than a copy frozen at reply-time — editing the original
// updates what every quote of it shows, and deleting it shows as "Original message deleted"
// instead of silently going blank.
async function attachReplyPreviews(messages: IMessage[]): Promise<MessageWithReplyPreview[]> {
  const replyIds = [...new Set(messages.filter((m) => m.replyToId).map((m) => m.replyToId!.toString()))];
  const sources = replyIds.length > 0 ? await Message.find({ _id: { $in: replyIds } }) : [];
  const byId = new Map(sources.map((m) => [m._id.toString(), m]));

  return messages.map((message) => {
    let replyPreview: ReplyPreview | null = null;
    if (message.replyToId) {
      const source = byId.get(message.replyToId.toString());
      replyPreview = source
        ? { _id: source._id.toString(), authorName: source.authorName, message: source.deletedAt ? "" : source.message, isDeleted: !!source.deletedAt }
        : { _id: message.replyToId.toString(), authorName: "Unknown", message: "", isDeleted: true };
    }
    return { ...message.toObject(), replyPreview };
  });
}

async function listForChannel(
  channelId: string,
  userId: string,
  isSuperAdmin: boolean,
  opts: { before?: Date; limit?: number }
): Promise<MessageWithReplyPreview[]> {
  await channelService.assertChannelAccess(channelId, userId, isSuperAdmin);

  // No organizationId filter — channelId already scopes this correctly, and
  // the channel's own org may differ from the caller's.
  const query: FilterQuery<IMessage> = { channelId, deletedAt: null, scheduledStatus: { $ne: "pending" } };
  if (opts.before) query.createdAt = { $lt: opts.before };
  const limit = Math.min(opts.limit ?? 50, 100);

  const messages = await Message.find(query).sort({ createdAt: -1 }).limit(limit);
  return attachReplyPreviews(messages.reverse());
}

async function createMessage(
  channelId: string,
  userId: string,
  isSuperAdmin: boolean,
  input: {
    message: string;
    mentions?: string[];
    attachments?: IAttachment[];
    replyToId?: string;
    clientMessageId?: string;
    scheduledFor?: Date;
  }
): Promise<MessageWithReplyPreview> {
  const channel = await channelService.assertChannelAccess(channelId, userId, isSuperAdmin);
  channelService.assertChannelWritable(channel, userId);

  // The UI keeps this key when retrying an unknown network result. Returning the already-created
  // message makes retries safe without relying on timing or a client-side guess.
  if (input.clientMessageId) {
    const existing = await Message.findOne({ channelId, userId, clientMessageId: input.clientMessageId });
    if (existing) return (await attachReplyPreviews([existing]))[0];
  }
  const author = await User.findById(userId);
  if (!author) throw ApiError.notFound("User not found");

  let replyToId: Types.ObjectId | null = null;
  if (input.replyToId) {
    // Must be a real, non-deleted message IN THIS CHANNEL — otherwise you could "reply" to a
    // message you have no access to and its content would leak into your reply preview.
    const replySource = await Message.findOne({ _id: input.replyToId, channelId, deletedAt: null });
    if (!replySource) throw ApiError.badRequest("The message you're replying to isn't in this conversation");
    replyToId = replySource._id;
  }

  const mentions = [...new Set(input.mentions ?? [])].filter((id) => id !== userId);
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
  if (scheduledFor && scheduledFor.getTime() <= Date.now()) throw ApiError.badRequest("Scheduled time must be in the future");

  // Stamp with the channel's own org, not the acting user's.
  let created: IMessage;
  try {
    created = await Message.create({
      organizationId: channel.organizationId,
      channelId,
      userId,
      authorName: author.name,
      authorAvatar: author.avatarUrl,
      message: input.message,
      clientMessageId: input.clientMessageId ?? null,
      mentions,
      attachments: input.attachments ?? [],
      replyToId,
      scheduledFor,
      scheduledStatus: scheduledFor ? "pending" : "sent",
    });
  } catch (error) {
    // The preflight lookup above handles ordinary retries. This catches two identical requests
    // that race between lookup and insert, and returns the winning message instead of surfacing
    // a duplicate-key error to the user.
    if (input.clientMessageId && typeof error === "object" && error && "code" in error && error.code === 11000) {
      const existing = await Message.findOne({ channelId, userId, clientMessageId: input.clientMessageId });
      if (existing) return (await attachReplyPreviews([existing]))[0];
    }
    throw error;
  }

  if (!scheduledFor) await publishMessage(created, channel);
  return (await attachReplyPreviews([created]))[0];
}

async function publishMessage(created: IMessage, channel: IChannel): Promise<void> {
  channel.lastMessageAt = created.createdAt;
  // New activity un-hides the conversation for anyone who'd deleted it — same as SupraSpace, a
  // "delete conversation" only clears it from your own list, not a real end to the conversation.
  // Tell those specific members live, since they won't be subscribed to this channel's room to
  // pick up the new message otherwise (that's exactly what being hidden from their list means).
  const resurrectedFor = channel.hiddenFor.map((id) => id.toString());
  if (resurrectedFor.length > 0) channel.hiddenFor = [];
  await channel.save();
  resurrectedFor.forEach((memberId) => emitToUser(memberId, "chat:channel:updated", { channelId: channel._id.toString() }));

  const isMutedFor = (recipientId: string) => channel.mutedBy.some((id) => id.toString() === recipientId);
  if (channel.type === "dm") {
    const otherMemberId = channel.memberIds.map((id) => id.toString()).find((id) => id !== created.userId.toString());
    if (otherMemberId && !isMutedFor(otherMemberId)) {
      await notificationService.createNotification({
        userId: otherMemberId,
        type: "dm_message",
        channelId: channel._id.toString(),
        messageId: created._id.toString(),
        actorId: created.userId.toString(),
        actorName: created.authorName,
        title: `${created.authorName} sent you a message`,
        message: created.message.slice(0, 200),
      });
    }
  } else if (created.mentions.length > 0) {
    await Promise.all(
      created.mentions
        .map((mentionedUserId) => mentionedUserId.toString())
        .filter((mentionedUserId) => !isMutedFor(mentionedUserId))
        .map((mentionedUserId) =>
          notificationService.createNotification({
          userId: mentionedUserId.toString(),
          type: "message_mention",
          channelId: channel._id.toString(),
          messageId: created._id.toString(),
          actorId: created.userId.toString(),
          actorName: created.authorName,
          title: `${created.authorName} mentioned you in ${channel.name ?? "a channel"}`,
          message: created.message.slice(0, 200),
          })
        )
    );
  }
}

async function listScheduled(channelId: string, userId: string, isSuperAdmin: boolean): Promise<MessageWithReplyPreview[]> {
  await channelService.assertChannelAccess(channelId, userId, isSuperAdmin);
  const messages = await Message.find({ channelId, userId, scheduledStatus: "pending", deletedAt: null }).sort({ scheduledFor: 1 });
  return attachReplyPreviews(messages);
}

// Claim each message atomically so multiple Node instances can run this sweep without double
// delivery. A failed publish goes back to pending rather than silently disappearing.
async function deliverDueScheduledMessages(): Promise<number> {
  let delivered = 0;
  while (true) {
    const message = await Message.findOneAndUpdate(
      { scheduledStatus: "pending", scheduledFor: { $lte: new Date() }, deletedAt: null },
      { $set: { scheduledStatus: "dispatching" } },
      { new: true }
    );
    if (!message) return delivered;

    const channel = await Channel.findOne({ _id: message.channelId, deletedAt: null });
    if (!channel) {
      await Message.updateOne({ _id: message._id }, { $set: { scheduledStatus: "cancelled" } });
      continue;
    }
    if (channel.archivedBy.some((id) => id.toString() === message.userId.toString())) {
      await Message.updateOne({ _id: message._id }, { $set: { scheduledStatus: "cancelled" } });
      continue;
    }
    try {
      await publishMessage(message, channel);
      message.scheduledStatus = "sent";
      await message.save();
      const deliveredMessage = (await attachReplyPreviews([message]))[0];
      emitToChannel(channel._id.toString(), "chat:message:created", { channelId: channel._id.toString(), message: deliveredMessage });
      delivered += 1;
    } catch (error) {
      await Message.updateOne({ _id: message._id }, { $set: { scheduledStatus: "pending" } });
      throw error;
    }
  }
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
  const channel = await channelService.assertChannelAccess(message.channelId.toString(), userId, false);
  channelService.assertChannelWritable(channel, userId);
  message.message = text;
  message.isEdited = true;
  await message.save();
  return message;
}

async function deleteMessage(messageId: string, userId: string): Promise<IMessage> {
  const message = await getOwnMessage(messageId, userId);
  const channel = await channelService.assertChannelAccess(message.channelId.toString(), userId, false);
  channelService.assertChannelWritable(channel, userId);
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

// Loads a message and checks the caller can actually see the channel it's in — the one
// chokepoint every per-message action below (react, pin) goes through. Unlike getOwnMessage,
// this is deliberately NOT author-only: anyone in the conversation can react to or pin any
// message in it, same as the membership model everywhere else in chat.
async function getMessageForChannelAccess(messageId: string, userId: string, isSuperAdmin: boolean): Promise<IMessage> {
  const message = await Message.findOne({ _id: messageId, deletedAt: null });
  if (!message) throw ApiError.notFound("Message not found");
  await channelService.assertChannelAccess(message.channelId.toString(), userId, isSuperAdmin);
  return message;
}

// Toggles the caller's own reaction with this emoji — react again with the same emoji to
// remove it. An emoji nobody has left anymore is dropped from the array entirely, so the
// reaction bar never shows a lingering "0".
async function reactToMessage(messageId: string, userId: string, isSuperAdmin: boolean, emoji: string): Promise<IMessage> {
  const message = await getMessageForChannelAccess(messageId, userId, isSuperAdmin);
  const channel = await channelService.assertChannelAccess(message.channelId.toString(), userId, isSuperAdmin);
  channelService.assertChannelWritable(channel, userId);

  const group = message.reactions.find((r) => r.emoji === emoji);
  if (!group) {
    message.reactions.push({ emoji, userIds: [new Types.ObjectId(userId)] });
  } else {
    const alreadyReacted = group.userIds.some((id) => id.toString() === userId);
    if (alreadyReacted) {
      group.userIds = group.userIds.filter((id) => id.toString() !== userId);
      if (group.userIds.length === 0) {
        message.reactions = message.reactions.filter((r) => r.emoji !== emoji);
      }
    } else {
      group.userIds.push(new Types.ObjectId(userId));
    }
  }

  await message.save();
  return message;
}

async function togglePinMessage(messageId: string, userId: string, isSuperAdmin: boolean): Promise<IMessage> {
  const message = await getMessageForChannelAccess(messageId, userId, isSuperAdmin);
  const channel = await channelService.assertChannelAccess(message.channelId.toString(), userId, isSuperAdmin);
  channelService.assertChannelWritable(channel, userId);

  if (message.pinnedAt) {
    message.pinnedAt = null;
    message.pinnedBy = null;
  } else {
    message.pinnedAt = new Date();
    message.pinnedBy = new Types.ObjectId(userId);
  }

  await message.save();
  return message;
}

async function listPinned(channelId: string, userId: string, isSuperAdmin: boolean): Promise<IMessage[]> {
  await channelService.assertChannelAccess(channelId, userId, isSuperAdmin);
  return Message.find({ channelId, deletedAt: null, pinnedAt: { $ne: null } }).sort({ pinnedAt: -1 });
}

async function searchInChannel(
  channelId: string,
  userId: string,
  isSuperAdmin: boolean,
  q: string,
  limit = 30
): Promise<IMessage[]> {
  await channelService.assertChannelAccess(channelId, userId, isSuperAdmin);
  const pattern = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return Message.find({ channelId, deletedAt: null, message: pattern })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 50));
}

export const messageService = {
  listForChannel,
  listScheduled,
  deliverDueScheduledMessages,
  createMessage,
  updateMessage,
  deleteMessage,
  listMentionsForUser,
  reactToMessage,
  togglePinMessage,
  listPinned,
  searchInChannel,
};
