import request from "supertest";
import { app } from "../src/server";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";

const EMAIL = "nicole.aring@acme.test";
const PASSWORD = "uctg123!";

const signIn = (email: string, password: string) => request(app).post("/api/auth/login").send({ email, password });

async function setup() {
  await createTestOrgAndAdmin({ organizationName: "Acme", name: "Nicole", email: EMAIL, password: PASSWORD });
}

describe("Signing in with copy-pasted credentials", () => {
  it.each([
    ["trailing space", `${PASSWORD} `],
    ["leading space", ` ${PASSWORD}`],
    ["trailing newline", `${PASSWORD}\n`],
    ["trailing tab", `${PASSWORD}\t`],
    ["non-breaking space", `${PASSWORD} `],
    ["zero-width space", `${PASSWORD}​`],
    ["byte-order mark", `﻿${PASSWORD}`],
  ])("accepts the right password with a %s", async (_label, pasted) => {
    await setup();
    expect((await signIn(EMAIL, pasted)).status).toBe(200);
  });

  it.each([
    ["different capitalisation", "Nicole.Aring@ACME.test"],
    ["surrounding spaces", `  ${EMAIL}  `],
    ["a zero-width space", `nicole.aring​@acme.test`],
    ["a trailing newline", `${EMAIL}\n`],
  ])("accepts the right email with %s", async (_label, pasted) => {
    await setup();
    expect((await signIn(pasted, PASSWORD)).status).toBe(200);
  });

  it("still rejects a wrong password, however it is padded", async () => {
    await setup();
    for (const wrong of ["wrong-password", " wrong-password ", `${PASSWORD}x`, "Uctg123!", `${PASSWORD.slice(1)}`]) {
      expect((await signIn(EMAIL, wrong)).status).toBe(401);
    }
    expect((await signIn(EMAIL, "   ")).status).toBe(401);
  });

  it("is just as forgiving about the current password when changing it", async () => {
    await setup();
    const login = await signIn(EMAIL, PASSWORD);
    const change = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`)
      .send({ currentPassword: `${PASSWORD} `, newPassword: "brand-new-pass-1" });
    expect(change.status).toBe(200);
    expect((await signIn(EMAIL, "brand-new-pass-1")).status).toBe(200);
  });
});
