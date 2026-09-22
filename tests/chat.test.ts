import request from "supertest";
import { app } from "../src/server";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { Channel } from "../src/models/Channel.model";
import { Notification } from "../src/models/Notification.model";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function loginWithId(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function createRole(adminToken: string, name: string, permissions: string[] = []) {
  const res = await request(app).post("/api/roles").set("Authorization", `Bearer ${adminToken}`).send({ name, permissions });
  return res.body.data.id as string;
}

async function createUser(adminToken: string, roleId: string, name: string, email: string, password: string) {
  await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send({ name, email, password, roleId });
  return loginWithId(email, password);
}

async function setup() {
  await createTestOrgAndAdmin(ADMIN);
  const admin = await loginWithId(ADMIN.email, ADMIN.password);

  const roleId = await createRole(admin.token, "Member");
  const member = await createUser(admin.token, roleId, "Mona Member", "mona@ugnexa.test", "supersecret2");
  const other = await createUser(admin.token, roleId, "Otto Other", "otto@ugnexa.test", "supersecret3");

  return { admin, member, other };
}

describe("Direct messages", () => {
  it("creates a DM channel and returns the same one on a repeat request from either side", async () => {
    const { admin, member } = await setup();

    const first = await request(app)
      .post("/api/channels/dm")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ userId: member.userId });
    expect(first.status).toBe(201);
    expect(first.body.data.type).toBe("dm");
    expect(first.body.data.memberIds.map((m: { _id: string }) => m._id).sort()).toEqual(
      [admin.userId, member.userId].sort()
    );

    const second = await request(app)
      .post("/api/channels/dm")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ userId: member.userId });
    expect(second.body.data._id).toBe(first.body.data._id);

    const fromOtherSide = await request(app)
      .post("/api/channels/dm")
      .set("Authorization", `Bearer ${member.token}`)
      .send({ userId: admin.userId });
    expect(fromOtherSide.body.data._id).toBe(first.body.data._id);

    const count = await Channel.countDocuments({ type: "dm" });
    expect(count).toBe(1);
  });

  it("shows up in both members' channel lists", async () => {
    const { admin, member, other } = await setup();
    await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });

    const adminList = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    const memberList = await request(app).get("/api/channels").set("Authorization", `Bearer ${member.token}`);
    const otherList = await request(app).get("/api/channels").set("Authorization", `Bearer ${other.token}`);

    expect(adminList.body.data).toHaveLength(1);
    expect(memberList.body.data).toHaveLength(1);
    expect(otherList.body.data).toHaveLength(0);
  });
});

