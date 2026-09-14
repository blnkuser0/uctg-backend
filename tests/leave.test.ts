import request from "supertest";
import { app } from "../src/server";
import { Notification } from "../src/models/Notification.model";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return res.body.data.accessToken as string;
}

async function loginWithId(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function createRole(adminToken: string, name: string, permissions: string[]) {
  const res = await request(app)
    .post("/api/roles")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name, permissions });
  return res.body.data.id as string;
}

async function createUserWithRole(adminToken: string, roleId: string, name: string, email: string, password: string) {
  await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send({ name, email, password, roleId });
  return login(email, password);
}

async function setup() {
  await request(app).post("/api/auth/register").send(ADMIN);
  const adminToken = await login(ADMIN.email, ADMIN.password);

  const hrRoleId = await createRole(adminToken, "HR", ["leaves.view_all", "leaves.approve_hr"]);
  const hrToken = await createUserWithRole(adminToken, hrRoleId, "Helen HR", "helen@ugnexa.test", "supersecret2");

  const memberRoleId = await createRole(adminToken, "Member", []);
  const memberToken = await createUserWithRole(
    adminToken,
    memberRoleId,
    "Mona Member",
    "mona@ugnexa.test",
    "supersecret3"
  );

  return { adminToken, hrToken, memberToken };
}

async function setupWithIds() {
  const adminReg = await request(app).post("/api/auth/register").send(ADMIN);
  const adminId = adminReg.body.data.id as string;
  const adminToken = await login(ADMIN.email, ADMIN.password);

  const hrRoleId = await createRole(adminToken, "HR", ["leaves.view_all", "leaves.approve_hr"]);
  await request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Helen HR", email: "helen@ugnexa.test", password: "supersecret2", roleId: hrRoleId });
  const hr = await loginWithId("helen@ugnexa.test", "supersecret2");

  const memberRoleId = await createRole(adminToken, "Member", []);
  await request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ name: "Mona Member", email: "mona@ugnexa.test", password: "supersecret3", roleId: memberRoleId });
  const member = await loginWithId("mona@ugnexa.test", "supersecret3");

  return { adminToken, adminId, hr, member };
}

const LEAVE_INPUT = { startDate: "2026-10-01", endDate: "2026-10-03", reason: "Family trip" };

