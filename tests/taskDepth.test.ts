import request from "supertest";
import { app } from "../src/server";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { Notification } from "../src/models/Notification.model";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function loginAsAdmin() {
  await createTestOrgAndAdmin(ADMIN);
  const res = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function createRole(adminToken: string, name: string, permissions: string[] = []) {
  const res = await request(app).post("/api/roles").set("Authorization", `Bearer ${adminToken}`).send({ name, permissions });
  return res.body.data.id as string;
}

async function createSecondUser(adminToken: string) {
  const roleId = await createRole(adminToken, "Member");
  await request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Mona Member", email: "mona@ugnexa.test", password: "supersecret2", roleId });
  const login = await request(app).post("/api/auth/login").send({ email: "mona@ugnexa.test", password: "supersecret2" });
  return { token: login.body.data.accessToken as string, userId: login.body.data.user.id as string };
}

async function createProjectWithTask(token: string) {
  const project = await request(app).post("/api/projects").set("Authorization", `Bearer ${token}`).send({ name: "Fitout" });
  const projectId = project.body.data._id as string;
  const stages = await request(app).get(`/api/projects/${projectId}/stages`).set("Authorization", `Bearer ${token}`);
  const stageId = stages.body.data[0]._id as string;
  const task = await request(app)
    .post(`/api/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({ stageId, title: "Install fixtures" });
  return { projectId, stageId, taskId: task.body.data._id as string };
}

describe("Checklists", () => {
  it("adds items, tracks progress, reorders, and deletes", async () => {
    const { token } = await loginAsAdmin();
    const { taskId } = await createProjectWithTask(token);

    const item1 = await request(app)
      .post(`/api/tasks/${taskId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Measure walls" });
    const item2 = await request(app)
      .post(`/api/tasks/${taskId}/checklist-items`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "Order fixtures" });
    expect(item2.body.data.checklistProgress).toBe(0);

    const item1Id = item1.body.data.checklist[0]._id;
    const checkRes = await request(app)
      .patch(`/api/tasks/${taskId}/checklist-items/${item1Id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ isChecked: true });
    expect(checkRes.body.data.checklistProgress).toBe(50);

    const item2Id = item2.body.data.checklist[1]._id;
    await request(app)
      .delete(`/api/tasks/${taskId}/checklist-items/${item2Id}`)
      .set("Authorization", `Bearer ${token}`);

    const finalTask = await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${token}`);
    expect(finalTask.body.data.checklist).toHaveLength(1);
    expect(finalTask.body.data.checklistProgress).toBe(100);
  });
});

describe("Subtasks", () => {
  it("creates a subtask inheriting the parent's project and stage", async () => {
    const { token } = await loginAsAdmin();
    const { taskId, stageId, projectId } = await createProjectWithTask(token);

    const subtask = await request(app)
      .post(`/api/tasks/${taskId}/subtasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Buy screws" });
    expect(subtask.status).toBe(201);
    expect(subtask.body.data.parentTaskId).toBe(taskId);
    expect(subtask.body.data.stageId).toBe(stageId);
    expect(subtask.body.data.projectId).toBe(projectId);

    const listRes = await request(app).get(`/api/tasks/${taskId}/subtasks`).set("Authorization", `Bearer ${token}`);
    expect(listRes.body.data).toHaveLength(1);
  });
});

describe("Time tracking", () => {
  it("starts and stops a timer, rolling up trackedMinutes", async () => {
    const { token } = await loginAsAdmin();
    const { taskId } = await createProjectWithTask(token);

    const startRes = await request(app).post(`/api/tasks/${taskId}/timer/start`).set("Authorization", `Bearer ${token}`);
    expect(startRes.status).toBe(201);
    expect(startRes.body.data.endedAt).toBeNull();

    const stopRes = await request(app).post(`/api/tasks/${taskId}/timer/stop`).set("Authorization", `Bearer ${token}`);
    expect(stopRes.status).toBe(200);
    expect(stopRes.body.data.durationMinutes).toBeGreaterThanOrEqual(0);

    const taskRes = await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${token}`);
    expect(taskRes.body.data.trackedMinutes).toBe(stopRes.body.data.durationMinutes);
  });

  it("blocks starting a second timer while one is already running", async () => {
    const { token } = await loginAsAdmin();
    const { taskId } = await createProjectWithTask(token);

    await request(app).post(`/api/tasks/${taskId}/timer/start`).set("Authorization", `Bearer ${token}`);
    const secondStart = await request(app).post(`/api/tasks/${taskId}/timer/start`).set("Authorization", `Bearer ${token}`);
    expect(secondStart.status).toBe(409);
  });

  it("adds a manual entry and removes it, undoing the rollup", async () => {
    const { token } = await loginAsAdmin();
    const { taskId } = await createProjectWithTask(token);

    const entryRes = await request(app)
      .post(`/api/tasks/${taskId}/time-entries`)
      .set("Authorization", `Bearer ${token}`)
      .send({ startedAt: "2026-10-01T09:00:00Z", endedAt: "2026-10-01T10:30:00Z", note: "Site visit" });
    expect(entryRes.body.data.durationMinutes).toBe(90);

    const afterAdd = await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${token}`);
    expect(afterAdd.body.data.trackedMinutes).toBe(90);

    await request(app).delete(`/api/time-entries/${entryRes.body.data._id}`).set("Authorization", `Bearer ${token}`);

    const afterDelete = await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${token}`);
    expect(afterDelete.body.data.trackedMinutes).toBe(0);
  });
});