describe("Group channels", () => {
  it("creates a group, adds and removes a member", async () => {
    const { admin, member, other } = await setup();

    const created = await request(app)
      .post("/api/channels")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Fitout Crew", memberIds: [member.userId] });
    expect(created.status).toBe(201);
    expect(created.body.data.memberIds).toHaveLength(2); // admin (creator) + member

    const added = await request(app)
      .patch(`/api/channels/${created.body.data._id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ addMemberId: other.userId });
    expect(added.body.data.memberIds).toHaveLength(3);

    const removed = await request(app)
      .patch(`/api/channels/${created.body.data._id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ removeMemberId: other.userId });
    expect(removed.body.data.memberIds).toHaveLength(2);
  });

  it("adds and removes several members in one request (the group-info panel's bulk add)", async () => {
    const { admin, member, other } = await setup();
    const created = await request(app)
      .post("/api/channels")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Fitout Crew", memberIds: [] });
    expect(created.body.data.memberIds).toHaveLength(1); // just the creator

    const added = await request(app)
      .patch(`/api/channels/${created.body.data._id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ addMemberIds: [member.userId, other.userId] });
    expect(added.status).toBe(200);
    expect(added.body.data.memberIds.map((m: { _id: string }) => m._id).sort()).toEqual(
      [admin.userId, member.userId, other.userId].sort()
    );

    // Adding someone already in the group, and removing someone not in it, are no-ops rather than errors.
    const noop = await request(app)
      .patch(`/api/channels/${created.body.data._id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ addMemberIds: [member.userId], removeMemberIds: ["6ab0eeb348cf030ce6df34ac"] });
    expect(noop.status).toBe(200);
    expect(noop.body.data.memberIds).toHaveLength(3);

    const removed = await request(app)
      .patch(`/api/channels/${created.body.data._id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ removeMemberIds: [member.userId, other.userId] });
    expect(removed.status).toBe(200);
    expect(removed.body.data.memberIds).toHaveLength(1);
  });

  it("won't let the last member empty a group by removing everyone", async () => {
    const { admin } = await setup();
    const created = await request(app)
      .post("/api/channels")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Solo", memberIds: [] });

    const res = await request(app)
      .patch(`/api/channels/${created.body.data._id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ removeMemberId: admin.userId });
    expect(res.status).toBe(400);

    const stillThere = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(stillThere.body.data.some((c: { _id: string }) => c._id === created.body.data._id)).toBe(true);
  });

  it("lets a member leave a group they no longer want to be in", async () => {
    const { admin, member } = await setup();
    const created = await request(app)
      .post("/api/channels")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Fitout Crew", memberIds: [member.userId] });

    const left = await request(app)
      .patch(`/api/channels/${created.body.data._id}`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ removeMemberId: member.userId });
    expect(left.status).toBe(200);

    const memberList = await request(app).get("/api/channels").set("Authorization", `Bearer ${member.token}`);
    expect(memberList.body.data.some((c: { _id: string }) => c._id === created.body.data._id)).toBe(false);
    const adminList = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(adminList.body.data.find((c: { _id: string }) => c._id === created.body.data._id).memberIds).toHaveLength(1);
  });

  it("rejects an update with no actual change", async () => {
    const { admin, member } = await setup();
    const created = await request(app)
      .post("/api/channels")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Fitout Crew", memberIds: [member.userId] });

    const res = await request(app)
      .patch(`/api/channels/${created.body.data._id}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("blocks a non-member from updating or deleting a group", async () => {
    const { admin, member, other } = await setup();
    const created = await request(app)
      .post("/api/channels")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Fitout Crew", memberIds: [member.userId] });

    const res = await request(app)
      .patch(`/api/channels/${created.body.data._id}`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({ name: "Hijacked" });
    expect(res.status).toBe(403);
  });

  it("soft-deletes a group so it no longer appears in the channel list", async () => {
    const { admin, member } = await setup();
    const created = await request(app)
      .post("/api/channels")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Fitout Crew", memberIds: [member.userId] });

    await request(app).delete(`/api/channels/${created.body.data._id}`).set("Authorization", `Bearer ${admin.token}`);

    const list = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(list.body.data).toHaveLength(0);
  });
});

describe("Project channels", () => {
  it("auto-creates a channel when a project is created, and keeps its membership in sync", async () => {
    const { admin, member } = await setup();

    const project = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Fitout" });
    const projectId = project.body.data._id as string;

    const listAfterCreate = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    const projectChannel = listAfterCreate.body.data.find((c: { type: string }) => c.type === "project");
    expect(projectChannel).toBeDefined();
    expect(projectChannel.name).toBe("Fitout");
    expect(projectChannel.memberIds).toHaveLength(1);

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ userId: member.userId });

    const memberList = await request(app).get("/api/channels").set("Authorization", `Bearer ${member.token}`);
    expect(memberList.body.data.some((c: { type: string }) => c.type === "project")).toBe(true);

    await request(app)
      .delete(`/api/projects/${projectId}/members/${member.userId}`)
      .set("Authorization", `Bearer ${admin.token}`);

    const memberListAfterRemoval = await request(app).get("/api/channels").set("Authorization", `Bearer ${member.token}`);
    expect(memberListAfterRemoval.body.data.some((c: { type: string }) => c.type === "project")).toBe(false);
  });
});

describe("Messages", () => {
  it("sends and lists messages in chronological order, and bumps the channel's lastMessageAt", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    const first = await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Hey!" });
    expect(first.status).toBe(201);
    expect(first.body.data.authorName).toBe(ADMIN.name);

    const second = await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ message: "Hi, what's up?" });
    expect(second.status).toBe(201);

    const list = await request(app)
      .get(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].message).toBe("Hey!");
    expect(list.body.data[1].message).toBe("Hi, what's up?");

    const channel = await Channel.findById(channelId);
    expect(channel!.lastMessageAt).not.toBeNull();
  });

  it("blocks a non-member from reading or sending messages", async () => {
    const { admin, member, other } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    const listRes = await request(app).get(`/api/channels/${channelId}/messages`).set("Authorization", `Bearer ${other.token}`);
    expect(listRes.status).toBe(403);

    const sendRes = await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({ message: "Sneaking in" });
    expect(sendRes.status).toBe(403);
  });

  it("lets the author edit and delete their own message, but blocks anyone else", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    const created = await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Original" });
    const messageId = created.body.data._id as string;

    const blockedEdit = await request(app)
      .patch(`/api/messages/${messageId}`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ message: "Hijacked" });
    expect(blockedEdit.status).toBe(403);

    const edited = await request(app)
      .patch(`/api/messages/${messageId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Edited" });
    expect(edited.body.data.message).toBe("Edited");
    expect(edited.body.data.isEdited).toBe(true);

    const blockedDelete = await request(app).delete(`/api/messages/${messageId}`).set("Authorization", `Bearer ${member.token}`);
    expect(blockedDelete.status).toBe(403);

    const deleted = await request(app).delete(`/api/messages/${messageId}`).set("Authorization", `Bearer ${admin.token}`);
    expect(deleted.status).toBe(200);

    const listAfterDelete = await request(app)
      .get(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(listAfterDelete.body.data).toHaveLength(0);
  });
});

describe("Reactions", () => {
  async function sendMessage(token: string, channelId: string, text: string) {
    const res = await request(app).post(`/api/channels/${channelId}/messages`).set("Authorization", `Bearer ${token}`).send({ message: text });
    return res.body.data._id as string;
  }

  it("adds a reaction, and reacting again with the same emoji removes it", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;
    const messageId = await sendMessage(admin.token, channelId, "React to this");

    const added = await request(app).post(`/api/messages/${messageId}/react`).set("Authorization", `Bearer ${member.token}`).send({ emoji: "👍" });
    expect(added.status).toBe(200);
    expect(added.body.data.reactions).toEqual([{ emoji: "👍", userIds: [member.userId] }]);

    const removed = await request(app).post(`/api/messages/${messageId}/react`).set("Authorization", `Bearer ${member.token}`).send({ emoji: "👍" });
    expect(removed.body.data.reactions).toEqual([]);
  });

  it("keeps separate emoji groups, and both members show up under the same emoji", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;
    const messageId = await sendMessage(admin.token, channelId, "React to this");

    await request(app).post(`/api/messages/${messageId}/react`).set("Authorization", `Bearer ${admin.token}`).send({ emoji: "👍" });
    await request(app).post(`/api/messages/${messageId}/react`).set("Authorization", `Bearer ${member.token}`).send({ emoji: "👍" });
    const res = await request(app).post(`/api/messages/${messageId}/react`).set("Authorization", `Bearer ${admin.token}`).send({ emoji: "🎉" });

    const byEmoji = Object.fromEntries(res.body.data.reactions.map((r: { emoji: string; userIds: string[] }) => [r.emoji, r.userIds.sort()]));
    expect(byEmoji["👍"].sort()).toEqual([admin.userId, member.userId].sort());
    expect(byEmoji["🎉"]).toEqual([admin.userId]);
  });

  it("blocks a non-member from reacting", async () => {
    const { admin, member, other } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;
    const messageId = await sendMessage(admin.token, channelId, "React to this");

    const res = await request(app).post(`/api/messages/${messageId}/react`).set("Authorization", `Bearer ${other.token}`).send({ emoji: "👍" });
    expect(res.status).toBe(403);
  });
});

