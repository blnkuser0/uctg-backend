import request from "supertest";
import { app } from "../src/server";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function registerAndLogin(admin: typeof ADMIN) {
  await request(app).post("/api/auth/register").send(admin);
  const res = await request(app).post("/api/auth/login").send({ email: admin.email, password: admin.password });
  return res.body.data.accessToken as string;
}

async function loginAsAdmin() {
  return registerAndLogin(ADMIN);
}

async function createRole(adminToken: string, name: string, permissions: string[]) {
  const res = await request(app)
    .post("/api/roles")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name, permissions });
  return res.body.data.id as string;
}

async function createUserWithRole(adminToken: string, roleId: string, email: string, password: string) {
  await request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Other User", email, password, roleId });
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, id: res.body.data.user.id as string };
}

describe("Projects", () => {
  it("creates a project, auto-deriving a key and seeding default stages", async () => {
    const token = await loginAsAdmin();
    const res = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Downtown Office Fitout" });

    expect(res.status).toBe(201);
    expect(res.body.data.key).toBeTruthy();
    expect(res.body.data.memberIds).toHaveLength(1);

    const stagesRes = await request(app)
      .get(`/api/projects/${res.body.data._id}/stages`)
      .set("Authorization", `Bearer ${token}`);
    expect(stagesRes.body.data.map((s: { name: string }) => s.name)).toEqual([
      "Design",
      "Procurement",
      "Installation",
      "QA",
      "Done",
    ]);
    expect(stagesRes.body.data.at(-1).isDoneStage).toBe(true);
  });

  it("lists only the caller's own projects by default", async () => {
    const token = await loginAsAdmin();
    await request(app).post("/api/projects").set("Authorization", `Bearer ${token}`).send({ name: "Project A" });

    const res = await request(app).get("/api/projects").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("blocks a non-member from accessing a project", async () => {
    const adminToken = await loginAsAdmin();
    const project = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Private Project" });

    const memberRoleId = await createRole(adminToken, "Member", []);
    const other = await createUserWithRole(adminToken, memberRoleId, "outsider@ugnexa.test", "supersecret2");

    const res = await request(app)
      .get(`/api/projects/${project.body.data._id}`)
      .set("Authorization", `Bearer ${other.token}`);
    expect(res.status).toBe(403);
  });

  it("lets a member with projects.manage see every org project", async () => {
    const adminToken = await loginAsAdmin();
    await request(app).post("/api/projects").set("Authorization", `Bearer ${adminToken}`).send({ name: "Project A" });

    const managerRoleId = await createRole(adminToken, "Portfolio Manager", ["projects.manage"]);
    const manager = await createUserWithRole(adminToken, managerRoleId, "manager@ugnexa.test", "supersecret2");

    const res = await request(app)
      .get("/api/projects?all=true")
      .set("Authorization", `Bearer ${manager.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("adds and removes a project member", async () => {
    const adminToken = await loginAsAdmin();
    const project = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Team Project" });

    const memberRoleId = await createRole(adminToken, "Member", []);
    const other = await createUserWithRole(adminToken, memberRoleId, "teammate@ugnexa.test", "supersecret2");

    const addRes = await request(app)
      .post(`/api/projects/${project.body.data._id}/members`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: other.id });
    expect(addRes.status).toBe(200);
    expect(addRes.body.data.memberIds).toContain(other.id);

    const accessRes = await request(app)
      .get(`/api/projects/${project.body.data._id}`)
      .set("Authorization", `Bearer ${other.token}`);
    expect(accessRes.status).toBe(200);

    const removeRes = await request(app)
      .delete(`/api/projects/${project.body.data._id}/members/${other.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(removeRes.status).toBe(200);

    const blockedRes = await request(app)
      .get(`/api/projects/${project.body.data._id}`)
      .set("Authorization", `Bearer ${other.token}`);
    expect(blockedRes.status).toBe(403);
  });

  it("updates and soft-deletes a project", async () => {
    const token = await loginAsAdmin();
    const project = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "To Rename" });

    const updateRes = await request(app)
      .patch(`/api/projects/${project.body.data._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Renamed", status: "archived" });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe("Renamed");
    expect(updateRes.body.data.status).toBe("archived");

    const deleteRes = await request(app)
      .delete(`/api/projects/${project.body.data._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(deleteRes.status).toBe(200);

    const getRes = await request(app)
      .get(`/api/projects/${project.body.data._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(404);
  });
});
