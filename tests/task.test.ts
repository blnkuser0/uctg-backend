import request from "supertest";
import { app } from "../src/server";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function loginAsAdmin() {
  await createTestOrgAndAdmin(ADMIN);
  const res = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
  return res.body.data.accessToken as string;
}

async function createProjectWithStages(token: string) {
  const project = await request(app).post("/api/projects").set("Authorization", `Bearer ${token}`).send({ name: "Fitout" });
  const stages = await request(app).get(`/api/projects/${project.body.data._id}/stages`).set("Authorization", `Bearer ${token}`);
  return { projectId: project.body.data._id as string, stages: stages.body.data as { _id: string; name: string; isDoneStage: boolean }[] };
}

describe("Tasks", () => {
  it("creates tasks with incrementing human-readable numbers", async () => {
    const token = await loginAsAdmin();
    const { projectId, stages } = await createProjectWithStages(token);
    const stageId = stages[0]._id;

    const first = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId, title: "Measure site" });
    const second = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId, title: "Order materials" });

    expect(first.body.data.taskNumber).toBe(1);
    expect(second.body.data.taskNumber).toBe(2);
  });

  it("lists tasks filtered by stage, and excludes subtasks by default", async () => {
    const token = await loginAsAdmin();
    const { projectId, stages } = await createProjectWithStages(token);
    const stageId = stages[0]._id;

    const parent = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId, title: "Parent task" });
    await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId, title: "Subtask", parentTaskId: parent.body.data._id });

    const res = await request(app).get(`/api/projects/${projectId}/tasks`).set("Authorization", `Bearer ${token}`);
    expect(res.body.data).toHaveLength(1);

    const withSubtasks = await request(app)
      .get(`/api/projects/${projectId}/tasks?includeSubtasks=true`)
      .set("Authorization", `Bearer ${token}`);
    expect(withSubtasks.body.data).toHaveLength(2);
  });

  it("updates a task", async () => {
    const token = await loginAsAdmin();
    const { projectId, stages } = await createProjectWithStages(token);
    const task = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId: stages[0]._id, title: "Original title" });

    const res = await request(app)
      .patch(`/api/tasks/${task.body.data._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Updated title", priority: "urgent" });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Updated title");
    expect(res.body.data.priority).toBe("urgent");
  });

  it("moves a task between stages and stamps completedAt when it lands in a done stage", async () => {
    const token = await loginAsAdmin();
    const { projectId, stages } = await createProjectWithStages(token);
    const doneStage = stages.find((s) => s.isDoneStage)!;
    const task = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId: stages[0]._id, title: "Install fixtures" });

    const res = await request(app)
      .patch(`/api/tasks/${task.body.data._id}/move`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId: doneStage._id, order: 0 });

    expect(res.status).toBe(200);
    expect(res.body.data.stageId).toBe(doneStage._id);
    expect(res.body.data.completedAt).toBeTruthy();
  });

  it("soft-deletes a task", async () => {
    const token = await loginAsAdmin();
    const { projectId, stages } = await createProjectWithStages(token);
    const task = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId: stages[0]._id, title: "To delete" });

    const deleteRes = await request(app).delete(`/api/tasks/${task.body.data._id}`).set("Authorization", `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const getRes = await request(app).get(`/api/tasks/${task.body.data._id}`).set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(404);
  });
});
