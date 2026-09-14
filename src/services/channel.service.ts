import { Channel, IChannel } from "../models/Channel.model";
import { ChannelRead } from "../models/ChannelRead.model";
import { Message } from "../models/Message.model";
import { ApiError } from "../utils/ApiError";

function buildDmKey(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join("_");
}

async function listMyChannels(organizationId: string, userId: string) {
  const channels = await Channel.find({ organizationId, memberIds: userId, deletedAt: null })
    .populate("memberIds", "name avatarUrl")
    .sort({ lastMessageAt: -1, createdAt: -1 });

  if (channels.length === 0) return [];

  const reads = await ChannelRead.find({ organizationId, userId, channelId: { $in: channels.map((c) => c._id) } });
  const readByChannel = new Map(reads.map((r) => [r.channelId.toString(), r.lastReadAt]));

  return Promise.all(
    channels.map(async (channel) => {
      const lastReadAt = readByChannel.get(channel._id.toString());
      const unreadCount = await Message.countDocuments({
        channelId: channel._id,
        deletedAt: null,
        userId: { $ne: userId },
        ...(lastReadAt ? { createdAt: { $gt: lastReadAt } } : {}),
      });
      return { ...channel.toObject(), unreadCount };
    })
  );
}

async function markRead(organizationId: string, channelId: string, userId: string): Promise<void> {
  await assertChannelAccess(organizationId, channelId, userId);
  await ChannelRead.findOneAndUpdate(
    { organizationId, channelId, userId },
    { lastReadAt: new Date() },
    { upsert: true }
  );
}

async function getOrCreateDm(organizationId: string, userId: string, otherUserId: string): Promise<IChannel> {
  if (userId === otherUserId) throw ApiError.badRequest("Cannot start a DM with yourself");

  const dmKey = buildDmKey(userId, otherUserId);
  const channel = await Channel.findOneAndUpdate(
    { organizationId, dmKey },
    {
      $setOnInsert: {
        organizationId,
        type: "dm",
        name: null,
        projectId: null,
        memberIds: [userId, otherUserId],
        dmKey,
        createdBy: userId,
      },
    },
    { upsert: true, new: true }
  ).populate("memberIds", "name avatarUrl");

  return channel!;
}

async function createGroup(
  organizationId: string,
  userId: string,
  input: { name: string; memberIds: string[] }
): Promise<IChannel> {
  const memberIds = [...new Set([userId, ...input.memberIds])];
  const channel = await Channel.create({
    organizationId,
    type: "group",
    name: input.name,
    memberIds,
    createdBy: userId,
  });
  return channel.populate("memberIds", "name avatarUrl");
}

async function getGroupForAccess(organizationId: string, channelId: string, userId: string): Promise<IChannel> {
  const channel = await Channel.findOne({ _id: channelId, organizationId, type: "group", deletedAt: null });
  if (!channel) throw ApiError.notFound("Channel not found");
  if (!channel.memberIds.some((id) => id.toString() === userId)) {
    throw ApiError.forbidden("You are not a member of this channel");
  }
  return channel;
}

async function updateGroup(
  organizationId: string,
  channelId: string,
  userId: string,
  updates: { name?: string; addMemberId?: string; removeMemberId?: string }
): Promise<IChannel> {
  const channel = await getGroupForAccess(organizationId, channelId, userId);

  if (updates.name) channel.name = updates.name;
  if (updates.addMemberId && !channel.memberIds.some((id) => id.toString() === updates.addMemberId)) {
    channel.memberIds.push(updates.addMemberId as unknown as IChannel["memberIds"][number]);
  }
  if (updates.removeMemberId) {
    channel.memberIds = channel.memberIds.filter((id) => id.toString() !== updates.removeMemberId);
  }

  await channel.save();
  return channel.populate("memberIds", "name avatarUrl");
}

async function deleteGroup(organizationId: string, channelId: string, userId: string): Promise<void> {
  const channel = await getGroupForAccess(organizationId, channelId, userId);
  channel.deletedAt = new Date();
  await channel.save();
}

/** Loads a channel and enforces membership access — the chokepoint every message operation goes through. */
async function assertChannelAccess(organizationId: string, channelId: string, userId: string): Promise<IChannel> {
  const channel = await Channel.findOne({ _id: channelId, organizationId, deletedAt: null });
  if (!channel) throw ApiError.notFound("Channel not found");
  if (!channel.memberIds.some((id) => id.toString() === userId)) {
    throw ApiError.forbidden("You are not a member of this channel");
  }
  return channel;
}

async function createProjectChannel(
  organizationId: string,
  projectId: string,
  projectName: string,
  memberIds: string[],
  createdBy: string
): Promise<IChannel> {
  return Channel.create({
    organizationId,
    type: "project",
    name: projectName,
    projectId,
    memberIds,
    createdBy,
  });
}

async function addProjectMember(projectId: string, newMemberId: string): Promise<void> {
  await Channel.updateOne(
    { projectId, type: "project" },
    { $addToSet: { memberIds: newMemberId } }
  );
}

async function removeProjectMember(projectId: string, memberIdToRemove: string): Promise<void> {
  await Channel.updateOne({ projectId, type: "project" }, { $pull: { memberIds: memberIdToRemove } });
}

export const channelService = {
  listMyChannels,
  markRead,
  getOrCreateDm,
  createGroup,
  updateGroup,
  deleteGroup,
  assertChannelAccess,
  createProjectChannel,
  addProjectMember,
  removeProjectMember,
};
