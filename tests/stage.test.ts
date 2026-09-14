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

async function createProjectWithStages(token: string) {
  const project = await request(app).post("/api/projects").set("Authorization", `Bearer ${token}`).send({ name: "Fitout" });
  const stages = await request(app).get(`/api/projects/${project.body.data._id}/stages`).set("Authorization", `Bearer ${token}`);
  return { projectId: project.body.data._id as string, stages: stages.body.data as { _id: string; name: string }[] };
}

describe("Stages", () => {
  it("creates a custom stage appended after the seeded defaults", async () => {
    const token = await loginAsAdmin();
    const { projectId } = await createProjectWithStages(token);

    const res = await request(app)
      .post(`/api/projects/${projectId}/stages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Client Walkthrough" });
    expect(res.status).toBe(201);
    expect(res.body.data.order).toBe(5);
  });

  it("renames a stage and toggles isDoneStage", async () => {
    const token = await loginAsAdmin();
    const { stages } = await createProjectWithStages(token);
    const designStage = stages.find((s) => s.name === "Design")!;

    const res = await request(app)
      .patch(`/api/stages/${designStage._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Concept Design", isDoneStage: true });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Concept Design");
    expect(res.body.data.isDoneStage).toBe(true);
  });

  it("reorders stages", async () => {
    const token = await loginAsAdmin();
    const { projectId, stages } = await createProjectWithStages(token);
    const reversedIds = stages.map((s) => s._id).reverse();

    const res = await request(app)
      .patch(`/api/projects/${projectId}/stages/reorder`)
      .set("Authorization", `Bearer ${token}`)
      .send({ orderedIds: reversedIds });
    expect(res.status).toBe(200);

    const afterRes = await request(app).get(`/api/projects/${projectId}/stages`).set("Authorization", `Bearer ${token}`);
    expect(afterRes.body.data[0].name).toBe("Done");
  });

  it("requires reassignment when deleting a stage with tasks in it", async () => {
    const token = await loginAsAdmin();
    const { projectId, stages } = await createProjectWithStages(token);
    const designStage = stages.find((s) => s.name === "Design")!;
    const doneStage = stages.find((s) => s.name === "Done")!;

    await request(app)
      .post(`/api/projects/${projectId}/tasks`)
      .set("Authorization", `Bearer ${token}`)
      .send({ stageId: designStage._id, title: "Pick tiles" });

    const blockedRes = await request(app)
      .delete(`/api/stages/${designStage._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(blockedRes.status).toBe(400);

    const okRes = await request(app)
      .delete(`/api/stages/${designStage._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reassignToStageId: doneStage._id });
    expect(okRes.status).toBe(200);

    const tasksRes = await request(app)
      .get(`/api/projects/${projectId}/tasks?stageId=${doneStage._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(tasksRes.body.data).toHaveLength(1);
  });
});
