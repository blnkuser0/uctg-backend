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

async function createRole(adminToken: string, name: string, permissions: string[] = []) {
  const res = await request(app)
    .post("/api/roles")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name, permissions });
  return res.body.data.id as string;
}

async function createMember(adminToken: string, roleId: string, email = "mona@ugnexa.test") {
  return request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Mona Member", email, password: "supersecret2", roleId });
}

describe("User provisioning", () => {
  it("lets an admin create a user under a plain role", async () => {
    const adminToken = await loginAsAdmin();
    const memberRoleId = await createRole(adminToken, "Member");
    const res = await createMember(adminToken, memberRoleId);

    expect(res.status).toBe(201);
    expect(res.body.data.role.name).toBe("Member");
    expect(res.body.data.email).toBe("mona@ugnexa.test");
  });

  it("blocks a plain-role user from creating another user", async () => {
    const adminToken = await loginAsAdmin();
    const memberRoleId = await createRole(adminToken, "Member");
    await createMember(adminToken, memberRoleId);

    const memberLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "mona@ugnexa.test", password: "supersecret2" });
    const memberToken = memberLogin.body.data.accessToken;

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ name: "X", email: "x@ugnexa.test", password: "password123", roleId: memberRoleId });

    expect(res.status).toBe(403);
  });

  it("lists users for any authenticated user", async () => {
    const adminToken = await loginAsAdmin();
    const memberRoleId = await createRole(adminToken, "Member");
    await createMember(adminToken, memberRoleId);

    const res = await request(app).get("/api/users").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it("deactivates a user and blocks further logins", async () => {
    const adminToken = await loginAsAdmin();
    const memberRoleId = await createRole(adminToken, "Member");
    const created = await createMember(adminToken, memberRoleId);
    const userId = created.body.data.id;

    const deactivateRes = await request(app).delete(`/api/users/${userId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(deactivateRes.status).toBe(200);

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "mona@ugnexa.test", password: "supersecret2" });
    expect(loginRes.status).toBe(403);
  });

  it("rejects a roleId that belongs to a different organization", async () => {
    const orgAToken = await registerAndLogin({ ...ADMIN, organizationName: "Org A", email: "admin-a@ugnexa.test" });
    const orgBToken = await registerAndLogin({ ...ADMIN, organizationName: "Org B", email: "admin-b@ugnexa.test" });
    const orgBRoleId = await createRole(orgBToken, "Member");

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${orgAToken}`)
      .send({ name: "X", email: "x@ugnexa.test", password: "password123", roleId: orgBRoleId });

    expect(res.status).toBe(400);
  });

  it("keeps organizations isolated: an admin cannot see or manage another org's users", async () => {
    const orgAToken = await registerAndLogin({ ...ADMIN, organizationName: "Org A", email: "admin-a@ugnexa.test" });
    const orgBToken = await registerAndLogin({ ...ADMIN, organizationName: "Org B", email: "admin-b@ugnexa.test" });
    const orgBRoleId = await createRole(orgBToken, "Member");

    const orgBMember = await createMember(orgBToken, orgBRoleId, "member-b@ugnexa.test");
    const orgBMemberId = orgBMember.body.data.id;

    // Org A's admin only sees their own org (just themselves — one user).
    const listRes = await request(app).get("/api/users").set("Authorization", `Bearer ${orgAToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.every((u: { email: string }) => u.email.endsWith("admin-a@ugnexa.test"))).toBe(true);

    // Org A's admin cannot deactivate a user that belongs to org B.
    const deactivateRes = await request(app)
      .delete(`/api/users/${orgBMemberId}`)
      .set("Authorization", `Bearer ${orgAToken}`);
    expect(deactivateRes.status).toBe(404);
  });
});
