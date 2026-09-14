import request from "supertest";
import { app } from "../src/server";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

async function loginAsAdmin() {
  await request(app).post("/api/auth/register").send(ADMIN);
  const res = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
  return res.body.data.accessToken as string;
}

describe("Timeproof clock", () => {
  it("starts clocked-out with no events", async () => {
    const token = await loginAsAdmin();
    const res = await request(app).get("/api/timeclock/today").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe("clocked-out");
    expect(res.body.data.logs).toHaveLength(0);
  });

  it("walks the full state machine: in -> break -> back -> lunch -> back -> out", async () => {
    const token = await loginAsAdmin();
    const auth = (r: request.Test) => r.set("Authorization", `Bearer ${token}`);

    const timeIn = await auth(request(app).post("/api/timeclock/clock")).send({ type: "time-in" });
    expect(timeIn.status).toBe(201);
    expect(timeIn.body.data.state).toBe("working");

    const breakIn = await auth(request(app).post("/api/timeclock/clock")).send({ type: "break-in" });
    expect(breakIn.body.data.state).toBe("on-break");

    const breakOut = await auth(request(app).post("/api/timeclock/clock")).send({ type: "break-out" });
    expect(breakOut.body.data.state).toBe("working");

    const lunchIn = await auth(request(app).post("/api/timeclock/clock")).send({ type: "lunch-in" });
    expect(lunchIn.body.data.state).toBe("on-lunch");

    const lunchOut = await auth(request(app).post("/api/timeclock/clock")).send({ type: "lunch-out" });
    expect(lunchOut.body.data.state).toBe("working");

    const timeOut = await auth(request(app).post("/api/timeclock/clock")).send({ type: "time-out" });
    expect(timeOut.body.data.state).toBe("clocked-out");

    const today = await auth(request(app).get("/api/timeclock/today"));
    expect(today.body.data.logs).toHaveLength(6);
  });

  it("rejects an invalid transition", async () => {
    const token = await loginAsAdmin();
    const res = await request(app)
      .post("/api/timeclock/clock")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "break-out" }); // never timed in
    expect(res.status).toBe(400);
  });

  it("rejects double time-in", async () => {
    const token = await loginAsAdmin();
    await request(app).post("/api/timeclock/clock").set("Authorization", `Bearer ${token}`).send({ type: "time-in" });
    const res = await request(app)
      .post("/api/timeclock/clock")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "time-in" });
    expect(res.status).toBe(400);
  });
});
