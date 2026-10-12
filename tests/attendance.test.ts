import request from "supertest";
import { app } from "../src/server";
import { TimeLog } from "../src/models/TimeLog.model";
import { parsePhDateKey, phDateKey } from "../src/utils/phTime";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function loginWithId(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, userId: res.body.data.user.id as string };
}

async function createRole(adminToken: string, name: string, permissions: string[] = []) {
  const res = await request(app).post("/api/roles").set("Authorization", `Bearer ${adminToken}`).send({ name, permissions });
  return res.body.data.id as string;
}

async function createUser(adminToken: string, roleId: string, name: string, email: string, password: string) {
  await request(app).post("/api/users").set("Authorization", `Bearer ${adminToken}`).send({ name, email, password, roleId });
  return loginWithId(email, password);
}

async function setup() {
  const reg = await createTestOrgAndAdmin(ADMIN);
  const adminId = reg.id;
  const adminLogin = await loginWithId(ADMIN.email, ADMIN.password);

  const memberRoleId = await createRole(adminLogin.token, "Member");
  const member = await createUser(adminLogin.token, memberRoleId, "Mona Member", "mona@ugnexa.test", "supersecret2");
  const other = await createUser(adminLogin.token, memberRoleId, "Otto Other", "otto@ugnexa.test", "supersecret3");

  return { adminToken: adminLogin.token, adminId, member, other };
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

describe("Attendance calendar — personal", () => {
  it("summarizes present/absent/weekend days across a month, from raw clock events", async () => {
    const { member } = await setup();
    const now = new Date();
    const presentDay = new Date(now.getFullYear(), now.getMonth() - 1, 10);
    const emptyDay = new Date(now.getFullYear(), now.getMonth() - 1, 11);

    const usersRes = await request(app).get("/api/users").set("Authorization", `Bearer ${member.token}`);
    const organizationId = usersRes.body.data[0].organizationId as string;

    const presentKey = `${presentDay.getFullYear()}-${String(presentDay.getMonth() + 1).padStart(2, "0")}-${String(presentDay.getDate()).padStart(2, "0")}`;
    const emptyKey = `${emptyDay.getFullYear()}-${String(emptyDay.getMonth() + 1).padStart(2, "0")}-${String(emptyDay.getDate()).padStart(2, "0")}`;

    // Anchor to PH midnight via parsePhDateKey (fixed UTC+8 math, independent
    // of the test runner's own OS timezone) rather than the local .setHours()
    // this used to use — on a UTC CI runner, "9am/5pm local" is "5pm/1am PH",
    // which spuriously rolls the shift's clock-out into the next PH day.
    const phMidnight = parsePhDateKey(presentKey);
    const timeIn = new Date(phMidnight.getTime() + 9 * 60 * 60 * 1000); // 9am PH
    const timeOut = new Date(phMidnight.getTime() + 17 * 60 * 60 * 1000); // 5pm PH

    await TimeLog.create([
      { organizationId, userId: member.userId, type: "time-in", timestamp: timeIn },
      { organizationId, userId: member.userId, type: "time-out", timestamp: timeOut },
    ]);

    const month = `${presentDay.getFullYear()}-${String(presentDay.getMonth() + 1).padStart(2, "0")}`;
    const res = await request(app)
      .get(`/api/timeclock/calendar?month=${month}`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(res.status).toBe(200);

    const presentSummary = res.body.data.find((d: { date: string }) => d.date === presentKey);
    expect(presentSummary.status).toBe("present");
    expect(presentSummary.workedMinutes).toBe(480);

    const emptySummary = res.body.data.find((d: { date: string }) => d.date === emptyKey);
    expect(emptySummary.status).toBe(isWeekend(emptyDay) ? "weekend" : "absent");
  });

  it("attributes a graveyard shift crossing midnight entirely to the day it started", async () => {
    const { member } = await setup();
    const now = new Date();
    const shiftStartDay = new Date(now.getFullYear(), now.getMonth() - 1, 12);
    const shiftEndDay = new Date(now.getFullYear(), now.getMonth() - 1, 13);

    const usersRes = await request(app).get("/api/users").set("Authorization", `Bearer ${member.token}`);
    const organizationId = usersRes.body.data[0].organizationId as string;

    const startKey = `${shiftStartDay.getFullYear()}-${String(shiftStartDay.getMonth() + 1).padStart(2, "0")}-${String(shiftStartDay.getDate()).padStart(2, "0")}`;
    const endKey = `${shiftEndDay.getFullYear()}-${String(shiftEndDay.getMonth() + 1).padStart(2, "0")}-${String(shiftEndDay.getDate()).padStart(2, "0")}`;

    const startMidnight = parsePhDateKey(startKey);
    const timeIn = new Date(startMidnight.getTime() + 21 * 60 * 60 * 1000); // 9pm PH on the start day
    const timeOut = new Date(startMidnight.getTime() + (24 + 5) * 60 * 60 * 1000); // 5am PH the next day

    await TimeLog.create([
      { organizationId, userId: member.userId, type: "time-in", timestamp: timeIn },
      { organizationId, userId: member.userId, type: "time-out", timestamp: timeOut },
    ]);

    const month = `${shiftStartDay.getFullYear()}-${String(shiftStartDay.getMonth() + 1).padStart(2, "0")}`;
    const res = await request(app)
      .get(`/api/timeclock/calendar?month=${month}`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(res.status).toBe(200);

    const startSummary = res.body.data.find((d: { date: string }) => d.date === startKey);
    expect(startSummary.status).toBe("present");
    expect(startSummary.workedMinutes).toBe(8 * 60); // 9pm -> 5am = 8 hours, all on the start day
    expect(startSummary.lastTimeOut).not.toBeNull(); // shows the actual 5am end time, even though it's "tomorrow"

    // The day the shift ENDED on must not also count as present/worked — only the day it
    // started counts, so a graveyard shift doesn't prematurely eat into the next cut-off day.
    const endSummary = res.body.data.find((d: { date: string }) => d.date === endKey);
    expect(endSummary.status).toBe(isWeekend(shiftEndDay) ? "weekend" : "absent");
    expect(endSummary.workedMinutes).toBe(0);
  });

  it("computes break minutes for a day, separate from worked minutes", async () => {
    const { member } = await setup();
    const now = new Date();
    const breakDay = new Date(now.getFullYear(), now.getMonth() - 1, 12);

    const usersRes = await request(app).get("/api/users").set("Authorization", `Bearer ${member.token}`);
    const organizationId = usersRes.body.data[0].organizationId as string;

    const breakKey = `${breakDay.getFullYear()}-${String(breakDay.getMonth() + 1).padStart(2, "0")}-${String(breakDay.getDate()).padStart(2, "0")}`;
    const phMidnight = parsePhDateKey(breakKey);
    const timeIn = new Date(phMidnight.getTime() + 9 * 60 * 60 * 1000); // 9am PH
    const breakIn = new Date(phMidnight.getTime() + 10 * 60 * 60 * 1000); // 10am PH
    const breakOut = new Date(breakIn.getTime() + 75 * 60 * 1000); // 75 minutes later — over the 60-minute cap
    const timeOut = new Date(phMidnight.getTime() + 17 * 60 * 60 * 1000); // 5pm PH

    await TimeLog.create([
      { organizationId, userId: member.userId, type: "time-in", timestamp: timeIn },
      { organizationId, userId: member.userId, type: "break-in", timestamp: breakIn },
      { organizationId, userId: member.userId, type: "break-out", timestamp: breakOut },
      { organizationId, userId: member.userId, type: "time-out", timestamp: timeOut },
    ]);

    const month = `${breakDay.getFullYear()}-${String(breakDay.getMonth() + 1).padStart(2, "0")}`;
    const res = await request(app)
      .get(`/api/timeclock/calendar?month=${month}`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(res.status).toBe(200);

    const summary = res.body.data.find((d: { date: string }) => d.date === breakKey);
    expect(summary.breakMinutes).toBe(75);
    // Worked minutes only counts clocked-in time outside the break, so it must exclude the 75-minute break.
    expect(summary.workedMinutes).toBe(480 - 75);
  });

  it("marks a day covered by an approved leave as on-leave instead of absent", async () => {
    const { adminToken, member } = await setup();
    const now = new Date();
    const leaveDay = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    // Pick a definitely-weekday leave day so the override is visibly different from a weekend default.
    while (isWeekend(leaveDay)) leaveDay.setDate(leaveDay.getDate() + 1);

    const iso = `${leaveDay.getFullYear()}-${String(leaveDay.getMonth() + 1).padStart(2, "0")}-${String(leaveDay.getDate()).padStart(2, "0")}`;
    const created = await request(app)
      .post("/api/leaves")
      .set("Authorization", `Bearer ${member.token}`)
      .send({ startDate: iso, endDate: iso, leaveType: "emergency", reason: "Personal" });

    await request(app)
      .patch(`/api/leaves/${created.body.data._id}/admin-decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "approved" });

    const month = `${leaveDay.getFullYear()}-${String(leaveDay.getMonth() + 1).padStart(2, "0")}`;
    const res = await request(app)
      .get(`/api/timeclock/calendar?month=${month}`)
      .set("Authorization", `Bearer ${member.token}`);

    const key = `${leaveDay.getFullYear()}-${String(leaveDay.getMonth() + 1).padStart(2, "0")}-${String(leaveDay.getDate()).padStart(2, "0")}`;
    const summary = res.body.data.find((d: { date: string }) => d.date === key);
    expect(summary.status).toBe("on-leave");
  });
});

describe("Attendance — team roster", () => {
  it("shows every active member's status for a given day, gated by attendance.view_all", async () => {
    const { adminToken, member, other } = await setup();

    await request(app).post("/api/timeclock/clock").set("Authorization", `Bearer ${member.token}`).send({ type: "time-in" });

    // PH calendar day, not the UTC one — .toISOString() would pick the wrong
    // day during the ~8 UTC hours where PH's calendar date has already rolled
    // over but UTC's hasn't yet (PH is UTC+8), which is exactly the class of
    // bug this whole file just got fixed for.
    const today = phDateKey(new Date());
    const res = await request(app)
      .get(`/api/timeclock/team?date=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const memberEntry = res.body.data.find((e: { userId: string }) => e.userId === member.userId);
    expect(memberEntry.summary.status).toBe("present");

    const otherEntry = res.body.data.find((e: { userId: string }) => e.userId === other.userId);
    expect(["absent", "weekend"]).toContain(otherEntry.summary.status);

    const forbidden = await request(app)
      .get(`/api/timeclock/team?date=${today}`)
      .set("Authorization", `Bearer ${member.token}`);
    expect(forbidden.status).toBe(403);
  });
});

describe("Attendance — shift timezone (EST for night shift)", () => {
  it("attributes a night-shift user's early-morning PHT shift to the previous EST calendar day", async () => {
    const reg = await createTestOrgAndAdmin({
      organizationName: "Night Co",
      name: "Nadia Admin",
      email: "nadia@ugnexa.test",
      password: "supersecret1",
    });
    const adminLogin = await loginWithId("nadia@ugnexa.test", "supersecret1");
    const roleId = await createRole(adminLogin.token, "Night Support");

    const created = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminLogin.token}`)
      .send({ name: "Nora Night", email: "nora@ugnexa.test", password: "supersecret2", roleId, shiftType: "night" });
    expect(created.status).toBe(201);
    expect(created.body.data.shiftType).toBe("night");
    const night = await loginWithId("nora@ugnexa.test", "supersecret2");

    // 2am-6am PHT on Jan 15, 2025 — PHT's midnight-to-1pm window falls within EST's PRIOR
    // calendar day (EST, winter, is UTC-5; this instant converts to 1pm-5pm EST on Jan 14), so a
    // night-shift user's own day boundary attributes the whole shift to Jan 14, not Jan 15.
    const phMidnight = parsePhDateKey("2025-01-15");
    const timeIn = new Date(phMidnight.getTime() + 2 * 60 * 60 * 1000); // 2am PHT Jan 15
    const timeOut = new Date(phMidnight.getTime() + 6 * 60 * 60 * 1000); // 6am PHT Jan 15

    await TimeLog.create([
      { organizationId: reg.organizationId, userId: night.userId, type: "time-in", timestamp: timeIn },
      { organizationId: reg.organizationId, userId: night.userId, type: "time-out", timestamp: timeOut },
    ]);

    const res = await request(app).get("/api/timeclock/calendar?month=2025-01").set("Authorization", `Bearer ${night.token}`);
    expect(res.status).toBe(200);

    const jan14 = res.body.data.find((d: { date: string }) => d.date === "2025-01-14");
    const jan15 = res.body.data.find((d: { date: string }) => d.date === "2025-01-15");
    expect(jan14.status).toBe("present");
    expect(jan14.workedMinutes).toBe(4 * 60);
    expect(jan15.status).not.toBe("present");
  });

  it("keeps an open graveyard shift visible as 'today' for a night-shift user too (EST day boundary)", async () => {
    const reg = await createTestOrgAndAdmin({
      organizationName: "Night Co 2",
      name: "Nadia Admin",
      email: "nadia2@ugnexa.test",
      password: "supersecret1",
    });
    const adminLogin = await loginWithId("nadia2@ugnexa.test", "supersecret1");
    const roleId = await createRole(adminLogin.token, "Night Support");
    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminLogin.token}`)
      .send({ name: "Nora Night", email: "nora2@ugnexa.test", password: "supersecret2", roleId, shiftType: "night" });
    const night = await loginWithId("nora2@ugnexa.test", "supersecret2");

    // Still-open shift that started well over a day ago (real wall-clock time) — simulates a
    // night-shift worker who's still working, regardless of which zone's midnight has passed.
    const timeIn = new Date(Date.now() - 20 * 60 * 60 * 1000);
    await TimeLog.create({ organizationId: reg.organizationId, userId: night.userId, type: "time-in", timestamp: timeIn });

    const today = await request(app).get("/api/timeclock/today").set("Authorization", `Bearer ${night.token}`);
    expect(today.status).toBe(200);
    expect(today.body.data.state).toBe("working");
    expect(today.body.data.logs).toHaveLength(1);

    const timeOut = await request(app)
      .post("/api/timeclock/clock")
      .set("Authorization", `Bearer ${night.token}`)
      .send({ type: "time-out" });
    expect(timeOut.status).toBe(201);
    expect(timeOut.body.data.state).toBe("clocked-out");
  });
});
