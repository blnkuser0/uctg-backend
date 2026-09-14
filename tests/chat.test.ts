import request from "supertest";
import { app } from "../src/server";
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
  await request(app).post("/api/auth/register").send(ADMIN);
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
});