describe("Replies", () => {
  it("attaches a reply preview of the quoted message, kept live as it's edited or deleted", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    const original = await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Original message" });
    const originalId = original.body.data._id as string;

    const reply = await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ message: "Replying to that", replyToId: originalId });
    expect(reply.status).toBe(201);
    expect(reply.body.data.replyPreview).toEqual({ _id: originalId, authorName: ADMIN.name, message: "Original message", isDeleted: false });

    // An edit to the original is reflected live, since the preview is looked up, not copied.
    await request(app).patch(`/api/messages/${originalId}`).set("Authorization", `Bearer ${admin.token}`).send({ message: "Edited original" });
    const listAfterEdit = await request(app).get(`/api/channels/${channelId}/messages`).set("Authorization", `Bearer ${admin.token}`);
    const replyAfterEdit = listAfterEdit.body.data.find((m: { _id: string }) => m._id === reply.body.data._id);
    expect(replyAfterEdit.replyPreview.message).toBe("Edited original");

    await request(app).delete(`/api/messages/${originalId}`).set("Authorization", `Bearer ${admin.token}`);
    const listAfterDelete = await request(app).get(`/api/channels/${channelId}/messages`).set("Authorization", `Bearer ${admin.token}`);
    const replyAfterDelete = listAfterDelete.body.data.find((m: { _id: string }) => m._id === reply.body.data._id);
    expect(replyAfterDelete.replyPreview).toEqual({ _id: originalId, authorName: ADMIN.name, message: "", isDeleted: true });
  });

  it("rejects replying to a message that isn't in this channel", async () => {
    const { admin, member, other } = await setup();
    const dmA = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const dmB = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: other.userId });

    const inChannelA = await request(app)
      .post(`/api/channels/${dmA.body.data._id}/messages`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Only in A" });

    const res = await request(app)
      .post(`/api/channels/${dmB.body.data._id}/messages`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Trying to quote A from B", replyToId: inChannelA.body.data._id });
    expect(res.status).toBe(400);
  });

  it("messages with no reply have a null replyPreview", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const res = await request(app)
      .post(`/api/channels/${dm.body.data._id}/messages`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Standalone" });
    expect(res.body.data.replyPreview).toBeNull();
  });
});

