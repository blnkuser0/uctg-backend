import request from "supertest";
import { app } from "../src/server";
import { bootstrapPlatform } from "../src/scripts/bootstrap-platform";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { Organization } from "../src/models/Organization.model";
import { User } from "../src/models/User.model";

const SUPER_ADMIN = { email: "root@ugnexa.test", password: "supersecret1", name: "Root Admin" };

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function bootstrapAndLogin() {
  await bootstrapPlatform(SUPER_ADMIN);
  return login(SUPER_ADMIN.email, SUPER_ADMIN.password);
}

describe("Platform (Super Admin) routes — access gate", () => {
  it("rejects every /platform/* route for a non-Super-Admin, even one holding every other permission", async () => {
    const org = await createTestOrgAndAdmin({
      organizationName: "Regular Co",
      name: "Regular Admin",
      email: "regular@ugnexa.test",
      password: "supersecret1",
    });
    const admin = await login(org.email, "supersecret1"); // seeded Admin role = ALL_PERMISSIONS, but not isSuperAdmin
    const authHeader = `Bearer ${admin.token}`;

    const getOrganizations = await request(app).get("/api/platform/organizations").set("Authorization", authHeader);
    const postOrganizations = await request(app).post("/api/platform/organizations").set("Authorization", authHeader);
    const postUsers = await request(app).post("/api/platform/users").set("Authorization", authHeader);
    const getDevelopers = await request(app).get("/api/platform/developers").set("Authorization", authHeader);
    const getProjects = await request(app).get("/api/platform/projects").set("Authorization", authHeader);

    for (const res of [getOrganizations, postOrganizations, postUsers, getDevelopers, getProjects]) {
      expect(res.status).toBe(403);
    }
  });

  it("rejects platform routes with no token at all", async () => {
    const res = await request(app).get("/api/platform/organizations");
    expect(res.status).toBe(401);
  });
});

