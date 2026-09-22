import { Channel, IChannel } from "../models/Channel.model";
import { ChannelRead } from "../models/ChannelRead.model";
import { Message } from "../models/Message.model";
import { ApiError } from "../utils/ApiError";

function buildDmKey(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join("_");
}

// No organizationId filter on the Channel query: a developer's home org and
// a project-channel's owning org can now differ (same reasoning as
// listMyProjects) — this is what makes an assigned project's chat show up
// for them. The ChannelRead lookup below stays organizationId-scoped since
// that's always the VIEWER's own org, consistently on both the read and
// write (markRead) side — not a resource-identity filter, so it isn't the
// same bug.
async function listMyChannels(organizationId: string, userId: string) {
  // hiddenFor excludes a channel the viewer has "deleted" from their own list — it isn't gone for
  // anyone else, and reappears for them the moment there's new activity (see createMessage /
  // getOrCreateDm below), same as the conversation-delete this mirrors.
  const channels = await Channel.find({ memberIds: userId, deletedAt: null, hiddenFor: { $ne: userId } })
    .populate("memberIds", "name avatarUrl")
    .sort({ lastMessageAt: -1, createdAt: -1 });

  if (channels.length === 0) return [];

  const reads = await ChannelRead.find({ organizationId, userId, channelId: { $in: channels.map((c) => c._id) } });
  const readByChannel = new Map(reads.map((r) => [r.channelId.toString(), { lastReadAt: r.lastReadAt, manualUnread: r.manualUnread }]));

  const withCounts = await Promise.all(
    channels.map(async (channel) => {
      const read = readByChannel.get(channel._id.toString());
      const unreadCount = await Message.countDocuments({
        channelId: channel._id,
        deletedAt: null,
        userId: { $ne: userId },
        ...(read?.lastReadAt ? { createdAt: { $gt: read.lastReadAt } } : {}),
      });
      const pinned = channel.pinnedBy.some((id) => id.toString() === userId);
      const muted = channel.mutedBy.some((id) => id.toString() === userId);
      return {
        ...channel.toObject(),
        // A forced-unread channel with nothing NEW to count still needs to render as unread —
        // bumping the displayed count to at least 1 keeps the frontend from needing a second flag.
        unreadCount: read?.manualUnread ? Math.max(unreadCount, 1) : unreadCount,
        pinned,
        muted,
      };
    })
  );

  // Pinned channels float to the top, each group keeping its own recency order — computed here
  // rather than in the Mongo query since "pinned" is per-viewer, not a column that sort() can use.
  return [...withCounts].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

async function markRead(organizationId: string, channelId: string, userId: string, isSuperAdmin: boolean): Promise<void> {
  await assertChannelAccess(channelId, userId, isSuperAdmin);
  await ChannelRead.findOneAndUpdate(
    { organizationId, channelId, userId },
    { lastReadAt: new Date(), manualUnread: false },
    { upsert: true }
  );
}

async function markUnread(organizationId: string, channelId: string, userId: string, isSuperAdmin: boolean): Promise<void> {
  await assertChannelAccess(channelId, userId, isSuperAdmin);
  await ChannelRead.findOneAndUpdate(
    { organizationId, channelId, userId },
    { $set: { manualUnread: true }, $setOnInsert: { lastReadAt: new Date(0) } },
    { upsert: true }
  );
}

async function setPinned(channelId: string, userId: string, isSuperAdmin: boolean, pinned: boolean): Promise<void> {
  const channel = await assertChannelAccess(channelId, userId, isSuperAdmin);
  if (pinned) {
    await Channel.updateOne({ _id: channel._id }, { $addToSet: { pinnedBy: userId } });
  } else {
    await Channel.updateOne({ _id: channel._id }, { $pull: { pinnedBy: userId } });
  }
}

async function setMuted(channelId: string, userId: string, isSuperAdmin: boolean, muted: boolean): Promise<void> {
  const channel = await assertChannelAccess(channelId, userId, isSuperAdmin);
  if (muted) {
    await Channel.updateOne({ _id: channel._id }, { $addToSet: { mutedBy: userId } });
  } else {
    await Channel.updateOne({ _id: channel._id }, { $pull: { mutedBy: userId } });
  }
}

// "Delete conversation" for a DM — hides it from the caller's own list only. Groups and project
// channels use membership (leave / admin-delete) instead, which already exist elsewhere; hiding
// a channel you're still a member of would be confusing there, so this stays DM-only.
async function hideDm(channelId: string, userId: string, isSuperAdmin: boolean): Promise<void> {
  const channel = await assertChannelAccess(channelId, userId, isSuperAdmin);
  if (channel.type !== "dm") throw ApiError.badRequest("Only a direct message can be deleted this way — leave a group instead");
  await Channel.updateOne({ _id: channel._id }, { $addToSet: { hiddenFor: userId } });
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
      // Re-initiating a DM either side had deleted brings it back for both of them — matches
      // "delete conversation" being a per-viewer hide, not a real end to the conversation.
      $set: { hiddenFor: [] },
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
  updates: {
    name?: string;
    addMemberId?: string;
    removeMemberId?: string;
    addMemberIds?: string[];
    removeMemberIds?: string[];
  }
): Promise<IChannel> {
  const channel = await getGroupForAccess(organizationId, channelId, userId);

  if (updates.name) channel.name = updates.name;

  const toAdd = [...(updates.addMemberId ? [updates.addMemberId] : []), ...(updates.addMemberIds ?? [])];
  const toRemove = new Set([
    ...(updates.removeMemberId ? [updates.removeMemberId] : []),
    ...(updates.removeMemberIds ?? []),
  ]);

  const existing = new Set(channel.memberIds.map((id) => id.toString()));
  for (const id of toAdd) {
    if (!existing.has(id) && !toRemove.has(id)) {
      channel.memberIds.push(id as unknown as IChannel["memberIds"][number]);
      existing.add(id);
    }
  }
  if (toRemove.size > 0) {
    channel.memberIds = channel.memberIds.filter((id) => !toRemove.has(id.toString()));
  }

  if (channel.memberIds.length === 0) {
    throw ApiError.badRequest("A group needs at least one member — delete it instead of removing everyone");
  }

  await channel.save();
  return channel.populate("memberIds", "name avatarUrl");
}

async function deleteGroup(organizationId: string, channelId: string, userId: string): Promise<void> {
  const channel = await getGroupForAccess(organizationId, channelId, userId);
  channel.deletedAt = new Date();
  await channel.save();
}

/**
 * Loads a channel and enforces membership access — the chokepoint every
 * message operation goes through. No organizationId filter and no
 * permission-based bypass (unlike assertProjectAccess) — channels have no
 * org-wide "manage all" permission, so it's membership or Super Admin, full
 * stop.
 */
async function assertChannelAccess(channelId: string, userId: string, isSuperAdmin: boolean): Promise<IChannel> {
  const channel = await Channel.findOne({ _id: channelId, deletedAt: null });
  if (!channel) throw ApiError.notFound("Channel not found");
  if (!channel.memberIds.some((id) => id.toString() === userId) && !isSuperAdmin) {
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
  markUnread,
  setPinned,
  setMuted,
  hideDm,
  getOrCreateDm,
  createGroup,
  updateGroup,
  deleteGroup,
  assertChannelAccess,
  createProjectChannel,
  addProjectMember,
  removeProjectMember,
};