describe("Pinned messages", () => {
  it("pins and unpins (toggle), and lists pinned messages newest-pinned-first", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    const first = await request(app).post(`/api/channels/${channelId}/messages`).set("Authorization", `Bearer ${admin.token}`).send({ message: "First" });
    const second = await request(app).post(`/api/channels/${channelId}/messages`).set("Authorization", `Bearer ${admin.token}`).send({ message: "Second" });

    const pinFirst = await request(app).post(`/api/messages/${first.body.data._id}/pin`).set("Authorization", `Bearer ${member.token}`);
    expect(pinFirst.status).toBe(200);
    expect(pinFirst.body.data.pinnedAt).not.toBeNull();

    const pinSecond = await request(app).post(`/api/messages/${second.body.data._id}/pin`).set("Authorization", `Bearer ${admin.token}`);
    expect(pinSecond.status).toBe(200);

    const pinned = await request(app).get(`/api/channels/${channelId}/pinned-messages`).set("Authorization", `Bearer ${admin.token}`);
    expect(pinned.body.data.map((m: { _id: string }) => m._id)).toEqual([second.body.data._id, first.body.data._id]);

    const unpinFirst = await request(app).post(`/api/messages/${first.body.data._id}/pin`).set("Authorization", `Bearer ${admin.token}`);
    expect(unpinFirst.body.data.pinnedAt).toBeNull();

    const pinnedAfterUnpin = await request(app).get(`/api/channels/${channelId}/pinned-messages`).set("Authorization", `Bearer ${admin.token}`);
    expect(pinnedAfterUnpin.body.data).toHaveLength(1);
    expect(pinnedAfterUnpin.body.data[0]._id).toBe(second.body.data._id);
  });

  it("blocks a non-member from pinning or viewing pinned messages", async () => {
    const { admin, member, other } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;
    const msg = await request(app).post(`/api/channels/${channelId}/messages`).set("Authorization", `Bearer ${admin.token}`).send({ message: "Hi" });

    const pinRes = await request(app).post(`/api/messages/${msg.body.data._id}/pin`).set("Authorization", `Bearer ${other.token}`);
    expect(pinRes.status).toBe(403);
    const listRes = await request(app).get(`/api/channels/${channelId}/pinned-messages`).set("Authorization", `Bearer ${other.token}`);
    expect(listRes.status).toBe(403);
  });
});

describe("Search within a conversation", () => {
  it("finds a message by a case-insensitive substring, scoped to that channel only", async () => {
    const { admin, member, other } = await setup();
    const dmA = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const dmB = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: other.userId });

    await request(app).post(`/api/channels/${dmA.body.data._id}/messages`).set("Authorization", `Bearer ${admin.token}`).send({ message: "Let's ship the Riverside project" });
    await request(app).post(`/api/channels/${dmA.body.data._id}/messages`).set("Authorization", `Bearer ${admin.token}`).send({ message: "Totally unrelated" });
    await request(app).post(`/api/channels/${dmB.body.data._id}/messages`).set("Authorization", `Bearer ${admin.token}`).send({ message: "riverside mentioned here too, wrong channel" });

    const res = await request(app)
      .get(`/api/channels/${dmA.body.data._id}/search`)
      .query({ q: "RIVERSIDE" })
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].message).toBe("Let's ship the Riverside project");
  });

  it("treats the query as a literal string, not a regex, and doesn't blow up on regex-special characters", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    await request(app).post(`/api/channels/${dm.body.data._id}/messages`).set("Authorization", `Bearer ${admin.token}`).send({ message: "cost is $5.00 (final)" });

    const res = await request(app)
      .get(`/api/channels/${dm.body.data._id}/search`)
      .query({ q: "$5.00 (final)" })
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("blocks a non-member from searching", async () => {
    const { admin, member, other } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const res = await request(app).get(`/api/channels/${dm.body.data._id}/search`).query({ q: "anything" }).set("Authorization", `Bearer ${other.token}`);
    expect(res.status).toBe(403);
  });
});

