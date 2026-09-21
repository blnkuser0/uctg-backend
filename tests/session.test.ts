import request from "supertest";
import { app } from "../src/server";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { durationToMs } from "../src/utils/duration";
import { config } from "../src/config";

function refreshCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const cookie = cookies.find((c) => c.startsWith("refreshToken="));
  if (!cookie) throw new Error("no refreshToken cookie was set");
  return cookie;
}

const cookiePair = (setCookie: string) => setCookie.split(";")[0];

async function loginAs(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { res, token: res.body.data.accessToken as string, cookie: refreshCookie(res) };
}

describe("Staying signed in", () => {
  it("keeps the session that changed its password alive, while revoking every other session", async () => {
    await createTestOrgAndAdmin({ organizationName: "Acme", name: "Ada", email: "ada@acme.test", password: "supersecret1" });
    const laptop = await loginAs("ada@acme.test", "supersecret1");
    const phone = await loginAs("ada@acme.test", "supersecret1");

    const change = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${laptop.token}`)
      .send({ currentPassword: "supersecret1", newPassword: "brandnewpass1" });
    expect(change.status).toBe(200);
    const newCookie = refreshCookie(change);

    // The device that changed it just keeps working past its access-token expiry…
    const stillIn = await request(app).post("/api/auth/refresh-tokens").set("Cookie", cookiePair(newCookie));
    expect(stillIn.status).toBe(200);

    // …but the other device (and the pre-change cookie) is signed out.
    const oldCookie = await request(app).post("/api/auth/refresh-tokens").set("Cookie", cookiePair(laptop.cookie));
    const otherDevice = await request(app).post("/api/auth/refresh-tokens").set("Cookie", cookiePair(phone.cookie));
    expect(oldCookie.status).toBe(401);
    expect(otherDevice.status).toBe(401);
  });

  it("issues a refresh cookie that lasts as long as the refresh token itself", async () => {
    await createTestOrgAndAdmin({ organizationName: "Acme", name: "Ada", email: "ada@acme.test", password: "supersecret1" });
    const { cookie } = await loginAs("ada@acme.test", "supersecret1");

    const maxAge = Number(/Max-Age=(\d+)/i.exec(cookie)?.[1]);
    expect(maxAge).toBe(Math.round(durationToMs(config.jwt.refreshExpiresIn, 0) / 1000));
  });

  it("renews the cookie on every refresh, so active users never hit the expiry", async () => {
    await createTestOrgAndAdmin({ organizationName: "Acme", name: "Ada", email: "ada@acme.test", password: "supersecret1" });
    const { cookie } = await loginAs("ada@acme.test", "supersecret1");

    const refreshed = await request(app).post("/api/auth/refresh-tokens").set("Cookie", cookiePair(cookie));
    expect(refreshed.status).toBe(200);
    expect(refreshCookie(refreshed)).toMatch(/Max-Age=\d+/i);
  });
});

describe("durationToMs", () => {
  it.each([
    ["30d", 30 * 24 * 60 * 60 * 1000],
    ["7d", 7 * 24 * 60 * 60 * 1000],
    ["12h", 12 * 60 * 60 * 1000],
    ["15m", 15 * 60 * 1000],
    ["3600", 3600 * 1000],
    ["1w", 7 * 24 * 60 * 60 * 1000],
  ])("%s", (input, expected) => {
    expect(durationToMs(input, 0)).toBe(expected);
  });

  it("falls back for values it can't read", () => {
    expect(durationToMs("soon", 42)).toBe(42);
    expect(durationToMs("", 42)).toBe(42);
  });
});
