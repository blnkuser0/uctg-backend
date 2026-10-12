import request from "supertest";
import { app } from "../src/server";
import { TimeLog } from "../src/models/TimeLog.model";
import { phDateKey, parsePhDateKey } from "../src/utils/phTime";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function loginAsAdmin() {
  const admin = await createTestOrgAndAdmin(ADMIN);
  const res = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
  return { token: res.body.data.accessToken as string, userId: admin.id, organizationId: admin.organizationId };
}

describe("Timeproof clock", () => {
  it("starts clocked-out with no events", async () => {
    const { token } = await loginAsAdmin();
    const res = await request(app).get("/api/timeclock/today").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe("clocked-out");
    expect(res.body.data.logs).toHaveLength(0);
  });

  it("walks the full state machine: in -> break -> back -> out", async () => {
    const { token } = await loginAsAdmin();
    const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

    const timeIn = await auth(request(app).post("/api/timeclock/clock")).send({ type: "time-in" });
    expect(timeIn.status).toBe(201);
    expect(timeIn.body.data.state).toBe("working");

    const breakIn = await auth(request(app).post("/api/timeclock/clock")).send({ type: "break-in" });
    expect(breakIn.body.data.state).toBe("on-break");

    const breakOut = await auth(request(app).post("/api/timeclock/clock")).send({ type: "break-out" });
    expect(breakOut.body.data.state).toBe("working");

    const timeOut = await auth(request(app).post("/api/timeclock/clock")).send({ type: "time-out" });
    expect(timeOut.body.data.state).toBe("clocked-out");

    const today = await auth(request(app).get("/api/timeclock/today"));
    expect(today.body.data.logs).toHaveLength(4);
  });

  it("rejects an invalid transition", async () => {
    const { token } = await loginAsAdmin();
    const res = await request(app)
      .post("/api/timeclock/clock")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "break-out" }); // never timed in
    expect(res.status).toBe(400);
  });

  it("rejects double time-in", async () => {
    const { token } = await loginAsAdmin();
    await request(app).post("/api/timeclock/clock").set("Authorization", `Bearer ${token}`).send({ type: "time-in" });
    const res = await request(app)
      .post("/api/timeclock/clock")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "time-in" });
    expect(res.status).toBe(400);
  });

  it("keeps an open graveyard shift visible as 'today' after midnight rolls over, and still allows time-out", async () => {
    const { token, userId, organizationId } = await loginAsAdmin();

    // Simulate a shift that started last night (PH time) and is still open — i.e. exactly what
    // a real night-shift worker looks like once the calendar day has rolled over past midnight.
    const yesterdayKey = phDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const yesterdayMidnight = parsePhDateKey(yesterdayKey);
    const timeIn = new Date(yesterdayMidnight.getTime() + 21 * 60 * 60 * 1000); // 9pm PH yesterday
    await TimeLog.create({ organizationId, userId, type: "time-in", timestamp: timeIn });

    const today = await request(app).get("/api/timeclock/today").set("Authorization", `Bearer ${token}`);
    expect(today.status).toBe(200);
    // Must still show "working" (not silently reset to clocked-out) and surface the open session.
    expect(today.body.data.state).toBe("working");
    expect(today.body.data.logs).toHaveLength(1);
    expect(today.body.data.logs[0].type).toBe("time-in");

    // Must still be able to end the shift — this is the bug: without the fix, the "today" window
    // would be empty, state would read clocked-out, and time-out would be rejected as invalid.
    const timeOut = await request(app)
      .post("/api/timeclock/clock")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "time-out" });
    expect(timeOut.status).toBe(201);
    expect(timeOut.body.data.state).toBe("clocked-out");
  });
});