describe("Comments & mentions", () => {
  it("posts a comment, mentions a teammate, and creates a notification for them", async () => {
    const { token: adminToken, userId: adminId } = await loginAsAdmin();
    const { taskId, projectId } = await createProjectWithTask(adminToken);
    const member = await createSecondUser(adminToken);
    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: member.userId });

    const commentRes = await request(app)
      .post(`/api/tasks/${taskId}/comments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ message: "Can you check this?", mentions: [member.userId] });
    expect(commentRes.status).toBe(201);
    expect(commentRes.body.data.mentions).toContain(member.userId);

    const taskRes = await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(taskRes.body.data.commentCount).toBe(1);

    const notifications = await Notification.find({ userId: member.userId, type: "task_mention" });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].actorId.toString()).toBe(adminId);
  });

  it("lets the author edit and delete their own comment", async () => {
    const { token } = await loginAsAdmin();
    const { taskId } = await createProjectWithTask(token);

    const created = await request(app)
      .post(`/api/tasks/${taskId}/comments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Original" });

    const updated = await request(app)
      .patch(`/api/comments/${created.body.data._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Edited" });
    expect(updated.body.data.message).toBe("Edited");
    expect(updated.body.data.isEdited).toBe(true);

    await request(app).delete(`/api/comments/${created.body.data._id}`).set("Authorization", `Bearer ${token}`);

    const taskRes = await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${token}`);
    expect(taskRes.body.data.commentCount).toBe(0);
  });

  it("blocks editing someone else's comment", async () => {
    const { token: adminToken, } = await loginAsAdmin();
    const { taskId, projectId } = await createProjectWithTask(adminToken);
    const member = await createSecondUser(adminToken);
    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: member.userId });

    const created = await request(app)
      .post(`/api/tasks/${taskId}/comments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ message: "Admin's comment" });

    const res = await request(app)
      .patch(`/api/comments/${created.body.data._id}`)
      .set("Authorization", `Bearer ${member.token}`)
      .send({ message: "Hijacked" });
    expect(res.status).toBe(403);
  });
});

describe("Attachments", () => {
  it("uploads a file attachment and then removes it", async () => {
    const { token } = await loginAsAdmin();
    const { taskId } = await createProjectWithTask(token);

    const uploadRes = await request(app)
      .post(`/api/tasks/${taskId}/attachments`)
      .set("Authorization", `Bearer ${token}`)
      .attach("files", Buffer.from("hello world"), "note.txt");
    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.data.attachments).toHaveLength(1);
    expect(uploadRes.body.data.attachments[0].originalName).toBe("note.txt");

    const fileKey = uploadRes.body.data.attachments[0].fileKey as string;
    const deleteRes = await request(app)
      .delete(`/api/tasks/${taskId}/attachments/${encodeURIComponent(fileKey)}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data.attachments).toHaveLength(0);
  });
});
