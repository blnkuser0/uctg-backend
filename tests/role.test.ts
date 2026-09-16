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

async function getAdminRoleId(adminToken: string) {
  const res = await request(app).get("/api/roles").set("Authorization", `Bearer ${adminToken}`);
  return res.body.data[0].id as string;
}

describe("Roles & permissions", () => {
  it("seeds an 'Admin' role with every permission at registration", async () => {
    const adminToken = await loginAsAdmin();
    const res = await request(app).get("/api/roles").set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe("Admin");
    expect(res.body.data[0].permissions).toEqual(
      expect.arrayContaining(["leaves.view_all", "leaves.approve_hr", "leaves.approve_admin", "users.manage", "roles.manage"])
    );
    expect(res.body.data[0].userCount).toBe(1);
  });

  it("lets an admin create a custom role with a chosen permission subset", async () => {
    const adminToken = await loginAsAdmin();
    const res = await request(app)
      .post("/api/roles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Supervisor", permissions: ["leaves.approve_hr"] });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe("Supervisor");
    expect(res.body.data.permissions).toEqual(["leaves.approve_hr"]);
  });

  it("a user under a custom role can only do what that role allows", async () => {
    const adminToken = await loginAsAdmin();
    const roleRes = await request(app)
      .post("/api/roles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Supervisor", permissions: ["leaves.approve_hr"] });
    const supervisorRoleId = roleRes.body.data.id;

    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Sam Supervisor", email: "sam@ugnexa.test", password: "supersecret2", roleId: supervisorRoleId });
    const loginRes = await request(app).post("/api/auth/login").send({ email: "sam@ugnexa.test", password: "supersecret2" });
    const supervisorToken = loginRes.body.data.accessToken;

    const leave = await request(app)
      .post("/api/leaves")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ startDate: "2026-10-01", endDate: "2026-10-02", reason: "test" });

    const hrDecision = await request(app)
      .patch(`/api/leaves/${leave.body.data._id}/hr-decision`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ status: "approved" });
    expect(hrDecision.status).toBe(200);

    const adminDecision = await request(app)
      .patch(`/api/leaves/${leave.body.data._id}/admin-decision`)
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ status: "approved" });
    expect(adminDecision.status).toBe(403);

    const usersRes = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${supervisorToken}`)
      .send({ name: "X", email: "x@ugnexa.test", password: "password123", roleId: supervisorRoleId });
    expect(usersRes.status).toBe(403);
  });

  it("rejects deleting a role that still has users assigned", async () => {
    const adminToken = await loginAsAdmin();
    const adminRoleId = await getAdminRoleId(adminToken);

    const res = await request(app).delete(`/api/roles/${adminRoleId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it("allows deleting a role with no users assigned", async () => {
    const adminToken = await loginAsAdmin();
    const roleRes = await request(app)
      .post("/api/roles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Unused", permissions: [] });

    const res = await request(app)
      .delete(`/api/roles/${roleRes.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("refuses to strip roles.manage from the only role that has it", async () => {
    const adminToken = await loginAsAdmin();
    const adminRoleId = await getAdminRoleId(adminToken);

    const res = await request(app)
      .patch(`/api/roles/${adminRoleId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ permissions: ["leaves.approve_hr"] }); // drops roles.manage

    expect(res.status).toBe(400);
  });

  it("allows stripping roles.manage from one role if another role still has it", async () => {
    const adminToken = await loginAsAdmin();
    const adminRoleId = await getAdminRoleId(adminToken);

    await request(app)
      .post("/api/roles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Second Admin", permissions: ["roles.manage"] });

    const res = await request(app)
      .patch(`/api/roles/${adminRoleId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ permissions: ["leaves.approve_hr"] });

    expect(res.status).toBe(200);
  });

  it("blocks a non-roles.manage user from touching /roles at all", async () => {
    const adminToken = await loginAsAdmin();
    const roleRes = await request(app)
      .post("/api/roles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Plain", permissions: [] });
    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Plain User", email: "plain@ugnexa.test", password: "supersecret2", roleId: roleRes.body.data.id });
    const loginRes = await request(app).post("/api/auth/login").send({ email: "plain@ugnexa.test", password: "supersecret2" });

    const res = await request(app).get("/api/roles").set("Authorization", `Bearer ${loginRes.body.data.accessToken}`);
    expect(res.status).toBe(403);
  });
});
