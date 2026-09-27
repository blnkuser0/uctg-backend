import request from "supertest";
import { app } from "../src/server";
import { TimeLog } from "../src/models/TimeLog.model";
import { parsePhDateKey } from "../src/utils/phTime";
import { cutoffRange, weekRange } from "../src/utils/attendancePeriods";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";

describe("weekRange / cutoffRange", () => {
  it("uses Monday–Sunday weeks, including Sunday and month-crossing weeks", () => {
    expect(weekRange("2025-06-11")).toEqual({ from: "2025-06-09", to: "2025-06-15" });
    expect(weekRange("2025-06-09")).toEqual({ from: "2025-06-09", to: "2025-06-15" });
    expect(weekRange("2025-06-15")).toEqual({ from: "2025-06-09", to: "2025-06-15" });
    expect(weekRange("2025-07-01")).toEqual({ from: "2025-06-30", to: "2025-07-06" });
  });

  it("uses semi-monthly cut-offs: 1st–15th and 16th–end of month (incl. leap Feb)", () => {
    expect(cutoffRange("2025-06-01")).toEqual({ from: "2025-06-01", to: "2025-06-15" });
    expect(cutoffRange("2025-06-15")).toEqual({ from: "2025-06-01", to: "2025-06-15" });
    expect(cutoffRange("2025-06-16")).toEqual({ from: "2025-06-16", to: "2025-06-30" });
    expect(cutoffRange("2025-07-31")).toEqual({ from: "2025-07-16", to: "2025-07-31" });
    expect(cutoffRange("2025-02-20")).toEqual({ from: "2025-02-16", to: "2025-02-28" });
    expect(cutoffRange("2024-02-20")).toEqual({ from: "2024-02-16", to: "2024-02-29" });
  });
});

const ADMIN = { organizationName: "Fitout Co", name: "Ada Admin", email: "ada@ugnexa.test", password: "supersecret1" };

async function loginWithId(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return {
    token: res.body.data.accessToken as string,
    userId: res.body.data.user.id as string,
    organizationId: res.body.data.user.organizationId as string,
  };
}

async function createRole(adminToken: string, name: string, permissions: string[] = []) {
  const res = await request(app).post("/api/roles").set("Authorization", `Bearer ${adminToken}`).send({ name, permissions });
  return res.body.data.id as string;
}

async function createUser(adminToken: string, roleId: string, name: string, email: string, password: string) {
  await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send({ name, email, password, roleId });
  return loginWithId(email, password);
}

// One shift on a PH day: time-in at 9:00 PH, time-out `hours` later.
function shift(organizationId: string, userId: string, dateKey: string, hours: number) {
  const nine = parsePhDateKey(dateKey).getTime() + 9 * 60 * 60 * 1000;
  return [
    { organizationId, userId, type: "time-in", timestamp: new Date(nine) },
    { organizationId, userId, type: "time-out", timestamp: new Date(nine + hours * 60 * 60 * 1000) },
  ];
}

async function setup() {
  await createTestOrgAndAdmin(ADMIN);
  const admin = await loginWithId(ADMIN.email, ADMIN.password);
  const memberRole = await createRole(admin.token, "Member");
  const viewerRole = await createRole(admin.token, "Payroll", ["attendance.view_all"]);
  const member = await createUser(admin.token, memberRole, "Mona Member", "mona@ugnexa.test", "supersecret2");
  const other = await createUser(admin.token, memberRole, "Otto Other", "otto@ugnexa.test", "supersecret3");
  const viewer = await createUser(admin.token, viewerRole, "Pia Payroll", "pia@ugnexa.test", "supersecret4");
  return { admin, member, other, viewer };
}

