import request from "supertest";
import { app } from "../src/server";
import { mailService } from "../src/services/mail.service";
import { provisionSuperAdmin } from "../src/services/platform.service";

const ADMIN = { name: "Ugnexa Super Admin", email: "admin@test.com", password: "AdminTest123!" };

async function seedAdmin() {
  await provisionSuperAdmin(ADMIN);
}

describe("Authentication", () => {
  it("does not expose a public registration endpoint", async () => {
    const res = await request(app).post("/api/auth/register").send(ADMIN);
    expect(res.status).toBe(404);
  });

  it("logs in the seeded Super Admin and issues a JWT plus refresh cookie", async () => {
    await seedAdmin();
    const res = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    expect(res.status).toBe(200);
    expect(res.body.data.user.role.name).toBe("SUPER_ADMIN");
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.headers["set-cookie"]?.[0]).toMatch(/refreshToken=/);
  });

  it("rejects a bad password", async () => {
    await seedAdmin();
    const res = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("refreshes a valid session and serves the current user", async () => {
    await seedAdmin();
    const login = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${login.body.data.accessToken}`);
    const refresh = await request(app).post("/api/auth/refresh-tokens").set("Cookie", login.headers["set-cookie"]);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(ADMIN.email);
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.accessToken).toBeTruthy();
  });

  it("resets a password and invalidates the existing refresh session", async () => {
    await seedAdmin();
    const login = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    const sendSpy = jest.spyOn(mailService, "sendPasswordResetEmail").mockResolvedValue();
    await request(app).post("/api/auth/forgot-password").send({ email: ADMIN.email });
    const token = new URL(sendSpy.mock.calls[0][1]).searchParams.get("token")!;
    sendSpy.mockRestore();
    const reset = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "NewAdminTest123!" });
    const oldRefresh = await request(app).post("/api/auth/refresh-tokens").set("Cookie", login.headers["set-cookie"]);
    const freshLogin = await request(app).post("/api/auth/login").send({ email: ADMIN.email, password: "NewAdminTest123!" });
    expect(reset.status).toBe(200);
    expect(oldRefresh.status).toBe(401);
    expect(freshLogin.status).toBe(200);
  });
});
