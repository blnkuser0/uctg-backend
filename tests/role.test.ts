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
  it("matches the employee directory after deletion, deactivation, and role reassignment", async () => {
    const token = await loginAsAdmin();
    const authorization = `Bearer ${token}`;
    const role = await request(app).post("/api/roles").set("Authorization", authorization)
      .send({ name: "Web Dev", permissions: [] });
    const roleId = role.body.data.id;
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      const created = await request(app).post("/api/users").set("Authorization", authorization)
        .send({ name: `Developer ${index}`, email: `dev${index}@ugnexa.test`, roleId });
      expect(created.status).toBe(201);
      ids.push(created.body.data.id);
    }
    const count = async () => {
      const response = await request(app).get("/api/roles").set("Authorization", authorization);
      expect(response.status).toBe(200);
      return response.body.data.find((entry: { id: string }) => entry.id === roleId).userCount;
    };
    expect(await count()).toBe(3);
    for (const id of ids.slice(1)) {
      const removed = await request(app).delete(`/api/users/${id}/permanent`).set("Authorization", authorization);
      expect(removed.status).toBe(200);
    }
    expect(await count()).toBe(1);
    const users = await request(app).get("/api/users").set("Authorization", authorization);
    expect(users.body.data.filter((user: { role: { id: string } }) => user.role.id === roleId)).toHaveLength(1);

    const deactivated = await request(app).delete(`/api/users/${ids[0]}`).set("Authorization", authorization);
    expect(deactivated.status).toBe(200);
    expect(await count()).toBe(1);
    const blocked = await request(app).delete(`/api/roles/${roleId}`).set("Authorization", authorization);
    expect(blocked.status).toBe(409);

    const reassigned = await request(app).patch(`/api/users/${ids[0]}`).set("Authorization", authorization)
      .send({ roleId: await getAdminRoleId(token) });
    expect(reassigned.status).toBe(200);
    expect(await count()).toBe(0);
    // Deleted historical users must not prevent deleting a now-empty role.
    const removedRole = await request(app).delete(`/api/roles/${roleId}`).set("Authorization", authorization);
    expect(removedRole.status).toBe(200);
  });

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
      .send({ startDate: "2026-10-01", endDate: "2026-10-02", leaveType: "sick", reason: "test" });

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

  it("lets a permissions-only PATCH succeed without touching the role's name", async () => {
    const adminToken = await loginAsAdmin();
    const roleRes = await request(app)
      .post("/api/roles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Keep My Name", permissions: [] });

    const res = await request(app)
      .patch(`/api/roles/${roleRes.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ permissions: ["tasks.manage"] });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Keep My Name");
    expect(res.body.data.permissions).toEqual(["tasks.manage"]);
  });

  it("round-trips tasks.manage through create, list, and update like any other permission", async () => {
    const adminToken = await loginAsAdmin();
    const created = await request(app)
      .post("/api/roles")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Task Lead", permissions: ["tasks.manage"] });
    expect(created.status).toBe(201);
    expect(created.body.data.permissions).toEqual(["tasks.manage"]);

    const list = await request(app).get("/api/roles").set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.data.find((r: { id: string }) => r.id === created.body.data.id).permissions).toEqual(["tasks.manage"]);

    const updated = await request(app)
      .patch(`/api/roles/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ permissions: [] });
    expect(updated.status).toBe(200);
    expect(updated.body.data.permissions).toEqual([]);
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
