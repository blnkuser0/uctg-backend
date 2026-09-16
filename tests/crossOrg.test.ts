import request from "supertest";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { app } from "../src/server";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { Organization } from "../src/models/Organization.model";
import { Role } from "../src/models/Role.model";
import { User } from "../src/models/User.model";
import { ALL_PERMISSIONS } from "../src/constants/permissions";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function createDevelopersOrg() {
  return Organization.create({
    name: "Developers",
    slug: "developers",
    type: "internal",
    createdBy: new mongoose.Types.ObjectId(),
  });
}

async function createDeveloper(devsOrgId: string, email: string) {
  const role = await Role.create({ organizationId: devsOrgId, name: `Member-${email}`, permissions: [] });
  const passwordHash = await bcrypt.hash("supersecret1", 10);
  const user = await User.create({
    name: "Dev Doe",
    email,
    passwordHash,
    organizationId: devsOrgId,
    roleId: role._id,
  });
  const auth = await login(email, "supersecret1");
  return { ...auth, id: user._id.toString() };
}

async function createSuperAdmin(devsOrgId: string, email: string) {
  const role = await Role.create({ organizationId: devsOrgId, name: `SuperAdmin-${email}`, permissions: ALL_PERMISSIONS });
  const passwordHash = await bcrypt.hash("supersecret1", 10);
  await User.create({
    name: "Root Admin",
    email,
    passwordHash,
    organizationId: devsOrgId,
    roleId: role._id,
    isSuperAdmin: true,
  });
  return login(email, "supersecret1");
}

async function createProject(token: string, name: string) {
  const res = await request(app).post("/api/projects").set("Authorization", `Bearer ${token}`).send({ name });
  return res.body.data;
}

