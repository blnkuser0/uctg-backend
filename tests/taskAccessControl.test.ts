import request from "supertest";
import { app } from "../src/server";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, id: res.body.data.user.id as string };
}

async function createRole(adminToken: string, name: string, permissions: string[] = []) {
  const res = await request(app).post("/api/roles").set("Authorization", `Bearer ${adminToken}`).send({ name, permissions });
  return res.body.data.id as string;
}

async function createUserWithRole(adminToken: string, roleId: string, email: string, password: string) {
  await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send({ name: "Test User", email, password, roleId });
  return login(email, password);
}

async function setup() {
  const reg = await createTestOrgAndAdmin(ADMIN);
  const adminToken = (await login(ADMIN.email, ADMIN.password)).token;

  const managerRoleId = await createRole(adminToken, "Task Manager", ["tasks.manage"]);
  const manager = await createUserWithRole(adminToken, managerRoleId, "manager@ugnexa.test", "supersecret2");

  const plainRoleId = await createRole(adminToken, "Plain Member", []);
  const assignee = await createUserWithRole(adminToken, plainRoleId, "assignee@ugnexa.test", "supersecret3");
  const outsider = await createUserWithRole(adminToken, plainRoleId, "outsider@ugnexa.test", "supersecret4");

  const project = await request(app)
    .post("/api/projects")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Fitout Project" });
  const projectId = project.body.data._id as string;

  // Both the manager and the plain assignee are added as members — membership alone no longer
  // matters for workspace access, but a task still needs a valid assignee who's a real user.
  await request(app).post(`/api/projects/${projectId}/members`).set("Authorization", `Bearer ${adminToken}`).send({ userId: manager.id });
  await request(app).post(`/api/projects/${projectId}/members`).set("Authorization", `Bearer ${adminToken}`).send({ userId: assignee.id });

  const stages = await request(app).get(`/api/projects/${projectId}/stages`).set("Authorization", `Bearer ${adminToken}`);
  const stageId = stages.body.data[0]._id as string;

  return { organizationId: reg.organizationId, adminToken, manager, assignee, outsider, projectId, stageId };
}

async function createOwnTask(adminToken: string, projectId: string, stageId: string, assigneeId: string) {
  const res = await request(app)
    .post(`/api/projects/${projectId}/tasks`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ stageId, title: "Install fixtures", assigneeIds: [assigneeId] });
  return res.body.data._id as string;
}