describe("Platform (Super Admin) routes — provisioning", () => {
  it("creates a client organization and lists it", async () => {
    const superAdmin = await bootstrapAndLogin();

    const create = await request(app)
      .post("/api/platform/organizations")
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ organizationName: "New Client", name: "New Admin", email: "newadmin@ugnexa.test", password: "supersecret2" });
    expect(create.status).toBe(201);

    const list = await request(app)
      .get("/api/platform/organizations")
      .set("Authorization", `Bearer ${superAdmin.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((o: { name: string }) => o.name === "New Client")).toBe(true);
  });

  it("creates a separate, isolated organization on each call, and rejects a duplicate admin email", async () => {
    const superAdmin = await bootstrapAndLogin();
    const orgInput = { name: "Admin One", email: "isolated@ugnexa.test", password: "supersecret2" };

    const first = await request(app)
      .post("/api/platform/organizations")
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ ...orgInput, organizationName: "Isolated Co A" });
    const second = await request(app)
      .post("/api/platform/organizations")
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ ...orgInput, organizationName: "Isolated Co B", email: "isolated2@ugnexa.test" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.organizationId).not.toBe(first.body.data.organizationId);

    const duplicate = await request(app)
      .post("/api/platform/organizations")
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ ...orgInput, organizationName: "Isolated Co C" }); // reuses orgInput's email
    expect(duplicate.status).toBe(409);
  });

  it("creates a developer user in the shared Developers org", async () => {
    const superAdmin = await bootstrapAndLogin();

    const create = await request(app)
      .post("/api/platform/users")
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ name: "Dana Dev", email: "dana@ugnexa.test", password: "supersecret2", isDeveloper: true });
    expect(create.status).toBe(201);
    expect(create.body.data.role.name).toBe("Developer");

    const devsOrg = await Organization.findOne({ type: "internal" });
    const stored = await User.findOne({ email: "dana@ugnexa.test" });
    expect(stored!.organizationId.toString()).toBe(devsOrg!._id.toString());

    const list = await request(app)
      .get("/api/platform/developers")
      .set("Authorization", `Bearer ${superAdmin.token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((u: { email: string }) => u.email === "dana@ugnexa.test")).toBe(true);
  });

  it("creates a user in an existing client org", async () => {
    const superAdmin = await bootstrapAndLogin();
    const client = await createTestOrgAndAdmin({
      organizationName: "Existing Client",
      name: "Existing Admin",
      email: "existingadmin@ugnexa.test",
      password: "supersecret1",
    });
    const clientAdminLogin = await login(client.email, "supersecret1");
    const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${clientAdminLogin.token}`);
    const roleId = meRes.body.data.role.id;

    const create = await request(app)
      .post("/api/platform/users")
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({
        name: "Client Employee",
        email: "employee@ugnexa.test",
        password: "supersecret2",
        organizationId: client.organizationId,
        roleId,
      });
    expect(create.status).toBe(201);
    expect(create.body.data.organizationId).toBe(client.organizationId);
  });

  it("sees every project across every client org in the platform-wide list", async () => {
    const superAdmin = await bootstrapAndLogin();
    const orgA = await createTestOrgAndAdmin({
      organizationName: "Org A",
      name: "Admin A",
      email: "orgaadmin@ugnexa.test",
      password: "supersecret1",
    });
    const orgB = await createTestOrgAndAdmin({
      organizationName: "Org B",
      name: "Admin B",
      email: "orgbadmin@ugnexa.test",
      password: "supersecret1",
    });
    const adminA = await login(orgA.email, "supersecret1");
    const adminB = await login(orgB.email, "supersecret1");

    await request(app).post("/api/projects").set("Authorization", `Bearer ${adminA.token}`).send({ name: "A Project" });
    await request(app).post("/api/projects").set("Authorization", `Bearer ${adminB.token}`).send({ name: "B Project" });

    const res = await request(app).get("/api/platform/projects").set("Authorization", `Bearer ${superAdmin.token}`);
    expect(res.status).toBe(200);
    const names = res.body.data.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(["A Project", "B Project"]));
  });

  it("assigns and unassigns a developer to a client project via the dedicated endpoints", async () => {
    const superAdmin = await bootstrapAndLogin();
    const client = await createTestOrgAndAdmin({
      organizationName: "Assign Client",
      name: "Assign Admin",
      email: "assignadmin@ugnexa.test",
      password: "supersecret1",
    });
    const clientAdmin = await login(client.email, "supersecret1");

    const devCreate = await request(app)
      .post("/api/platform/users")
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ name: "Deployed Dev", email: "deployeddev@ugnexa.test", password: "supersecret2", isDeveloper: true });
    const developerId = devCreate.body.data.id;

    const projectRes = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${clientAdmin.token}`)
      .send({ name: "Assignable Project" });
    const projectId = projectRes.body.data._id;

    const assign = await request(app)
      .post(`/api/platform/projects/${projectId}/developers`)
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ userId: developerId });
    expect(assign.status).toBe(200);
    expect(assign.body.data.memberIds).toContain(developerId);

    const devLogin = await login("deployeddev@ugnexa.test", "supersecret2");
    const devAccess = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${devLogin.token}`);
    expect(devAccess.status).toBe(200);

    const unassign = await request(app)
      .delete(`/api/platform/projects/${projectId}/developers/${developerId}`)
      .set("Authorization", `Bearer ${superAdmin.token}`);
    expect(unassign.status).toBe(200);
    expect(unassign.body.data.memberIds).not.toContain(developerId);

    const devAccessAfter = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${devLogin.token}`);
    expect(devAccessAfter.status).toBe(403);
  });

  it("rejects assigning a non-Developers-org user as a project developer", async () => {
    const superAdmin = await bootstrapAndLogin();
    const client = await createTestOrgAndAdmin({
      organizationName: "Reject Client",
      name: "Reject Admin",
      email: "rejectadmin@ugnexa.test",
      password: "supersecret1",
    });
    const clientAdmin = await login(client.email, "supersecret1");

    const projectRes = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${clientAdmin.token}`)
      .send({ name: "Reject Project" });
    const projectId = projectRes.body.data._id;

    const res = await request(app)
      .post(`/api/platform/projects/${projectId}/developers`)
      .set("Authorization", `Bearer ${superAdmin.token}`)
      .send({ userId: clientAdmin.userId }); // not a Developers-org user
    expect(res.status).toBe(400);
  });
});