describe("Cross-org access control", () => {
  it("does not let a projects.manage holder in Org A reach an Org B project", async () => {
    const orgA = await createTestOrgAndAdmin({
      organizationName: "Org A",
      name: "Admin A",
      email: "admina@ugnexa.test",
      password: "supersecret1",
    });
    const orgB = await createTestOrgAndAdmin({
      organizationName: "Org B",
      name: "Admin B",
      email: "adminb@ugnexa.test",
      password: "supersecret1",
    });

    const adminA = await login(orgA.email, "supersecret1");
    const adminB = await login(orgB.email, "supersecret1");
    const projectB = await createProject(adminB.token, "Org B Project");

    const res = await request(app)
      .get(`/api/projects/${projectB._id}`)
      .set("Authorization", `Bearer ${adminA.token}`);
    expect(res.status).toBe(403);
  });

  it("lets a Developers-org user access a project they're assigned to, across tasks/stages/labels/comments/time/reports", async () => {
    const devsOrg = await createDevelopersOrg();
    const client = await createTestOrgAndAdmin({
      organizationName: "Client Co",
      name: "Client Admin",
      email: "clientadmin@ugnexa.test",
      password: "supersecret1",
    });
    const clientAdmin = await login(client.email, "supersecret1");
    const dev = await createDeveloper(devsOrg._id.toString(), "dev@ugnexa.test");

    const project = await createProject(clientAdmin.token, "Client Project");

    // Assign the cross-org developer via the existing same-org add-member
    // route — addMember never checked that the new member shares the
    // project's org, so this is the exact mechanism the plan relies on.
    const addRes = await request(app)
      .post(`/api/projects/${project._id}/members`)
      .set("Authorization", `Bearer ${clientAdmin.token}`)
      .send({ userId: dev.id });
    expect(addRes.status).toBe(200);

    // Project access
    const getProject = await request(app)
      .get(`/api/projects/${project._id}`)
      .set("Authorization", `Bearer ${dev.token}`);
    expect(getProject.status).toBe(200);

    // Appears in the developer's own "my projects", despite differing orgs
    const myProjects = await request(app).get("/api/projects").set("Authorization", `Bearer ${dev.token}`);
    expect(myProjects.body.data.some((p: { _id: string }) => p._id === project._id)).toBe(true);

    // Stages: list + create
    const stages = await request(app)
      .get(`/api/projects/${project._id}/stages`)
      .set("Authorization", `Bearer ${dev.token}`);
    expect(stages.status).toBe(200);
    const stageId = stages.body.data[0]._id;

    // Labels: create
    const label = await request(app)
      .post(`/api/projects/${project._id}/labels`)
      .set("Authorization", `Bearer ${dev.token}`)
      .send({ name: "Bug", color: "#ff0000" });
    expect(label.status).toBe(201);

    // Tasks: create, comment, track time
    const task = await request(app)
      .post(`/api/projects/${project._id}/tasks`)
      .set("Authorization", `Bearer ${dev.token}`)
      .send({ stageId, title: "Do the thing" });
    expect(task.status).toBe(201);
    const taskId = task.body.data._id;

    const comment = await request(app)
      .post(`/api/tasks/${taskId}/comments`)
      .set("Authorization", `Bearer ${dev.token}`)
      .send({ message: "On it" });
    expect(comment.status).toBe(201);

    const timer = await request(app)
      .post(`/api/tasks/${taskId}/timer/start`)
      .set("Authorization", `Bearer ${dev.token}`);
    expect(timer.status).toBe(201);

    // Report
    const report = await request(app)
      .get(`/api/projects/${project._id}/report`)
      .set("Authorization", `Bearer ${dev.token}`);
    expect(report.status).toBe(200);
  });

  it("does not let a Developers-org user access a project they were NOT assigned to", async () => {
    const devsOrg = await createDevelopersOrg();
    const client = await createTestOrgAndAdmin({
      organizationName: "Client Co 2",
      name: "Client Admin 2",
      email: "clientadmin2@ugnexa.test",
      password: "supersecret1",
    });
    const clientAdmin = await login(client.email, "supersecret1");
    const dev = await createDeveloper(devsOrg._id.toString(), "dev2@ugnexa.test");

    const project = await createProject(clientAdmin.token, "Unassigned Project");

    const res = await request(app).get(`/api/projects/${project._id}`).set("Authorization", `Bearer ${dev.token}`);
    expect(res.status).toBe(403);
  });

  it("lets a Super Admin access any project without membership or projects.manage", async () => {
    const devsOrg = await createDevelopersOrg();
    const client = await createTestOrgAndAdmin({
      organizationName: "Client Co 3",
      name: "Client Admin 3",
      email: "clientadmin3@ugnexa.test",
      password: "supersecret1",
    });
    const clientAdmin = await login(client.email, "supersecret1");
    const superAdmin = await createSuperAdmin(devsOrg._id.toString(), "root@ugnexa.test");

    const project = await createProject(clientAdmin.token, "Some Client Project");

    const res = await request(app)
      .get(`/api/projects/${project._id}`)
      .set("Authorization", `Bearer ${superAdmin.token}`);
    expect(res.status).toBe(200);
  });

  it("notifies a cross-org-assigned developer visibly under their OWN org context", async () => {
    const devsOrg = await createDevelopersOrg();
    const client = await createTestOrgAndAdmin({
      organizationName: "Client Co 4",
      name: "Client Admin 4",
      email: "clientadmin4@ugnexa.test",
      password: "supersecret1",
    });
    const clientAdmin = await login(client.email, "supersecret1");
    const dev = await createDeveloper(devsOrg._id.toString(), "dev4@ugnexa.test");

    const project = await createProject(clientAdmin.token, "Notify Project");

    await request(app)
      .post(`/api/projects/${project._id}/members`)
      .set("Authorization", `Bearer ${clientAdmin.token}`)
      .send({ userId: dev.id });

    const notifications = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${dev.token}`);
    expect(notifications.status).toBe(200);
    expect(
      notifications.body.data.some((n: { type: string; projectId?: string }) => n.type === "project_added")
    ).toBe(true);
  });
});