describe("Task/project access control — tasks.manage vs. own-task carve-out", () => {
  it("lets a tasks.manage holder do everything in the workspace", async () => {
    const { manager, projectId, stageId } = await setup();

    const create = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${manager.token}`)
      .send({ stageId, title: "Wire the panel" });
    expect(create.status).toBe(201);
    const taskId = create.body.data._id;

    const list = await request(app).get(`/api/projects/${projectId}/tasks`).set("Authorization", `Bearer ${manager.token}`);
    expect(list.status).toBe(200);

    const stagesRes = await request(app).get(`/api/projects/${projectId}/stages`).set("Authorization", `Bearer ${manager.token}`);
    expect(stagesRes.status).toBe(200);

    const labelsRes = await request(app).get(`/api/projects/${projectId}/labels`).set("Authorization", `Bearer ${manager.token}`);
    expect(labelsRes.status).toBe(200);

    const reportRes = await request(app).get(`/api/projects/${projectId}/report`).set("Authorization", `Bearer ${manager.token}`);
    expect(reportRes.status).toBe(200);

    const move = await request(app)
      .patch(`/api/tasks/${taskId}/move`)
      .set("Authorization", `Bearer ${manager.token}`)
      .send({ stageId, order: 1 });
    expect(move.status).toBe(200);

    const reassign = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${manager.token}`)
      .send({ title: "Wire the panel (updated)" });
    expect(reassign.status).toBe(200);
  });

  it("blocks a plain project member (no tasks.manage) from the workspace, board, and task creation", async () => {
    const { assignee, projectId, stageId } = await setup();

    expect((await request(app).get(`/api/projects/${projectId}/tasks`).set("Authorization", `Bearer ${assignee.token}`)).status).toBe(403);
    expect((await request(app).get(`/api/projects/${projectId}/stages`).set("Authorization", `Bearer ${assignee.token}`)).status).toBe(403);
    expect((await request(app).get(`/api/projects/${projectId}/labels`).set("Authorization", `Bearer ${assignee.token}`)).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/projects/${projectId}/tasks`)
          .set("Authorization", `Bearer ${assignee.token}`)
          .send({ stageId, title: "Should not be allowed" })
      ).status
    ).toBe(403);
    expect(
      (await request(app).patch(`/api/projects/${projectId}/stages/reorder`).set("Authorization", `Bearer ${assignee.token}`).send({ orderedIds: [stageId] }))
        .status
    ).toBe(403);
    expect(
      (await request(app).post(`/api/projects/${projectId}/members`).set("Authorization", `Bearer ${assignee.token}`).send({ userId: assignee.id })).status
    ).toBe(403);
  });

  it("lets a plain assignee view/comment/move-stage/checklist/attach on their OWN task, but not reassign or delete it", async () => {
    const { adminToken, assignee, projectId, stageId } = await setup();
    const taskId = await createOwnTask(adminToken, projectId, stageId, assignee.id);

    expect((await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${assignee.token}`)).status).toBe(200);

    const move = await request(app)
      .patch(`/api/tasks/${taskId}/move`)
      .set("Authorization", `Bearer ${assignee.token}`)
      .send({ stageId, order: 2 });
    expect(move.status).toBe(200);

    const checklist = await request(app)
      .post(`/api/tasks/${taskId}/checklist-items`)
      .set("Authorization", `Bearer ${assignee.token}`)
      .send({ text: "Buy screws" });
    expect(checklist.status).toBe(201);

    const comment = await request(app)
      .post(`/api/tasks/${taskId}/comments`)
      .set("Authorization", `Bearer ${assignee.token}`)
      .send({ message: "Started" });
    expect(comment.status).toBe(201);

    const timer = await request(app).post(`/api/tasks/${taskId}/timer/start`).set("Authorization", `Bearer ${assignee.token}`);
    expect(timer.status).toBe(201);

    // Not allowed: reassigning (a workspace-gated field edit) or deleting.
    const reassign = await request(app)
      .patch(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${assignee.token}`)
      .send({ assigneeIds: [] });
    expect(reassign.status).toBe(403);

    const del = await request(app).delete(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${assignee.token}`);
    expect(del.status).toBe(403);
  });

  it("blocks a user who is neither assignee, creator, nor tasks.manage holder from a task entirely", async () => {
    const { adminToken, assignee, outsider, projectId, stageId } = await setup();
    const taskId = await createOwnTask(adminToken, projectId, stageId, assignee.id);

    expect((await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${outsider.token}`)).status).toBe(403);
    expect(
      (await request(app).post(`/api/tasks/${taskId}/comments`).set("Authorization", `Bearer ${outsider.token}`).send({ message: "Hi" })).status
    ).toBe(403);
  });

  describe("seenBy lifecycle", () => {
    it("resets to the actor on edit/move/comment, and marks a viewer seen on GET", async () => {
      const { adminToken, assignee, projectId, stageId } = await setup();
      const adminId = (await login(ADMIN.email, ADMIN.password)).id;
      const taskId = await createOwnTask(adminToken, projectId, stageId, assignee.id);

      const afterCreate = await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(afterCreate.body.data.seenBy).toEqual([adminId]);

      const afterMove = await request(app)
        .patch(`/api/tasks/${taskId}/move`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ stageId, order: 1 });
      expect(afterMove.body.data.seenBy).toEqual([adminId]);

      const seenByAssignee = await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${assignee.token}`);
      expect(seenByAssignee.body.data.seenBy.sort()).toEqual([adminId, assignee.id].sort());

      const afterComment = await request(app)
        .post(`/api/tasks/${taskId}/comments`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ message: "Checking in" });
      expect(afterComment.status).toBe(201);

      const afterCommentFetch = await request(app).get(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(afterCommentFetch.body.data.seenBy).toEqual([adminId]);
    });
  });

  describe("completed filter", () => {
    it("filters the task list by completion status", async () => {
      const { adminToken, projectId, stageId } = await setup();
      const stages = await request(app).get(`/api/projects/${projectId}/stages`).set("Authorization", `Bearer ${adminToken}`);
      const doneStageId = stages.body.data.find((s: { isDoneStage: boolean }) => s.isDoneStage)._id as string;

      const doneTaskRes = await request(app)
        .post(`/api/projects/${projectId}/tasks`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ stageId, title: "Will be completed" });
      const doneTask = doneTaskRes.body.data._id as string;
      await request(app)
        .patch(`/api/tasks/${doneTask}/move`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ stageId: doneStageId, order: 0 });

      const openTask = await request(app)
        .post(`/api/projects/${projectId}/tasks`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ stageId, title: "Still open" });
      expect(openTask.status).toBe(201);

      const completedOnly = await request(app)
        .get(`/api/projects/${projectId}/tasks`)
        .query({ completed: "true" })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(completedOnly.body.data.map((t: { _id: string }) => t._id)).toEqual([doneTask]);

      const openOnly = await request(app)
        .get(`/api/projects/${projectId}/tasks`)
        .query({ completed: "false" })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(openOnly.body.data.map((t: { _id: string }) => t._id)).toEqual([openTask.body.data._id]);

      const everything = await request(app).get(`/api/projects/${projectId}/tasks`).set("Authorization", `Bearer ${adminToken}`);
      expect(everything.body.data).toHaveLength(2);
    });
  });

  it("legacy regression: a projects.manage holder (own org) still has full workspace access", async () => {
    const reg = await createTestOrgAndAdmin({
      organizationName: "Legacy Co",
      name: "Legacy Admin",
      email: "legacyadmin@ugnexa.test",
      password: "supersecret1",
    });
    const adminToken = (await login("legacyadmin@ugnexa.test", "supersecret1")).token;
    const legacyRoleId = await createRole(adminToken, "Legacy Manager", ["projects.manage"]);
    const legacy = await createUserWithRole(adminToken, legacyRoleId, "legacymgr@ugnexa.test", "supersecret2");

    const project = await request(app).post("/api/projects").set("Authorization", `Bearer ${adminToken}`).send({ name: "Legacy Project" });
    const projectId = project.body.data._id;

    const list = await request(app).get(`/api/projects/${projectId}/tasks`).set("Authorization", `Bearer ${legacy.token}`);
    expect(list.status).toBe(200);
    void reg;
  });
});
