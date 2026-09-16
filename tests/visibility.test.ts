import request from "supertest";
import { app } from "../src/server";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { Task } from "../src/models/Task.model";
import { deadlineReminderService } from "../src/services/deadlineReminder.service";

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

async function createProjectWithTask(token: string, overrides: Record<string, unknown> = {}) {
  const project = await request(app).post("/api/projects").set("Authorization", `Bearer ${token}`).send({ name: "Fitout" });
  const projectId = project.body.data._id as string;
  const stages = await request(app).get(`/api/projects/${projectId}/stages`).set("Authorization", `Bearer ${token}`);
  const stageId = stages.body.data[0]._id as string;
  const task = await request(app)
    .post(`/api/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${token}`)
    .send({ stageId, title: "Install fixtures", ...overrides });
  return { projectId, stageId, taskId: task.body.data._id as string };
}

describe("My Tasks & Mentions", () => {
  it("lists tasks assigned to the caller across projects", async () => {
    const { token: adminToken } = await loginAsAdmin();
    const member = await createSecondUser(adminToken);
    const { projectId } = await createProjectWithTask(adminToken);
    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: member.userId });

    const stages = await request(app).get(`/api/projects/${projectId}/stages`).set("Authorization", `Bearer ${adminToken}`);
    await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stageId: stages.body.data[0]._id, title: "Wire outlets", assigneeIds: [member.userId] });

    const myTasks = await request(app).get("/api/my-tasks").set("Authorization", `Bearer ${member.token}`);
    expect(myTasks.status).toBe(200);
    expect(myTasks.body.data).toHaveLength(1);
    expect(myTasks.body.data[0].title).toBe("Wire outlets");

    const adminMyTasks = await request(app).get("/api/my-tasks").set("Authorization", `Bearer ${adminToken}`);
    expect(adminMyTasks.body.data).toHaveLength(0);
  });

  it("notifies a user when they're newly assigned to a task", async () => {
    const { token: adminToken } = await loginAsAdmin();
    const member = await createSecondUser(adminToken);
    const { projectId, taskId } = await createProjectWithTask(adminToken);
    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: member.userId });

    await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ assigneeIds: [member.userId] });

    const notifications = await request(app).get("/api/notifications").set("Authorization", `Bearer ${member.token}`);
    expect(notifications.body.data.some((n: { type: string }) => n.type === "task_assigned")).toBe(true);
  });

  it("notifies a user when added as a project member", async () => {
    const { token: adminToken } = await loginAsAdmin();
    const member = await createSecondUser(adminToken);
    const { projectId } = await createProjectWithTask(adminToken);

    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: member.userId });

    const notifications = await request(app).get("/api/notifications").set("Authorization", `Bearer ${member.token}`);
    expect(notifications.body.data.some((n: { type: string }) => n.type === "project_added")).toBe(true);
  });

  it("lists comments that mention the caller", async () => {
    const { token: adminToken } = await loginAsAdmin();
    const member = await createSecondUser(adminToken);
    const { projectId, taskId } = await createProjectWithTask(adminToken);
    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: member.userId });

    await request(app)
      .post(`/api/tasks/${taskId}/comments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ message: "Please review", mentions: [member.userId] });

    const mentions = await request(app).get("/api/mentions").set("Authorization", `Bearer ${member.token}`);
    expect(mentions.status).toBe(200);
    expect(mentions.body.data).toHaveLength(1);
    expect(mentions.body.data[0].message).toBe("Please review");
  });
});

describe("Notifications", () => {
  it("counts unread and marks them read", async () => {
    const { token: adminToken } = await loginAsAdmin();
    const member = await createSecondUser(adminToken);
    const { projectId, taskId } = await createProjectWithTask(adminToken);
    await request(app)
      .post(`/api/projects/${projectId}/members`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: member.userId });
    await request(app)
      .post(`/api/tasks/${taskId}/comments`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ message: "hi", mentions: [member.userId] });

    const countBefore = await request(app).get("/api/notifications/count").set("Authorization", `Bearer ${member.token}`);
    expect(countBefore.body.data.count).toBeGreaterThanOrEqual(2); // project_added + task_mention

    await request(app).post("/api/notifications/read").set("Authorization", `Bearer ${member.token}`).send({});

    const countAfter = await request(app).get("/api/notifications/count").set("Authorization", `Bearer ${member.token}`);
    expect(countAfter.body.data.count).toBe(0);
  });
});

describe("Project report", () => {
  it("computes completion, overdue tasks, and per-assignee workload", async () => {
    const { token: adminToken, userId: adminId } = await loginAsAdmin();
    const { projectId, stageId, taskId } = await createProjectWithTask(adminToken, {
      assigneeIds: [adminId],
      deadline: "2020-01-01T00:00:00Z",
    });

    const stages = await request(app).get(`/api/projects/${projectId}/stages`).set("Authorization", `Bearer ${adminToken}`);
    const doneStage = stages.body.data.find((s: { isDoneStage: boolean }) => s.isDoneStage);
    await request(app)
      .patch(`/api/tasks/${taskId}/move`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stageId: doneStage._id, order: 0 });

    await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stageId, title: "Second task", assigneeIds: [adminId], deadline: "2099-01-01T00:00:00Z" });

    const report = await request(app).get(`/api/projects/${projectId}/report`).set("Authorization", `Bearer ${adminToken}`);
    expect(report.status).toBe(200);
    expect(report.body.data.totalTasks).toBe(2);
    expect(report.body.data.completedTasks).toBe(1);
    expect(report.body.data.completionPercent).toBe(50);
    expect(report.body.data.overdueTasks).toHaveLength(0); // completed task is excluded even though its deadline is past
    expect(report.body.data.workload).toEqual([{ userId: adminId, assigned: 2, completed: 1 }]);
  });
});

describe("Deadline reminder sweep", () => {
  it("notifies assignees once per reminder stage for tasks due today", async () => {
    const { token: adminToken, userId: adminId } = await loginAsAdmin();
    const { taskId } = await createProjectWithTask(adminToken, {
      assigneeIds: [adminId],
      deadline: new Date().toISOString(),
    });

    const firstPass = await deadlineReminderService.sweepDeadlineReminders();
    expect(firstPass).toBe(1);

    const task = await Task.findById(taskId);
    expect(task!.remindersSent).toContain("d0");

    const secondPass = await deadlineReminderService.sweepDeadlineReminders();
    expect(secondPass).toBe(0); // already reminded for d0, no duplicate

    const notifications = await request(app).get("/api/notifications").set("Authorization", `Bearer ${adminToken}`);
    expect(notifications.body.data.filter((n: { type: string }) => n.type === "task_deadline")).toHaveLength(1);
  });
});
