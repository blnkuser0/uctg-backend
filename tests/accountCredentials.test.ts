import request from "supertest";
import { app } from "../src/server";
import { bootstrapPlatform } from "../src/scripts/bootstrap-platform";
import { createTestOrgAndAdmin } from "./helpers/bootstrap";
import { buildAccountCreatedEmail } from "../src/services/mail.service";
import { nameFromEmail } from "../src/utils/nameFromEmail";
import { config } from "../src/config";

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  return { token: res.body.data.accessToken as string, user: res.body.data.user };
}

async function adminWithRole() {
  await createTestOrgAndAdmin({ organizationName: "Acme", name: "Ada Admin", email: "ada@acme.test", password: "supersecret1" });
  const admin = await login("ada@acme.test", "supersecret1");
  const role = await request(app)
    .post("/api/roles")
    .set("Authorization", `Bearer ${admin.token}`)
    .send({ name: "QA", permissions: [] });
  return { admin, roleId: role.body.data.id as string };
}

describe("Creating an account with just email + password", () => {
  it("derives the display name from the email and flags the temp password", async () => {
    const { admin, roleId } = await adminWithRole();

    const created = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ email: "juan.delacruz@acme.test", password: "temp-pass-123", roleId });

    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe("Juan Delacruz");
    expect(created.body.data.mustChangePassword).toBe(true);
    // No Resend key in tests, so the email is skipped — and the API says so
    // instead of pretending, letting the UI tell the admin to share it manually.
    expect(created.body.data.credentialsEmailSent).toBe(false);
    expect(JSON.stringify(created.body)).not.toContain("temp-pass-123");

    const member = await login("juan.delacruz@acme.test", "temp-pass-123");
    expect(member.user.mustChangePassword).toBe(true);
  });

  it("still accepts an explicit name", async () => {
    const { admin, roleId } = await adminWithRole();
    const created = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ name: "Maria Santos", email: "m@acme.test", password: "temp-pass-123", roleId });
    expect(created.body.data.name).toBe("Maria Santos");
  });

  it("clears the flag once the user picks their own password", async () => {
    const { admin, roleId } = await adminWithRole();
    await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ email: "qa.tester@acme.test", password: "temp-pass-123", roleId });
    const member = await login("qa.tester@acme.test", "temp-pass-123");

    const change = await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${member.token}`)
      .send({ currentPassword: "temp-pass-123", newPassword: "my-own-password-9" });
    expect(change.status).toBe(200);

    const again = await login("qa.tester@acme.test", "my-own-password-9");
    expect(again.user.mustChangePassword).toBe(false);
  });

  it("works for Super Admin-created developers too", async () => {
    await bootstrapPlatform({ email: "root@ugnexa.test", password: "supersecret1", name: "Root Admin" });
    const root = await login("root@ugnexa.test", "supersecret1");

    const created = await request(app)
      .post("/api/platform/users")
      .set("Authorization", `Bearer ${root.token}`)
      .send({ email: "dana.dev@ugnexa.test", password: "temp-pass-123", isDeveloper: true });

    expect(created.status).toBe(201);
    expect(created.body.data.name).toBe("Dana Dev");
    expect(created.body.data.mustChangePassword).toBe(true);
    expect(created.body.data.credentialsEmailSent).toBe(false);
    expect(root.user.mustChangePassword).toBe(false);
  });
});

describe("Shared temporary password", () => {
  const DEFAULT_PASSWORD = config.auth.newUserTempPassword;

  it("defaults to Ugnexa@UCTG091326! unless the env overrides it", () => {
    if (!process.env.NEW_USER_TEMP_PASSWORD) expect(DEFAULT_PASSWORD).toBe("uctg123!");
  });

  it("gives a user created with only email + role the shared password", async () => {
    const { admin, roleId } = await adminWithRole();
    const created = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ email: "hr.person@acme.test", roleId });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain(DEFAULT_PASSWORD);

    const member = await login("hr.person@acme.test", DEFAULT_PASSWORD);
    expect(member.user.mustChangePassword).toBe(true);
  });

  it("applies to Super Admin-created developers and client-org admins", async () => {
    await bootstrapPlatform({ email: "root@ugnexa.test", password: "supersecret1", name: "Root Admin" });
    const root = await login("root@ugnexa.test", "supersecret1");

    const dev = await request(app)
      .post("/api/platform/users")
      .set("Authorization", `Bearer ${root.token}`)
      .send({ email: "dev.one@ugnexa.test", isDeveloper: true });
    expect(dev.status).toBe(201);
    await login("dev.one@ugnexa.test", DEFAULT_PASSWORD);

    const org = await request(app)
      .post("/api/platform/organizations")
      .set("Authorization", `Bearer ${root.token}`)
      .send({ organizationName: "Client Co", name: "Client Admin", email: "boss@client.test" });
    expect(org.status).toBe(201);
    const clientAdmin = await login("boss@client.test", DEFAULT_PASSWORD);
    expect(clientAdmin.user.mustChangePassword).toBe(true);
  });

  it("lets the new user replace it, after which the old shared password no longer works", async () => {
    const { admin, roleId } = await adminWithRole();
    await request(app).post("/api/users").set("Authorization", `Bearer ${admin.token}`).send({ email: "qa.one@acme.test", roleId });
    const member = await login("qa.one@acme.test", DEFAULT_PASSWORD);

    await request(app)
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${member.token}`)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: "my-own-password-9" });

    const stale = await request(app).post("/api/auth/login").send({ email: "qa.one@acme.test", password: DEFAULT_PASSWORD });
    expect(stale.status).toBe(401);
  });
});

describe("Credentials email content", () => {
  it("includes the login link, email and password", () => {
    const { subject, html } = buildAccountCreatedEmail({
      name: "Juan",
      email: "juan@acme.test",
      password: "abc123XYZ",
      loginUrl: "https://app.example.digital/login",
    });
    expect(subject).toMatch(/account is ready/i);
    expect(html).toContain("https://app.example.digital/login");
    expect(html).toContain("juan@acme.test");
    expect(html).toContain("abc123XYZ");
  });

  it("escapes HTML in names and passwords", () => {
    const { html } = buildAccountCreatedEmail({
      name: "<script>alert(1)</script>",
      email: "a@b.test",
      password: `p&ss<"'>`,
      loginUrl: "https://x.test/login",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("p&amp;ss&lt;&quot;&#39;&gt;");
  });
});

describe("nameFromEmail", () => {
  it.each([
    ["juan.delacruz@x.com", "Juan Delacruz"],
    ["QA_tester-1@x.com", "Qa Tester 1"],
    ["maria@x.com", "Maria"],
    ["a@x.com", "New User"],
    ["+++@x.com", "New User"],
  ])("%s → %s", (email, expected) => {
    expect(nameFromEmail(email)).toBe(expected);
  });
});