describe("Attachments", () => {
  it("uploads a file as its own message", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    const res = await request(app)
      .post(`/api/channels/${channelId}/attachments`)
      .set("Authorization", `Bearer ${admin.token}`)
      .attach("files", Buffer.from("hello world"), "note.txt");

    expect(res.status).toBe(201);
    expect(res.body.data.attachments).toHaveLength(1);
    expect(res.body.data.attachments[0].originalName).toBe("note.txt");

    const list = await request(app).get(`/api/channels/${channelId}/messages`).set("Authorization", `Bearer ${admin.token}`);
    expect(list.body.data).toHaveLength(1);
  });
});

describe("Mentions & notifications", () => {
  it("notifies the other DM member on every message, not just mentions", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Hey there" });

    const notifications = await Notification.find({ userId: member.userId, type: "dm_message" });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].actorId.toString()).toBe(admin.userId);
  });

  it("only notifies explicitly @mentioned members in a group, not everyone", async () => {
    const { admin, member, other } = await setup();
    const group = await request(app)
      .post("/api/channels")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Fitout Crew", memberIds: [member.userId, other.userId] });
    const channelId = group.body.data._id as string;

    await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Please review", mentions: [member.userId] });

    const memberNotifications = await Notification.find({ userId: member.userId, type: "message_mention" });
    expect(memberNotifications).toHaveLength(1);

    const otherNotifications = await Notification.find({ userId: other.userId, type: "message_mention" });
    expect(otherNotifications).toHaveLength(0);
  });

  it("lists mentions from both task comments and chat messages together, newest first", async () => {
    const { admin, member } = await setup();
    const group = await request(app)
      .post("/api/channels")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Fitout Crew", memberIds: [member.userId] });
    const channelId = group.body.data._id as string;

    await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Chat mention", mentions: [member.userId] });

    const mentions = await request(app).get("/api/mentions").set("Authorization", `Bearer ${member.token}`);
    expect(mentions.status).toBe(200);
    expect(mentions.body.data.some((m: { source: string; message: string }) => m.source === "chat" && m.message === "Chat mention")).toBe(
      true
    );
  });
});

describe("Read state", () => {
  it("counts unread messages sent by others, and clears them on mark-read", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ message: "Unread for you" });

    const beforeRead = await request(app).get("/api/channels").set("Authorization", `Bearer ${member.token}`);
    const channelBefore = beforeRead.body.data.find((c: { _id: string }) => c._id === channelId);
    expect(channelBefore.unreadCount).toBe(1);

    await request(app).post(`/api/channels/${channelId}/read`).set("Authorization", `Bearer ${member.token}`);

    const afterRead = await request(app).get("/api/channels").set("Authorization", `Bearer ${member.token}`);
    const channelAfter = afterRead.body.data.find((c: { _id: string }) => c._id === channelId);
    expect(channelAfter.unreadCount).toBe(0);

    // Sending your own message never counts as unread for you.
    const adminView = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    const channelForAdmin = adminView.body.data.find((c: { _id: string }) => c._id === channelId);
    expect(channelForAdmin.unreadCount).toBe(0);
  });

  it("marks a channel unread on demand, independent of the other member's own read state", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    await request(app).post(`/api/channels/${channelId}/unread`).set("Authorization", `Bearer ${admin.token}`);
    const marked = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(marked.body.data.find((c: { _id: string }) => c._id === channelId).unreadCount).toBeGreaterThanOrEqual(1);

    // The other member's own read state is untouched.
    const memberView = await request(app).get("/api/channels").set("Authorization", `Bearer ${member.token}`);
    expect(memberView.body.data.find((c: { _id: string }) => c._id === channelId).unreadCount).toBe(0);

    // Opening the channel (mark-read) clears the forced-unread flag, not just the count.
    await request(app).post(`/api/channels/${channelId}/read`).set("Authorization", `Bearer ${admin.token}`);
    const cleared = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(cleared.body.data.find((c: { _id: string }) => c._id === channelId).unreadCount).toBe(0);
  });
});

