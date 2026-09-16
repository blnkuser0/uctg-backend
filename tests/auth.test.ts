import request from "supertest";
import { app } from "../src/server";
import { mailService } from "../src/services/mail.service";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";

const ADMIN = {
  organizationName: "Fitout Co",
  name: "Ada Admin",
  email: "ada@ugnexa.test",
  password: "supersecret1",
};

describe("Auth flow", () => {
  it("has no public registration route — organizations/accounts are Super-Admin-provisioned only", async () => {
    const res = await request(app).post("/api/auth/register").send(ADMIN);
    expect(res.status).toBe(404);
  });

  it("rejects login with the wrong password", async () => {
    await createTestOrgAndAdmin(ADMIN);
    const res = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("logs in and returns an access token + refresh cookie", async () => {
    await createTestOrgAndAdmin(ADMIN);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN.email, password: ADMIN.password });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/refreshToken=/);
  });

  it("fetches the current user with the access token", async () => {
    await createTestOrgAndAdmin(ADMIN);
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
    await createTestOrgAndAdmin(ADMIN);
    const loginRes = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    const cookie = loginRes.headers["set-cookie"];

    const refreshRes = await request(app).post("/api/auth/refresh-tokens").set("Cookie", cookie);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.accessToken).toBeTruthy();
  });

  it("logs out and revokes the refresh token", async () => {
    await createTestOrgAndAdmin(ADMIN);
    const loginRes = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    const token = loginRes.body.data.accessToken;
    const cookie = loginRes.headers["set-cookie"];

    const logoutRes = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`).set("Cookie", cookie);
    expect(logoutRes.status).toBe(200);

    const refreshRes = await request(app).post("/api/auth/refresh-tokens").set("Cookie", cookie);
    expect(refreshRes.status).toBe(401);
  });
});

describe("Password reset", () => {
  function getResetTokenFromUrl(url: string): string {
    return new URL(url).searchParams.get("token")!;
  }

  it("returns 200 for both existing and unknown emails, without leaking which", async () => {
    await createTestOrgAndAdmin(ADMIN);

    const known = await request(app).post("/api/auth/forgot-password").send({ email: ADMIN.email });
    const unknown = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@ugnexa.test" });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);
  });

  it("resets the password with a valid token and revokes existing sessions", async () => {
    await createTestOrgAndAdmin(ADMIN);
    const loginRes = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    const oldRefreshCookie = loginRes.headers["set-cookie"];

    const sendSpy = jest.spyOn(mailService, "sendPasswordResetEmail").mockResolvedValue();
    await request(app).post("/api/auth/forgot-password").send({ email: ADMIN.email });
    const resetUrl = sendSpy.mock.calls[0][1];
    const token = getResetTokenFromUrl(resetUrl);
    sendSpy.mockRestore();

    const resetRes = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "brand-new-password1" });
    expect(resetRes.status).toBe(200);

    const oldPasswordLogin = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: ADMIN.email, password: "brand-new-password1" });
    expect(newPasswordLogin.status).toBe(200);

    const refreshRes = await request(app).post("/api/auth/refresh-tokens").set("Cookie", oldRefreshCookie);
    expect(refreshRes.status).toBe(401);
  });

  it("rejects a reset with an invalid or already-used token", async () => {
    await createTestOrgAndAdmin(ADMIN);

    const badTokenRes = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "not-a-real-token", newPassword: "brand-new-password1" });
    expect(badTokenRes.status).toBe(400);

    const sendSpy = jest.spyOn(mailService, "sendPasswordResetEmail").mockResolvedValue();
    await request(app).post("/api/auth/forgot-password").send({ email: ADMIN.email });
    const token = getResetTokenFromUrl(sendSpy.mock.calls[0][1]);
    sendSpy.mockRestore();

    const firstUse = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "brand-new-password1" });
    expect(firstUse.status).toBe(200);

    const secondUse = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "another-password2" });
    expect(secondUse.status).toBe(400);
  });
});
