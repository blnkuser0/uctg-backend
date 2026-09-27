import request from "supertest";
import { app } from "../src/server";
import * as emitter from "../src/utils/socketEmitter";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";

const ADMIN = { organizationName: "Fitout Co", name: "Ada Admin", email: "ada@ugnexa.test", password: "supersecret1" };

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, organizationId: res.body.data.user.organizationId as string };
}

async function setup() {
  await createTestOrgAndAdmin(ADMIN);
  const admin = await login(ADMIN.email, ADMIN.password);
  const role = await request(app).post("/api/roles").set("Authorization", `Bearer ${admin.token}`).send({ name: "Member", permissions: [] });
  await request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ name: "Mona Member", email: "mona@ugnexa.test", password: "supersecret2", roleId: role.body.data.id });
  const member = await login("mona@ugnexa.test", "supersecret2");
  return { admin, member };
}

const LEAVE = { startDate: "2026-10-01", endDate: "2026-10-02", leaveType: "vacation", reason: "Trip" };

describe("Realtime data-changed pings", () => {
  let spy: jest.SpyInstance;

  beforeEach(() => {
    spy = jest.spyOn(emitter, "emitDataChanged").mockImplementation(() => undefined);
  });
  afterEach(() => spy.mockRestore());

  const resourcesPinged = () => spy.mock.calls.map((call) => call[1]);

  it("pings the whole organization after a successful write, once per request, naming the resource", async () => {
    const { member } = await setup();
    spy.mockClear();

    const created = await request(app).post("/api/leaves").set("Authorization", `Bearer ${member.token}`).send(LEAVE);
    expect(created.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(member.organizationId, "leaves");

    spy.mockClear();
    const removed = await request(app).delete(`/api/leaves/${created.body.data._id}`).set("Authorization", `Bearer ${member.token}`);
    expect(removed.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(member.organizationId, "leaves");
  });

  it("covers the other pages too: attendance clocking, accomplishments, users, and roles", async () => {
    const { admin } = await setup();
    spy.mockClear();

    await request(app).post("/api/timeclock/clock").set("Authorization", `Bearer ${admin.token}`).send({ type: "time-in" });
    await request(app).post("/api/accomplishments").set("Authorization", `Bearer ${admin.token}`).send({ date: "2026-01-05", text: "Did a thing" });
    await request(app).post("/api/roles").set("Authorization", `Bearer ${admin.token}`).send({ name: "Extra", permissions: [] });

    expect(resourcesPinged()).toEqual(expect.arrayContaining(["timeclock", "accomplishments", "roles"]));
    for (const call of spy.mock.calls) expect(call[0]).toBe(admin.organizationId);
  });

  it("does not ping for reads, failed writes, or chat (which has its own realtime events)", async () => {
    const { admin, member } = await setup();
    spy.mockClear();

    await request(app).get("/api/leaves/mine").set("Authorization", `Bearer ${member.token}`);
    const invalid = await request(app).post("/api/leaves").set("Authorization", `Bearer ${member.token}`).send({ reason: "no dates" });
    expect(invalid.status).toBe(400);
    const forbidden = await request(app).get("/api/leaves").set("Authorization", `Bearer ${member.token}`);
    expect(forbidden.status).toBe(403);

    const other = await request(app).get("/api/users").set("Authorization", `Bearer ${admin.token}`);
    const monaId = other.body.data.find((u: { email: string }) => u.email === "mona@ugnexa.test").id;
    await request(app).post("/api/channels/dm").set("Authorization", `Bearer ${admin.token}`).send({ userId: monaId });

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Project room membership follows the project's members", () => {
  it("joins the creator on create and a member on add, and leaves them on remove", async () => {
    const { admin } = await setup();
    const join = jest.spyOn(emitter, "joinUserToProject").mockImplementation(() => undefined);
    const leave = jest.spyOn(emitter, "removeUserFromProject").mockImplementation(() => undefined);
    const close = jest.spyOn(emitter, "closeProjectRoom").mockImplementation(() => undefined);

    const project = await request(app).post("/api/projects").set("Authorization", `Bearer ${admin.token}`).send({ name: "Alpha" });
    expect(project.status).toBe(201);
    const projectId = project.body.data._id as string;
    expect(join).toHaveBeenCalledWith(expect.any(String), projectId);

    const users = await request(app).get("/api/users").set("Authorization", `Bearer ${admin.token}`);
    const monaId = users.body.data.find((u: { email: string }) => u.email === "mona@ugnexa.test").id as string;

    await request(app).post(`/api/projects/${projectId}/members`).set("Authorization", `Bearer ${admin.token}`).send({ userId: monaId });
    expect(join).toHaveBeenCalledWith(monaId, projectId);

    await request(app).delete(`/api/projects/${projectId}/members/${monaId}`).set("Authorization", `Bearer ${admin.token}`);
    expect(leave).toHaveBeenCalledWith(monaId, projectId);

    await request(app).delete(`/api/projects/${projectId}`).set("Authorization", `Bearer ${admin.token}`);
    expect(close).toHaveBeenCalledWith(projectId);

    join.mockRestore();
    leave.mockRestore();
    close.mockRestore();
  });
});
