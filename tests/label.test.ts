import request from "supertest";
import { app } from "../src/server";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function loginAsAdmin() {
  await request(app).post("/api/auth/register").send(ADMIN);
  const res = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
  return res.body.data.accessToken as string;
}

async function createProject(token: string) {
  const res = await request(app).post("/api/projects").set("Authorization", `Bearer ${token}`).send({ name: "Fitout" });
  return res.body.data._id as string;
}

describe("Labels", () => {
  it("creates a label and rejects a duplicate name in the same project", async () => {
    const token = await loginAsAdmin();
    const projectId = await createProject(token);

    const first = await request(app)
      .post(`/api/projects/${projectId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Electrical", color: "#f59e0b" });
    expect(first.status).toBe(201);

    const dup = await request(app)
      .post(`/api/projects/${projectId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Electrical", color: "#000000" });
    expect(dup.status).toBe(409);
  });

  it("removes a deleted label from tasks that had it", async () => {
    const token = await loginAsAdmin();
    const projectId = await createProject(token);
    const stages = await request(app).get(`/api/projects/${projectId}/stages`).set("Authorization", `Bearer ${token}`);
    const stageId = stages.body.data[0]._id;

    const label = await request(app)
      .post(`/api/projects/${projectId}/labels`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Client-Facing", color: "#22c55e" });

    const task = await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId, title: "Site visit", labelIds: [label.body.data._id] });

    await request(app).delete(`/api/labels/${label.body.data._id}`).set("Authorization", `Bearer ${token}`);

    const taskRes = await request(app).get(`/api/tasks/${task.body.data._id}`).set("Authorization", `Bearer ${token}`);
    expect(taskRes.body.data.labelIds).toHaveLength(0);
  });
});
