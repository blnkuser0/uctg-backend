import request from "supertest";
import { app } from "../src/server";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

describe("Auth flow", () => {
  it("registers a new organization with its first admin", async () => {
    const res = await request(app).post("/api/auth/register").send(ADMIN);
    expect(res.status).toBe(201);
    expect(res.body.data.role.name).toBe("Admin");
    expect(res.body.data.role.permissions.length).toBeGreaterThan(0);
    expect(res.body.data.email).toBe(ADMIN.email);
    expect(res.body.data.organizationId).toBeTruthy();
  });

  it("creates a separate, isolated organization on each registration", async () => {
    const first = await request(app).post("/api/auth/register").send(ADMIN);
    const second = await request(app)
      .post("/api/auth/register")
      .send({ ...ADMIN, organizationName: "Other Co", email: "someone-else@ugnexa.test" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.organizationId).not.toBe(first.body.data.organizationId);
  });

  it("rejects registering the same email twice", async () => {
    await request(app).post("/api/auth/register").send(ADMIN);
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...ADMIN, organizationName: "Other Co" });
    expect(res.status).toBe(409);
  });

  it("rejects login with the wrong password", async () => {
    await request(app).post("/api/auth/register").send(ADMIN);
    const res = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("logs in and returns an access token + refresh cookie", async () => {
    await request(app).post("/api/auth/register").send(ADMIN);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN.email, password: ADMIN.password });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/refreshToken=/);
  });

  it("fetches the current user with the access token", async () => {
    await request(app).post("/api/auth/register").send(ADMIN);
    const loginRes = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    const token = loginRes.body.data.accessToken;

    const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe(ADMIN.email);
  });

  it("rejects /me without a token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("refreshes the access token using the refresh cookie", async () => {
    await request(app).post("/api/auth/register").send(ADMIN);
    const loginRes = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    const cookie = loginRes.headers["set-cookie"];

    const refreshRes = await request(app).post("/api/auth/refresh-tokens").set("Cookie", cookie);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toBeTruthy();
  });

  it("logs out and revokes the refresh token", async () => {
    await request(app).post("/api/auth/register").send(ADMIN);
    const loginRes = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    const token = loginRes.body.data.accessToken;
    const cookie = loginRes.headers["set-cookie"];

    const logoutRes = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`).set("Cookie", cookie);
    expect(logoutRes.status).toBe(200);

    const refreshRes = await request(app).post("/api/auth/refresh-tokens").set("Cookie", cookie);
    expect(refreshRes.status).toBe(401);
  });
});
