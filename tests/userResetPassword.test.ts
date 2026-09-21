import request from "supertest";
import { app } from "../src/server";
import { bootstrapPlatform } from "../src/scripts/bootstrap-platform";
import { config } from "../src/config";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { buildAccountCreatedEmail } from "../src/services/mail.service";
import { User } from "../src/models/User.model";

const TEMP = config.auth.newUserTempPassword;

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { res, token: res.body.data?.accessToken as string, userId: res.body.data?.user?.id as string };
}

async function setup() {
  await createTestOrgAndAdmin({ organizationName: "Acme", name: "Ada Admin", email: "ada@acme.test", password: "supersecret1" });
  const admin = await login("ada@acme.test", "supersecret1");
  const role = await request(app).post("/api/roles").set("Authorization", `Bearer ${admin.token}`).send({ name: "Member", permissions: [] });
  await request(app)
    .post("/api/users")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ email: "mona@acme.test", roleId: role.body.data.id });
  const mona = await login("mona@acme.test", TEMP);
  return { admin, mona };
}

const reset = (token: string, userId: string) =>
  request(app).post(`/api/users/${userId}/reset-password`).set("Authorization", `Bearer ${token}`);

describe("Admin password reset", () => {
  it("puts a user back on the temporary password, signs them out, and hands the password to the admin", async () => {
    const { admin, mona } = await setup();

    // Mona picks her own password…
    await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${mona.token}`)
      .send({ currentPassword: TEMP, newPassword: "my-own-password-9" });
    expect((await login("mona@acme.test", "my-own-password-9")).res.status).toBe(200);

    // …forgets it, and the admin resets her.
    const res = await reset(admin.token, mona.userId);
    expect(res.status).toBe(200);
    expect(res.body.data.credentialsEmailSent).toBe(false); // no Resend key in tests
    expect(res.body.data.temporaryPassword).toBe(TEMP);
    expect(res.body.data.mustChangePassword).toBe(true);

    expect((await login("mona@acme.test", "my-own-password-9")).res.status).toBe(401);
    const back = await login("mona@acme.test", TEMP);
    expect(back.res.status).toBe(200);
    expect(back.res.body.data.user.mustChangePassword).toBe(true);
  });

  it("revokes sessions the person already had", async () => {
    const { admin, mona } = await setup();
    const before = await User.findById(mona.userId);

    await reset(admin.token, mona.userId);

    const after = await User.findById(mona.userId);
    expect(after!.tokenVersion).toBe(before!.tokenVersion + 1);
  });

  it("won't reset yourself, a Super Admin, someone in another org, or a deleted user", async () => {
    const { admin, mona } = await setup();
    expect((await reset(admin.token, admin.userId)).status).toBe(400);

    await createTestOrgAndAdmin({ organizationName: "Other Co", name: "Olga", email: "olga@other.test", password: "supersecret1" });
    const olga = await login("olga@other.test", "supersecret1");
    expect((await reset(olga.token, mona.userId)).status).toBe(404);

    await request(app).delete(`/api/users/${mona.userId}/permanent`).set("Authorization", `Bearer ${admin.token}`);
    expect((await reset(admin.token, mona.userId)).status).toBe(404);
  });

  it("refuses to reset a Super Admin, even for someone who can manage users", async () => {
    await bootstrapPlatform({ email: "root@ugnexa.test", password: "supersecret1", name: "Root Admin" });
    const root = await login("root@ugnexa.test", "supersecret1");
    const dev = await request(app)
      .post("/api/platform/users")
      .set("Authorization", `Bearer ${root.token}`)
      .send({ email: "dev@ugnexa.test", isDeveloper: true });
    await User.updateOne({ email: "dev@ugnexa.test" }, { isSuperAdmin: true });

    const res = await reset(root.token, dev.body.data.id);
    expect(res.status).toBe(403);
    // and the target's password is untouched
    expect((await login("dev@ugnexa.test", TEMP)).res.status).toBe(200);
  });

  it("only lets a user manager do it", async () => {
    const { admin, mona } = await setup();
    const other = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ email: "ben@acme.test", roleId: (await User.findById(mona.userId))!.roleId.toString() });
    expect(other.status).toBe(201);

    const res = await reset(mona.token, other.body.data.id);
    expect(res.status).toBe(403);
  });
});

describe("Reset email", () => {
  it("says the password was reset rather than that an account was created", () => {
    const { subject, html } = buildAccountCreatedEmail({
      name: "Mona",
      email: "mona@acme.test",
      password: "pw",
      loginUrl: "https://x.test/login",
      kind: "reset",
    });
    expect(subject).toMatch(/password was reset/i);
    expect(html).toMatch(/reset your password/i);
    expect(html).not.toMatch(/account has been created/i);
  });
});