describe("Attendance week & cut-off summary", () => {
  it("totals hours and days present per week and per cut-off from raw clock events", async () => {
    const { member } = await setup();
    const org = member.organizationId;
    // 06-09/10 are in the week of the 11th and in the 1st–15th cut-off; 06-16 is next week / next cut-off.
    await TimeLog.create([
      ...shift(org, member.userId, "2025-06-09", 8),
      ...shift(org, member.userId, "2025-06-10", 4),
      ...shift(org, member.userId, "2025-06-16", 2),
    ]);

    const first = await request(app).get("/api/timeclock/summary?date=2025-06-11").set("Authorization", `Bearer ${member.token}`);
    expect(first.status).toBe(200);
    expect(first.body.data.week).toEqual({ from: "2025-06-09", to: "2025-06-15", totalMinutes: 720, daysPresent: 2 });
    expect(first.body.data.cutoff).toEqual({ from: "2025-06-01", to: "2025-06-15", totalMinutes: 720, daysPresent: 2 });

    const second = await request(app).get("/api/timeclock/summary?date=2025-06-17").set("Authorization", `Bearer ${member.token}`);
    expect(second.body.data.week).toEqual({ from: "2025-06-16", to: "2025-06-22", totalMinutes: 120, daysPresent: 1 });
    expect(second.body.data.cutoff).toEqual({ from: "2025-06-16", to: "2025-06-30", totalMinutes: 120, daysPresent: 1 });
  });

  it("splits a week that straddles two cut-offs correctly between the week and the cut-off", async () => {
    const { member } = await setup();
    const org = member.organizationId;
    // The week 2025-06-30..07-06 spans the end of June's second cut-off and the start of July's first.
    await TimeLog.create([...shift(org, member.userId, "2025-06-30", 8), ...shift(org, member.userId, "2025-07-02", 6)]);

    const res = await request(app).get("/api/timeclock/summary?date=2025-07-02").set("Authorization", `Bearer ${member.token}`);
    expect(res.body.data.week).toEqual({ from: "2025-06-30", to: "2025-07-06", totalMinutes: 840, daysPresent: 2 });
    expect(res.body.data.cutoff).toEqual({ from: "2025-07-01", to: "2025-07-15", totalMinutes: 360, daysPresent: 1 });
  });

  it("keeps another employee's data off-limits without the permission, and allows it with it", async () => {
    const { member, other, viewer } = await setup();
    await TimeLog.create(shift(member.organizationId, member.userId, "2025-06-10", 8));

    const denied = await request(app)
      .get(`/api/timeclock/summary?date=2025-06-11&userId=${member.userId}`)
      .set("Authorization", `Bearer ${other.token}`);
    expect(denied.status).toBe(403);

    const deniedCalendar = await request(app)
      .get(`/api/timeclock/calendar?month=2025-06&userId=${member.userId}`)
      .set("Authorization", `Bearer ${other.token}`);
    expect(deniedCalendar.status).toBe(403);

    const allowed = await request(app)
      .get(`/api/timeclock/summary?date=2025-06-11&userId=${member.userId}`)
      .set("Authorization", `Bearer ${viewer.token}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.week.totalMinutes).toBe(480);

    const calendar = await request(app)
      .get(`/api/timeclock/calendar?month=2025-06&userId=${member.userId}`)
      .set("Authorization", `Bearer ${viewer.token}`);
    expect(calendar.status).toBe(200);
    expect(calendar.body.data.find((d: { date: string }) => d.date === "2025-06-10").workedMinutes).toBe(480);

    // Passing your own id is just "mine" — no permission needed.
    const own = await request(app)
      .get(`/api/timeclock/summary?date=2025-06-11&userId=${other.userId}`)
      .set("Authorization", `Bearer ${other.token}`);
    expect(own.status).toBe(200);
  });

  it("rejects viewing a user id that is not in the caller's organization", async () => {
    const { viewer } = await setup();
    const res = await request(app)
      .get("/api/timeclock/summary?date=2025-06-11&userId=64b7f0f0f0f0f0f0f0f0f0f0")
      .set("Authorization", `Bearer ${viewer.token}`);
    expect(res.status).toBe(404);
  });

  it("gives the team table only to attendance.view_all holders, one row per active member", async () => {
    const { admin, member, other, viewer } = await setup();
    await TimeLog.create([
      ...shift(member.organizationId, member.userId, "2025-06-10", 8),
      ...shift(member.organizationId, other.userId, "2025-06-10", 5),
    ]);

    const denied = await request(app).get("/api/timeclock/summary/team?date=2025-06-11").set("Authorization", `Bearer ${member.token}`);
    expect(denied.status).toBe(403);

    const res = await request(app).get("/api/timeclock/summary/team?date=2025-06-11").set("Authorization", `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      res.body.data.map((e: { name: string; summary: { week: { totalMinutes: number; daysPresent: number } } }) => [e.name, e.summary.week])
    );
    expect(byName["Mona Member"]).toMatchObject({ totalMinutes: 480, daysPresent: 1 });
    expect(byName["Otto Other"]).toMatchObject({ totalMinutes: 300, daysPresent: 1 });
    expect(byName["Ada Admin"]).toMatchObject({ totalMinutes: 0, daysPresent: 0 });
    expect(res.body.data).toHaveLength(4);

    // The seeded Admin role carries every permission, including the new one.
    const adminRes = await request(app).get("/api/timeclock/summary/team?date=2025-06-11").set("Authorization", `Bearer ${admin.token}`);
    expect(adminRes.status).toBe(200);
  });

  it("validates the date query", async () => {
    const { member } = await setup();
    const res = await request(app).get("/api/timeclock/summary?date=nope").set("Authorization", `Bearer ${member.token}`);
    expect(res.status).toBe(400);
  });
});