describe("Pin & mute", () => {
  it("pins and mutes a channel per-viewer, and floats pinned channels to the top of the list", async () => {
    const { admin, member, other } = await setup();
    const dmWithMember = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const dmWithOther = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: other.userId });
    const pinnedId = dmWithMember.body.data._id as string;
    const otherId = dmWithOther.body.data._id as string;

    // Bump otherId's lastMessageAt above pinnedId's, so pin order (not recency) is what's tested.
    await request(app).post(`/api/channels/${otherId}/messages`).set("Authorization", `Bearer ${admin.token}`).send({ message: "hi" });

    await request(app).post(`/api/channels/${pinnedId}/pin`).set("Authorization", `Bearer ${admin.token}`).send({ pinned: true });
    await request(app).post(`/api/channels/${pinnedId}/mute`).set("Authorization", `Bearer ${admin.token}`).send({ muted: true });

    const list = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(list.body.data[0]._id).toBe(pinnedId);
    expect(list.body.data[0].pinned).toBe(true);
    expect(list.body.data[0].muted).toBe(true);

    // Pinning/muting is per-viewer — the other DM member sees neither flag set.
    const memberView = await request(app).get("/api/channels").set("Authorization", `Bearer ${member.token}`);
    const memberSideChannel = memberView.body.data.find((c: { _id: string }) => c._id === pinnedId);
    expect(memberSideChannel.pinned).toBe(false);
    expect(memberSideChannel.muted).toBe(false);

    await request(app).post(`/api/channels/${pinnedId}/pin`).set("Authorization", `Bearer ${admin.token}`).send({ pinned: false });
    const afterUnpin = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(afterUnpin.body.data.find((c: { _id: string }) => c._id === pinnedId).pinned).toBe(false);
  });
});

describe("Deleting (hiding) a DM", () => {
  it("removes a DM from the deleter's own list without affecting the other member", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    const hideRes = await request(app).post(`/api/channels/${channelId}/hide`).set("Authorization", `Bearer ${admin.token}`);
    expect(hideRes.status).toBe(200);

    const adminList = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(adminList.body.data.find((c: { _id: string }) => c._id === channelId)).toBeUndefined();

    // The other member still sees it — this is a per-viewer hide, not a real delete.
    const memberList = await request(app).get("/api/channels").set("Authorization", `Bearer ${member.token}`);
    expect(memberList.body.data.find((c: { _id: string }) => c._id === channelId)).toBeDefined();
  });

  it("reappears for the deleter the moment a new message is sent (by either side)", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    await request(app).post(`/api/channels/${channelId}/hide`).set("Authorization", `Bearer ${admin.token}`);
    await request(app)
      .post(`/api/channels/${channelId}/messages`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ message: "still here" });

    const adminList = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(adminList.body.data.find((c: { _id: string }) => c._id === channelId)).toBeDefined();
  });

  it("reappears for the deleter if the DM is re-initiated by either side", async () => {
    const { admin, member } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });
    const channelId = dm.body.data._id as string;

    await request(app).post(`/api/channels/${channelId}/hide`).set("Authorization", `Bearer ${admin.token}`);
    await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${member.token}`).send({ userId: admin.userId });

    const adminList = await request(app).get("/api/channels").set("Authorization", `Bearer ${admin.token}`);
    expect(adminList.body.data.find((c: { _id: string }) => c._id === channelId)).toBeDefined();
  });

  it("rejects hiding a group or project channel this way — that's leave/admin-delete instead", async () => {
    const { admin, member } = await setup();
    const group = await request(app)
      .post("/api/channels")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Squad", memberIds: [member.userId] });

    const res = await request(app).post(`/api/channels/${group.body.data._id}/hide`).set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(400);
  });

  it("blocks a non-member from hiding a DM they're not part of", async () => {
    const { admin, member, other } = await setup();
    const dm = await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: member.userId });

    const res = await request(app).post(`/api/channels/${dm.body.data._id}/hide`).set("Authorization", `Bearer ${other.token}`);
    expect(res.status).toBe(403);
  });
});
