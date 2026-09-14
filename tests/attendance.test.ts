import request from "supertest";
import { app } from "../src/server";
import { TimeLog } from "../src/models/TimeLog.model";
import { parsePhDateKey, phDateKey } from "../src/utils/phTime";

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
  const reg = await request(app).post("/api/auth/register").send(ADMIN);
  const adminId = reg.body.data.id as string;
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
      .send({ startDate: iso, endDate: iso, reason: "Personal" });

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