describe("Leave requests — HR/Admin dual approval", () => {
  it("lets any user submit a leave request, starting fully pending", async () => {
    const { memberToken } = await setup();
    const res = await request(app)
      .post("/api/leaves")
      .set("Authorization", `Bearer ${memberToken}`)
      .send(LEAVE_INPUT);

    expect(res.status).toBe(201);
    expect(res.body.data.hrStatus).toBe("pending");
    expect(res.body.data.adminStatus).toBe("pending");
    expect(res.body.data.status).toBe("pending");
  });

  it("HR approve + Admin reject => overall rejected (Admin has final say)", async () => {
    const { memberToken, hrToken, adminToken } = await setup();
    const created = await request(app).post("/api/leaves").set("Authorization", `Bearer ${memberToken}`).send(LEAVE_INPUT);
    const leaveId = created.body.data._id;

    const hrRes = await request(app)
      .patch(`/api/leaves/${leaveId}/hr-decision`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ status: "approved" });
    expect(hrRes.status).toBe(200);
    expect(hrRes.body.data.status).toBe("pending"); // admin hasn't ruled yet

    const adminRes = await request(app)
      .patch(`/api/leaves/${leaveId}/admin-decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "rejected" });
    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data.hrStatus).toBe("approved");
    expect(adminRes.body.data.adminStatus).toBe("rejected");
    expect(adminRes.body.data.status).toBe("rejected");
  });

  it("HR reject + Admin approve => overall approved (Admin overrides HR)", async () => {
    const { memberToken, hrToken, adminToken } = await setup();
    const created = await request(app).post("/api/leaves").set("Authorization", `Bearer ${memberToken}`).send(LEAVE_INPUT);
    const leaveId = created.body.data._id;

    await request(app)
      .patch(`/api/leaves/${leaveId}/hr-decision`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ status: "rejected" });

    const adminRes = await request(app)
      .patch(`/api/leaves/${leaveId}/admin-decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "approved" });

    expect(adminRes.body.data.hrStatus).toBe("rejected");
    expect(adminRes.body.data.adminStatus).toBe("approved");
    expect(adminRes.body.data.status).toBe("approved");
  });

  it("blocks a member from viewing all leaves or deciding on any", async () => {
    const { memberToken } = await setup();
    const created = await request(app).post("/api/leaves").set("Authorization", `Bearer ${memberToken}`).send(LEAVE_INPUT);
    const leaveId = created.body.data._id;

    const listRes = await request(app).get("/api/leaves").set("Authorization", `Bearer ${memberToken}`);
    expect(listRes.status).toBe(403);

    const hrRes = await request(app)
      .patch(`/api/leaves/${leaveId}/hr-decision`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ status: "approved" });
    expect(hrRes.status).toBe(403);

    const adminRes = await request(app)
      .patch(`/api/leaves/${leaveId}/admin-decision`)
      .set("Authorization", `Bearer ${memberToken}`)
      .send({ status: "approved" });
    expect(adminRes.status).toBe(403);
  });

  it("blocks HR from making the admin decision", async () => {
    const { memberToken, hrToken } = await setup();
    const created = await request(app).post("/api/leaves").set("Authorization", `Bearer ${memberToken}`).send(LEAVE_INPUT);
    const leaveId = created.body.data._id;

    const res = await request(app)
      .patch(`/api/leaves/${leaveId}/admin-decision`)
      .set("Authorization", `Bearer ${hrToken}`)
      .send({ status: "approved" });
    expect(res.status).toBe(403);
  });

  it("lets a requester cancel their own pending request, but not after a final decision", async () => {
    const { memberToken, adminToken } = await setup();
    const created = await request(app).post("/api/leaves").set("Authorization", `Bearer ${memberToken}`).send(LEAVE_INPUT);
    const leaveId = created.body.data._id;

    const cancelRes = await request(app).delete(`/api/leaves/${leaveId}`).set("Authorization", `Bearer ${memberToken}`);
    expect(cancelRes.status).toBe(200);

    const second = await request(app).post("/api/leaves").set("Authorization", `Bearer ${memberToken}`).send(LEAVE_INPUT);
    const secondId = second.body.data._id;
    await request(app)
      .patch(`/api/leaves/${secondId}/admin-decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "approved" });

    const blockedCancel = await request(app)
      .delete(`/api/leaves/${secondId}`)
      .set("Authorization", `Bearer ${memberToken}`);
    expect(blockedCancel.status).toBe(400);
  });

  it("lets a member see only their own requests via /mine", async () => {
    const { memberToken } = await setup();
    await request(app).post("/api/leaves").set("Authorization", `Bearer ${memberToken}`).send(LEAVE_INPUT);

    const res = await request(app).get("/api/leaves/mine").set("Authorization", `Bearer ${memberToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("Leave notifications", () => {
  it("notifies HR and Admin approvers when a leave is submitted", async () => {
    const { hr, member } = await setupWithIds();
    await request(app).post("/api/leaves").set("Authorization", `Bearer ${member.token}`).send(LEAVE_INPUT);

    const hrNotifications = await Notification.find({ userId: hr.userId, type: "leave_submitted" });
    expect(hrNotifications).toHaveLength(1);
    expect(hrNotifications[0].actorId.toString()).toBe(member.userId);

    const adminNotifications = await Notification.find({ type: "leave_submitted" });
    expect(adminNotifications.length).toBeGreaterThanOrEqual(2); // HR + the auto-seeded Admin role
  });

  it("notifies Admin approvers once HR decides, only while the admin ruling is still pending", async () => {
    const { adminToken, hr, member } = await setupWithIds();
    const created = await request(app).post("/api/leaves").set("Authorization", `Bearer ${member.token}`).send(LEAVE_INPUT);
    const leaveId = created.body.data._id;

    await request(app)
      .patch(`/api/leaves/${leaveId}/hr-decision`)
      .set("Authorization", `Bearer ${hr.token}`)
      .send({ status: "approved" });

    const adminNotifications = await Notification.find({ type: "leave_hr_decided" });
    expect(adminNotifications.length).toBeGreaterThanOrEqual(1);
    expect(adminNotifications[0].actorId.toString()).toBe(hr.userId);

    // Once Admin has already ruled, a later HR update should not notify again.
    await request(app)
      .patch(`/api/leaves/${leaveId}/admin-decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "approved" });

    await request(app)
      .patch(`/api/leaves/${leaveId}/hr-decision`)
      .set("Authorization", `Bearer ${hr.token}`)
      .send({ status: "approved", note: "updated note" });

    const stillOne = await Notification.find({ type: "leave_hr_decided" });
    expect(stillOne).toHaveLength(adminNotifications.length);
  });

  it("notifies the requester with the final decision once Admin rules", async () => {
    const { adminToken, member } = await setupWithIds();
    const created = await request(app).post("/api/leaves").set("Authorization", `Bearer ${member.token}`).send(LEAVE_INPUT);
    const leaveId = created.body.data._id;

    await request(app)
      .patch(`/api/leaves/${leaveId}/admin-decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "rejected" });

    const requesterNotifications = await Notification.find({ userId: member.userId, type: "leave_decided" });
    expect(requesterNotifications).toHaveLength(1);
    expect(requesterNotifications[0].title).toContain("rejected");
  });
});
